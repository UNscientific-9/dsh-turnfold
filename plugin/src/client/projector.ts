/**
 * DOM projector: applies the collapse store to the rendered chat flow.
 *
 * Strategy (per the implementation plan): the store is the single source of
 * truth; a MutationObserver only schedules a rAF-merged reconcile and never
 * decides turn membership itself. Membership facts (`finalStep`,
 * `toolCallIds`) are read from the summary row's own `data-dsh-ta-*`
 * attributes, which the React view renders from the engine-published node
 * data — so the projector never re-derives semantics from the DOM.
 *
 * Row hiding is driven by a single `data-dsh-ta-collapsed` attribute whose
 * matching CSS rule (`display: none !important` in styles.ts) wins over any
 * DSH theme rule that also sets `display: none`. React re-renders leave the
 * attribute alone, and a rebuilt row (or a reload) is re-marked by the next
 * reconcile.
 */
import { parseChatRowKey } from './row-keys.ts';
import { computeSyntheticSummaries, synthLabel, type SynthesizedSummary } from './synth.ts';
import type { CollapseStore } from './store.ts';
import { readMembershipMap, recordMembershipForPersist } from './membership-persist.ts';

export interface RowDescriptor {
  /** `data-chat-anchor-key` value (`conversationContextKey(kind, id)`). */
  readonly key: string;
  /** `data-chat-flow-kind` value; informational fallback only. */
  readonly kind: string | undefined;
}

/** A described row bound to its live element. */
export interface RowWithElement extends RowDescriptor {
  readonly element: HTMLElement;
}

/** Membership facts for one completed turn, mirroring the node data the view
 *  renders into `data-dsh-ta-*`. */
export interface SummaryRef {
  readonly turn: number;
  readonly finalStep: number | undefined;
  readonly toolCallIds: readonly string[];
  /** Correlated `llm/retry` ids; `model-retry` rows keyed by these ids are
   *  hidden together with the turn's activity. */
  readonly retryIds: readonly string[];
  /** The session this summary row was rendered for; read from the DOM so
   *  the projector never re-derives session ownership and so two `data-chat-flow`
   *  columns rendered for different sessions can each apply their own store
   *  decisions without cross-contamination. */
  readonly sessionId: string | undefined;
}

/** Data attributes the React view renders and this projector reads back. */
export const DATA_TURN = 'data-dsh-ta-turn';
export const DATA_FINAL_STEP = 'data-dsh-ta-final-step';
export const DATA_TOOLS = 'data-dsh-ta-tools';
export const DATA_RETRIES = 'data-dsh-ta-retries';
export const DATA_THINKING = 'data-dsh-ta-thinking';
export const DATA_DURATION = 'data-dsh-ta-duration';
/** Owning session id of the summary row. Optional in the DOM only for
 *  forward-compatibility with rows rendered by an older build that did not
 *  know about multi-column isolation; rows missing the attribute are skipped
 *  during multi-column reconcile (their decisions fall back to the global
 *  projector `sessionId`, which is correct for the single-column case). */
export const DATA_SESSION = 'data-dsh-ta-session';
/** Root attribute of a SYNTHESIZED fold bar (synth.ts). Deliberately NOT
 *  `data-dsh-ta-turn`: `collectSummaries` must never mistake a synthesized
 *  bar for an engine-materialized summary row. */
export const DATA_SYNTH_TURN = 'data-dsh-ta-synth-turn';

/** Read membership facts off the rendered summary rows. */
export function collectSummaries(column: ParentNode): ReadonlyMap<number, SummaryRef> {
  const map = new Map<number, SummaryRef>();
  for (const el of column.querySelectorAll<HTMLElement>(`[${DATA_TURN}]`)) {
    const turnText = el.getAttribute(DATA_TURN);
    if (turnText === null || !/^\d+$/.test(turnText)) continue;
    const turn = Number.parseInt(turnText, 10);
    const finalStepText = el.getAttribute(DATA_FINAL_STEP);
    const toolsText = el.getAttribute(DATA_TOOLS) ?? '';
    const retriesText = el.getAttribute(DATA_RETRIES) ?? '';
    const sessionId = el.getAttribute(DATA_SESSION);
    map.set(turn, {
      turn,
      finalStep:
        finalStepText === null || finalStepText === '' || !/^\d+$/.test(finalStepText)
          ? undefined
          : Number.parseInt(finalStepText, 10),
      toolCallIds: toolsText === '' ? [] : toolsText.split(','),
      retryIds: retriesText === '' ? [] : retriesText.split(','),
      sessionId: sessionId === null || sessionId === '' ? undefined : sessionId,
    });
  }
  return map;
}

/**
 * Membership-fact snapshot cache, keyed by session id then turn.
 *
 * The summary row is the DOM source of the membership facts
 * (`data-dsh-ta-*`), but in a paged/windowed conversation the row can be
 * absent from the document while its activity rows are rendered — e.g. the
 * host loads older history pages (`loadOlder`) and the summary row has not
 * been flushed yet, or a future virtualized layout drops off-screen rows.
 * Every time the React view renders a summary it re-records the facts here,
 * so `mergeCached` can keep folding those turns even while their summary row
 * is temporarily (or permanently) missing. Values are stable per turn, so
 * the cache only ever falls back to the same facts the DOM would provide.
 */
const membershipCache = new Map<string, Map<number, SummaryRef>>();
const MEMBERSHIP_CACHE_MAX_PER_SESSION = 512;

/** Record one turn's membership facts (called by the summary view). */
export function rememberMembership(sessionId: string, ref: SummaryRef): void {
  let byTurn = membershipCache.get(sessionId);
  if (byTurn === undefined) {
    byTurn = new Map();
    membershipCache.set(sessionId, byTurn);
  }
  byTurn.set(ref.turn, ref);
  if (byTurn.size > MEMBERSHIP_CACHE_MAX_PER_SESSION) {
    // Map iteration order is insertion order; drop the oldest entry.
    const oldest = byTurn.keys().next().value as number | undefined;
    if (oldest !== undefined) byTurn.delete(oldest);
  }
  // Survive the page: debounce-write the snapshot so a refresh outside the
  // 50-event window can still fold previously-seen turns with accurate
  // facts (membership-persist.ts). No-op under Node tests / private mode.
  recordMembershipForPersist(
    typeof localStorage !== 'undefined' ? localStorage : undefined,
    sessionId,
    ref,
  );
}

/**
 * Restore persisted membership snapshots into the in-memory cache (once,
 * at plugin mount). Existing entries win — a live render is fresher than
 * the persisted record.
 */
export function hydrateMembership(storage: Storage | undefined): void {
  for (const [sessionId, byTurn] of readMembershipMap(storage)) {
    let target = membershipCache.get(sessionId);
    if (target === undefined) {
      target = new Map();
      membershipCache.set(sessionId, target);
    }
    for (const [turn, ref] of byTurn) {
      if (!target.has(turn)) target.set(turn, ref);
    }
  }
}

/**
 * Merge the DOM-collected summaries with the cached membership facts for the
 * column's owner session. DOM facts win (they are the freshest render);
 * cached facts fill in turns whose summary row is not in the document.
 */
export function mergeCached(
  summaries: ReadonlyMap<number, SummaryRef>,
  sessionId: string | null,
): Map<number, SummaryRef> {
  const merged = new Map(summaries);
  if (sessionId === null) return merged;
  const cached = membershipCache.get(sessionId);
  if (cached === undefined) return merged;
  for (const [turn, ref] of cached) {
    if (!merged.has(turn)) merged.set(turn, ref);
  }
  return merged;
}

/** DOM attribute -> fold bar root for synthesized turns. */
function synthBarSelector(turn: number): string {
  return `[${DATA_SYNTH_TURN}="${turn}"]`;
}

const CHEVRON_PATH = 'M4.5 2.5 8 6l-3.5 3.5';

/**
 * Build the synthesized fold bar for one turn (plain DOM — the synthesized
 * bar is projector-managed and never passes through the React renderer).
 * Class names are the shared `dsh-ta-*` stylesheet; the root carries
 * `data-dsh-ta-synth-turn` (NOT `data-dsh-ta-turn`) so `collectSummaries`
 * cannot mistake it for an engine summary.
 */
export function buildSynthBar(
  summary: SynthesizedSummary,
  collapsed: boolean,
  onToggle: (turn: number, nextCollapsed: boolean) => void,
): HTMLElement {
  const root = summary.anchorRow.ownerDocument.createElement('div');
  root.className = 'dsh-ta-root dsh-ta-synth';
  root.setAttribute(DATA_SYNTH_TURN, String(summary.turn));
  if (summary.sessionId !== null) root.setAttribute(DATA_SESSION, summary.sessionId);
  const button = summary.anchorRow.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = 'dsh-ta-toggle';
  button.setAttribute('aria-expanded', String(!collapsed));
  button.title = collapsed ? '展开' : '折叠';
  const svg = summary.anchorRow.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'dsh-ta-chevron');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  const path = summary.anchorRow.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', CHEVRON_PATH);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  const label = summary.anchorRow.ownerDocument.createElement('span');
  label.className = 'dsh-ta-label';
  label.textContent = synthLabel(summary.stepCount, summary.toolCallIds.length);
  button.appendChild(svg);
  button.appendChild(label);
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-expanded') === 'true';
    onToggle(summary.turn, next);
  });
  const divider = summary.anchorRow.ownerDocument.createElement('div');
  divider.className = 'dsh-ta-divider';
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-label', '已折叠的执行步骤');
  root.appendChild(button);
  root.appendChild(divider);
  return root;
}

/**
 * Render/sync/remove the synthesized bars of one column (idempotent — safe
 * to call on every reconcile; a no-op pass emits no DOM mutation, so the
 * MutationObserver loop terminates). `ensureDecision` lets the caller apply
 * the default-collapse policy before the bar reads the store.
 */
export function syncSynthBars(
  column: HTMLElement,
  synth: ReadonlyMap<number, SynthesizedSummary>,
  isCollapsed: (turn: number) => boolean,
  onToggle: (turn: number, nextCollapsed: boolean) => void,
): void {
  for (const el of [...column.querySelectorAll<HTMLElement>(`[${DATA_SYNTH_TURN}]`)]) {
    const turnText = el.getAttribute(DATA_SYNTH_TURN);
    const turn = turnText !== null && /^\d+$/.test(turnText) ? Number(turnText) : NaN;
    if (!Number.isInteger(turn) || !synth.has(turn)) el.remove();
  }
  for (const summary of synth.values()) {
    const collapsed = isCollapsed(summary.turn);
    const existing = column.querySelector<HTMLElement>(synthBarSelector(summary.turn));
    if (existing === null) {
      summary.anchorRow.insertAdjacentElement('beforebegin', buildSynthBar(summary, collapsed, onToggle));
      continue;
    }
    const button = existing.querySelector<HTMLButtonElement>('.dsh-ta-toggle');
    const label = existing.querySelector<HTMLElement>('.dsh-ta-label');
    const text = synthLabel(summary.stepCount, summary.toolCallIds.length);
    if (button !== null) button.setAttribute('aria-expanded', String(!collapsed));
    if (label !== null && label.textContent !== text) label.textContent = text;
  }
}

const ASSISTANT_ID = /^(\d+):(\d+)$/;

/**
 * Decide the hide target for every row. Pure: no DOM access, no store access
 * beyond the injected `isCollapsed` predicate. Rows outside any summarized
 * turn and rows of unrelated kinds are never touched.
 * @returns a Map from the exact row objects passed in to their hide target.
 */
export function computeRowTargets<Row extends RowWithElement>(
  rows: readonly Row[],
  summaries: ReadonlyMap<number, SummaryRef>,
  isCollapsed: (turn: number) => boolean,
): ReadonlyMap<Row, boolean> {
  const targets = new Map<Row, boolean>();
  for (const row of rows) {
    const parsed = parseChatRowKey(row.key);
    if (parsed === null) {
      targets.set(row, false);
      continue;
    }
    if (parsed.kind === 'assistant-step') {
      const match = ASSISTANT_ID.exec(parsed.id);
      if (match === null) {
        targets.set(row, false);
        continue;
      }
      const turn = Number(match[1]);
      const step = Number(match[2]);
      const summary = summaries.get(turn);
      if (summary === undefined) {
        targets.set(row, false);
        continue;
      }
      // The final answer row is never hidden, even while collapsed.
      const isFinal = summary.finalStep !== undefined && step === summary.finalStep;
      targets.set(row, !isFinal && isCollapsed(turn));
      continue;
    }
    if (parsed.kind === 'tool-call') {
      let hide = false;
      for (const summary of summaries.values()) {
        if (summary.toolCallIds.includes(parsed.id)) {
          hide = isCollapsed(summary.turn);
          break;
        }
      }
      targets.set(row, hide);
      continue;
    }
    if (parsed.kind === 'model-retry') {
      // A retry notice row keyed by its random `retryId` (no turn/step
      // info); ownership comes exclusively from the summary's published
      // retry ids. Without this branch the retry block stays visible in the
      // middle of a collapsed turn — the "missing fold" gap.
      let hide = false;
      for (const summary of summaries.values()) {
        if (summary.retryIds.includes(parsed.id)) {
          hide = isCollapsed(summary.turn);
          break;
        }
      }
      targets.set(row, hide);
      continue;
    }
    targets.set(row, false);
  }
  return targets;
}

export interface CollapseMarkerRow {
  readonly key: string;
  readonly kind: string | undefined;
  readonly display: string;
  readonly marked: boolean;
}

/** Current visual state of one row, read by the applying layer. */
export function readRowState(row: HTMLElement): CollapseMarkerRow {
  return {
    key: row.dataset.chatAnchorKey ?? '',
    kind: row.dataset.chatFlowKind,
    display: row.style.display,
    marked: row.dataset.dshTaCollapsed === 'true',
  };
}

/**
 * Apply targets to real rows. Hiding is driven by a data attribute whose
 * matching CSS rule (`[data-dsh-ta-collapsed="true"] { display: none
 * !important }` in styles.ts) wins over any DSH theme rule that also sets
 * `display: none`, so the projector never has to second-guess an inline
 * style or a class added by the host. Returns whether anything changed.
 *
 * Rows currently animating a fold/unfold (class `dsh-ta-animating`) are
 * skipped: the animation owns their final marker and applies it when it
 * completes; a background reconcile must not yank them to the end state
 * mid-transition.
 */
export function applyRowTargets(
  rows: readonly RowWithElement[],
  targets: ReadonlyMap<RowWithElement, boolean>,
): boolean {
  let changed = false;
  for (const row of rows) {
    const hide = targets.get(row) ?? false;
    const element = row.element;
    const state = readRowState(element);
    if (hide !== state.marked) {
      if (element.classList.contains('dsh-ta-animating')) continue;
      if (hide) element.dataset.dshTaCollapsed = 'true';
      else delete element.dataset.dshTaCollapsed;
      changed = true;
    }
  }
  return changed;
}

/**
 * The chat scroller: same rule as the conversation view
 * (`data-conversation-scroll`). When the host has not marked the column (e.g.
 * a future virtualized layout with the scroll on a higher ancestor), walk up
 * the DOM tree looking for any ancestor with a scrollable overflow; fall
 * back to the column itself so the compensation math is still well-defined.
 */
export function scrollerOf(from: HTMLElement): HTMLElement {
  const marked = from.closest('[data-conversation-scroll]');
  if (marked !== null) return marked as HTMLElement;
  return findScrollableAncestor(from) ?? from;
}

function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = el.parentElement;
  while (current !== null) {
    const style = getComputedStyle(current);
    if (
      style.overflowY === 'auto' ||
      style.overflowY === 'scroll' ||
      style.overflowX === 'auto' ||
      style.overflowX === 'scroll'
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/** Bind every anchor-keyed row to its parsed identity. */
function describeRows(column: HTMLElement): RowWithElement[] {
  return [...column.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')].map(
    (element) => ({
      key: element.dataset.chatAnchorKey ?? '',
      kind: element.dataset.chatFlowKind,
      element,
    }),
  );
}

/** Row position in scrollport coordinates (viewport-independent). */
function flowTop(row: HTMLElement, scrollport: HTMLElement): number {
  return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top;
}

/** First row whose box is at or below the scrollport top, skipping rows this
 *  operation will change (they may vanish mid-measurement). */
function pickAnchor(
  rows: readonly RowWithElement[],
  scrollport: HTMLElement,
  changing: ReadonlySet<HTMLElement>,
): HTMLElement | null {
  const viewportTop = scrollport.getBoundingClientRect().top;
  for (const row of rows) {
    if (changing.has(row.element)) continue;
    if (row.element.getBoundingClientRect().bottom > viewportTop) return row.element;
  }
  return null;
}

/** DSH's own "at bottom" threshold; while at bottom its follow logic owns the
 *  viewport and our compensation would fight it. */
function isAtBottom(scrollport: HTMLElement): boolean {
  return scrollport.scrollTop + scrollport.clientHeight >= scrollport.scrollHeight - 25;
}

/**
 * The chat column lays rows out with `gap: 16px` (host ChatView css) and rows
 * carry no margin of their own. During a height transition every changed row
 * therefore gets `margin-bottom: -16px` to cancel its gap: without it a fold
 * would end with a 16px×N jump when the rows leave flow (and an expand would
 * start with one).
 */
const COLUMN_GAP_PX = 16;
const ANIMATE_MS = 220;
const ANIMATE_FALLBACK_MS = 420;

/** True when the OS asks for reduced motion; animation is skipped then. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Animate a fold (rows shrink and fade to zero) or unfold (rows grow and
 * fade in) with height/opacity transitions, then apply the final collapse
 * marker (`data-dsh-ta-collapsed`) and run `done`. Rows are marked with the
 * `dsh-ta-animating` class for the duration so background reconciles skip
 * them (`applyRowTargets`), and a newer animation interrupts the previous
 * one (its rows are reset to their natural state first).
 *
 * Both directions happen entirely inside one task before the browser paints:
 * start state → force reflow → target state, so there is no flash of the
 * fully-expanded or fully-hidden intermediate layout. `margin-bottom` is
 * transitioned in parallel to cancel the column gap (see `COLUMN_GAP_PX`).
 *
 * Heights are the row's RENDERED height (`offsetHeight`), not `scrollHeight`:
 * activity rows contain internally capped blocks (e.g. a tool body with
 * `max-height` + scroll), so `scrollHeight` is the full content height and
 * would yank the row taller than it ever renders — the "twitch" at the start
 * of a fold.
 */
function beginAnimatedTransition(
  documentRef: Document,
  els: readonly HTMLElement[],
  hide: boolean,
  done: () => void,
): void {
  interruptAnimation();
  if (els.length === 0) {
    done();
    return;
  }
  const token = ++animToken;
  for (const el of els) animatingRows.add(el);

  const finish = (): void => {
    if (token !== animToken) return; // superseded by a newer animation
    if (animTimer !== null) {
      window.clearTimeout(animTimer);
      animTimer = null;
    }
    for (const el of els) {
      el.removeEventListener('transitionend', onEnd);
      el.classList.remove('dsh-ta-animating');
      el.style.height = '';
      el.style.marginBottom = '';
      el.style.opacity = '';
      if (hide) el.dataset.dshTaCollapsed = 'true';
      else delete el.dataset.dshTaCollapsed;
      animatingRows.delete(el);
    }
    done();
  };

  if (hide) {
    // Fold: rows are visible at their rendered height; pin the start state
    // then transition height/opacity to zero. `offsetHeight` (not
    // `scrollHeight`) so internally capped blocks keep their rendered size.
    for (const el of els) {
      el.classList.add('dsh-ta-animating');
      el.style.height = `${el.offsetHeight}px`;
      el.style.marginBottom = '0px';
      el.style.opacity = '1';
    }
    void documentRef.body.offsetHeight; // commit the start state
    for (const el of els) {
      el.style.height = '0px';
      el.style.marginBottom = `${-COLUMN_GAP_PX}px`;
      el.style.opacity = '0';
    }
  } else {
    // Rows are display:none; reveal them at zero height, measure the
    // RENDERED height (`offsetHeight` — read right after the reveal, in the
    // same task, so the browser never paints the full-size intermediate),
    // then grow to it.
    for (const el of els) delete el.dataset.dshTaCollapsed;
    const heights = new Map<HTMLElement, string>();
    for (const el of els) {
      const full = `${el.offsetHeight}px`;
      heights.set(el, full);
      el.classList.add('dsh-ta-animating');
      el.style.height = '0px';
      el.style.marginBottom = `${-COLUMN_GAP_PX}px`;
      el.style.opacity = '0';
    }
    void documentRef.body.offsetHeight;
    for (const el of els) {
      el.style.height = heights.get(el) ?? `${el.offsetHeight}px`;
      el.style.marginBottom = '0px';
      el.style.opacity = '1';
    }
  }

  let remaining = els.length;
  const onEnd = (ev: TransitionEvent): void => {
    const el = ev.target as HTMLElement;
    if (ev.propertyName !== 'height' || !animatingRows.has(el)) return;
    el.removeEventListener('transitionend', onEnd);
    remaining -= 1;
    if (remaining === 0) finish();
  };
  for (const el of els) el.addEventListener('transitionend', onEnd);
  animTimer = window.setTimeout(finish, ANIMATE_FALLBACK_MS);
}

/** Global animation state; single projector instance per document. */
let animToken = 0;
const animatingRows = new Set<HTMLElement>();
let animTimer: number | null = null;

/** Reset every animating row to its natural (un-animated) state. */
function interruptAnimation(): void {
  if (animTimer !== null) {
    window.clearTimeout(animTimer);
    animTimer = null;
  }
  for (const el of animatingRows) {
    el.classList.remove('dsh-ta-animating');
    el.style.height = '';
    el.style.marginBottom = '';
    el.style.opacity = '';
  }
  animatingRows.clear();
}

export interface TurnActivityProjector {
  start(): void;
  stop(): void;
  /** The chat view reports its active session id (React side). */
  setSession(sessionId: string | null): void;
  /**
   * Apply one turn's collapse decision. Without `userDriven` this uses the
   * legacy stabilization (expansion pins the anchor row; collapse leaves
   * `scrollTop` alone and only rescues a viewport left empty) — the path
   * taken by the summary view's auto-collapse and rehydrate. With
   * `userDriven` (the toggle button) the fold/unfold animates; no scroll
   * adjustment is needed because the summary row anchors the top of its
   * turn and stays put. A no-op until the turn's membership facts are
   * available (rendered summary row or the snapshot cache).
   */
  applyTurnCollapse(
    sessionId: string,
    turn: number,
    collapsed: boolean,
    opts?: { userDriven?: boolean },
  ): void;
  /** Reconcile every recorded decision; rAF-merged, idempotent. */
  reconcile(): void;
  /**
   * Fold (or unfold) every known turn of every column at once. Collapsing
   * keeps the LATEST turn of each column expanded (the conversation's
   * current conclusion stays visible). Applies instantly — no animation
   * across dozens of turns — and writes a decision per turn so the bulk
   * action survives refreshes like any other toggle.
   */
  bulkCollapse(collapsed: boolean): void;
}

/**
 * User-driven toggle intent: fold/unfold with an animated transition when
 * possible. The summary row sits at the TOP of its turn, so toggling never
 * needs viewport compensation — the fold control stays put and activity
 * grows/shrinks beneath it. Only `applyTurnCollapse` with `userDriven` sets
 * this; automatic collapses and background reconciles pass `null`.
 */
export interface ApplyFocus {
  readonly animate: boolean;
  readonly reducedMotion: boolean;
}

/**
 * Apply a hide/visibility plan to the column with optional scroll
 * stabilization. `summaries` are the currently rendered turn summaries;
 * `isCollapsed` decides per-turn visibility; `compensate` enables the
 * viewport stabilization used by user-driven toggles and the summary
 * view's auto-collapse, not by background reconciles.
 *
 * Stabilization rules (verified against the host ChatView's own follow/scroll
 * logic; all measurements happen synchronously, no rAF race):
 *
 * - User toggle (`focus` set): fold/unfold, animated when the change is
 *   single-direction and motion is not reduced. No scrolling at all — the
 *   summary row anchors the top of its turn, so it never moves when the
 *   activity beneath it appears or disappears.
 * - Pure expansion (rows appear): keep the anchor row — the first row that
 *   is not part of this change and starts at/below the viewport top — at its
 *   viewport position, so the summary the user just clicked stays put while
 *   activity opens above it.
 * - Collapse (or mixed): leave `scrollTop` untouched. The viewport then
 *   naturally shows the collapsed state; only when the fold removed every
 *   visible row (the whole viewport was activity) do we scroll the first
 *   remaining row to the viewport top. This is what prevents the "page
 *   jumps to the top" bug: the old code compensated by a large negative
 *   delta and the browser clamped it to zero.
 * - At bottom: hands the viewport to DSH's own follow logic and does nothing.
 */
function applyPlan(
  column: HTMLElement,
  scrollport: HTMLElement,
  rows: readonly RowWithElement[],
  summaries: ReadonlyMap<number, SummaryRef>,
  isCollapsed: (turn: number) => boolean,
  compensate: boolean,
  focus: ApplyFocus | null,
): void {
  const targets = computeRowTargets(rows, summaries, isCollapsed);
  // Classify the rows this plan actually changes (before applying, since the
  // data attributes flip during the apply).
  const unhideRows: HTMLElement[] = [];
  const hideRows: HTMLElement[] = [];
  for (const [row, hide] of targets) {
    const marked = row.element.dataset.dshTaCollapsed === 'true';
    if (hide !== marked) (hide ? hideRows : unhideRows).push(row.element);
  }
  const changed = unhideRows.length > 0 || hideRows.length > 0;
  if (!changed) return;

  if (focus !== null) {
    // User-driven toggle: no viewport compensation at all — the fold control
    // is pinned to the top of its turn, so it stays put while the activity
    // beneath it animates. A mixed-direction change (rare) applies instantly.
    const singleDirection = unhideRows.length === 0 || hideRows.length === 0;
    const moving = unhideRows.length > 0 ? unhideRows : hideRows;
    if (focus.animate && singleDirection && !focus.reducedMotion) {
      beginAnimatedTransition(column.ownerDocument, moving, hideRows.length > 0, () => {
        // Animation finished; nothing else to do — no scroll adjustment.
      });
      return;
    }
    applyRowTargets(rows, targets);
    return;
  }

  const atBottom = isAtBottom(scrollport);
  if (compensate && !atBottom && unhideRows.length > 0 && hideRows.length === 0) {
    // Pure expansion: keep the anchor row pinned to its viewport position.
    const changing = new Set(unhideRows);
    const anchor = pickAnchor(rows, scrollport, changing);
    const before = anchor === null ? null : flowTop(anchor, scrollport);
    applyRowTargets(rows, targets);
    if (anchor !== null && before !== null) {
      const after = flowTop(anchor, scrollport);
      if (after !== before) scrollport.scrollTop += after - before;
    }
  } else {
    applyRowTargets(rows, targets);
    if (!compensate || atBottom) return;
    // Collapse (or mixed): scrollTop stays put; only rescue a viewport that
    // lost every visible row by pulling the first remaining row to the top.
    const viewportTop = scrollport.getBoundingClientRect().top;
    const viewportBottom = viewportTop + scrollport.clientHeight;
    let firstVisible: HTMLElement | null = null;
    let visibleInViewport = false;
    for (const row of rows) {
      if (targets.get(row) === true) continue;
      const rect = row.element.getBoundingClientRect();
      if (firstVisible === null) firstVisible = row.element;
      if (rect.bottom > viewportTop && rect.top < viewportBottom) {
        visibleInViewport = true;
        break;
      }
    }
    if (!visibleInViewport && firstVisible !== null) {
      const rect = firstVisible.getBoundingClientRect();
      const max = Math.max(0, scrollport.scrollHeight - scrollport.clientHeight);
      scrollport.scrollTop = Math.min(
        Math.max(0, scrollport.scrollTop + (rect.top - viewportTop)),
        max,
      );
    }
  }
}

/** Probe a column's owner session by reading the `data-dsh-ta-session`
 *  attribute off the first summary that has one. Used to pick the right
 *  store key when reconciling a multi-column document — every summary in a
 *  single column belongs to the same session, so a single probe suffices. */
function pickColumnSessionId(
  summaries: ReadonlyMap<number, SummaryRef>,
): string | null {
  for (const ref of summaries.values()) {
    if (ref.sessionId !== undefined) return ref.sessionId;
  }
  return null;
}

/** Pick the rendered summary row that owns a turn number. Each session numbers
 *  its turns independently, so several chat-flow columns can render the same
 *  turn number at the same time; prefer the row whose `data-dsh-ta-session`
 *  matches the caller's session, falling back to the first row when no row
 *  matches (a legacy row without the attribute, or a stale caller session) —
 *  which reproduces the old single-column behavior. */
export function pickSummaryRowBySession(
  rows: readonly HTMLElement[],
  session: string | null,
): HTMLElement | null {
  let fallback: HTMLElement | null = null;
  for (const row of rows) {
    if (fallback === null) fallback = row;
    if (session !== null && row.getAttribute(DATA_SESSION) === session) return row;
  }
  return fallback;
}

/** True for rows the projector intentionally leaves alone: every kind the
 *  row-key grammar recognises except `assistant-step` and `tool-call` (the
 *  two collapsible activity kinds). Used only by the debug hook to surface
 *  rows that might be missed (e.g. the unresolved `model-retry`). */
function isUnownedRow(row: RowWithElement): boolean {
  const parsed = parseChatRowKey(row.key);
  if (parsed === null) return false;
  return parsed.kind !== 'assistant-step' && parsed.kind !== 'tool-call';
}

export function createProjector(
  document: Document,
  store: CollapseStore,
  requestAnimationFrame: (fn: () => void) => number = (fn) => window.requestAnimationFrame(fn),
  cancelAnimationFrame: (handle: number) => void = (handle) => window.cancelAnimationFrame(handle),
): TurnActivityProjector {
  let sessionId: string | null = null;
  let observer: MutationObserver | null = null;
  let raf: number | null = null;
  let unsubscribe: (() => void) | null = null;
  let running = false;

  const schedule = (): void => {
    if (!running || raf !== null) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      if (running) applyAll(false);
    });
  };

  /**
   * DOM summaries + membership cache + synthesized fallbacks (synth.ts) for
   * one column. The synthesized entries fill turns whose real summary row
   * is not in the document (window-cut history) so their rows stay
   * foldable; they never override real or cached facts.
   */
  const resolveColumnSummaries = (
    column: HTMLElement,
    rows: readonly RowWithElement[],
    columnSessionId: string,
  ): { summaries: Map<number, SummaryRef>; synth: ReadonlyMap<number, SynthesizedSummary> } => {
    const domSummaries = collectSummaries(column);
    const merged = mergeCached(domSummaries, columnSessionId);
    const synth = computeSyntheticSummaries(rows, domSummaries, merged, columnSessionId);
    const summaries = new Map(merged);
    for (const [turn, s] of synth) {
      summaries.set(turn, {
        turn: s.turn,
        finalStep: s.finalStep,
        toolCallIds: s.toolCallIds,
        retryIds: s.retryIds,
        sessionId: s.sessionId ?? undefined,
      });
    }
    return { summaries, synth };
  };

  /** Re-apply the store to every summarized turn (without scroll
   *  compensation: background reconciles — store notifications, DOM
   *  mutations, rAF merges — must never move the viewport. Compensating a
   *  fold that happened outside the reader's view was the source of the
   *  "page jumps to the top" bug; only user-driven toggles and the summary
   *  view's own apply (`applyTurnCollapse`) compensate, and only against
   *  their own column.
   *
   *  Walks every `[data-chat-flow]` column in the document and applies each
   *  column's store decision against the `data-dsh-ta-session` of its own
   *  summary rows, so two side-by-side conversations never cross-apply. The
   *  single-column legacy case falls out naturally: there is exactly one
   *  column, the empty-column short-circuits, and the projector instance
   *  `sessionId` is only used as a fallback when no summary row owns the
   *  column (none-rendered-yet case). */
  const applyAll = (compensate: boolean): void => {
    const columns = document.querySelectorAll<HTMLElement>('[data-chat-flow]');
    if (columns.length === 0) return;
    const debugEnabled =
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('dsh.turn-collapse.debug') === '1';
    const debugReports: unknown[] = [];
    for (const column of columns) {
      // DOM summaries plus the membership snapshot cache: in a paged
      // conversation a turn's summary row may not be in the document while
      // its activity rows are (older-history pages load separately, and a
      // future virtualized layout may drop off-screen rows). The cached
      // facts keep those turns foldable. The column-owner probe still needs
      // at least one DOM summary (or the projector session fallback) to know
      // which session's cache applies.
      const domSummaries = collectSummaries(column);
      const ownerSessionId = pickColumnSessionId(domSummaries) ?? sessionId;
      if (ownerSessionId === null) {
        if (debugEnabled) {
          debugReports.push({ flow: column.getAttribute('data-chat-flow') ?? '?', summaries: domSummaries.size, hiddenRows: 0, unowned: [], note: 'no column session' });
        }
        continue;
      }
      const columnSessionId = ownerSessionId;
      const rows = describeRows(column);
      const { summaries, synth } = resolveColumnSummaries(column, rows, columnSessionId);
      if (summaries.size === 0) {
        if (debugEnabled) {
          debugReports.push({ flow: column.getAttribute('data-chat-flow') ?? '?', summaries: 0, hiddenRows: 0, unowned: [] });
        }
        continue;
      }
      // Synthesized fold bars: default-collapse once (user-approved policy),
      // then keep the bar in sync with the store; a no-op pass emits no DOM
      // mutation, so the observer loop terminates.
      for (const turn of synth.keys()) {
        if (store.getCollapsed(columnSessionId, turn) === undefined) {
          store.setCollapsed(columnSessionId, turn, 'collapsed');
        }
      }
      if (synth.size > 0 || column.querySelector(`[${DATA_SYNTH_TURN}]`) !== null) {
        syncSynthBars(
          column,
          synth,
          (turn) => store.getCollapsed(columnSessionId, turn) === 'collapsed',
          (turn, nextCollapsed) => {
            applyCollapse(columnSessionId, turn, nextCollapsed, { userDriven: true });
          },
        );
      }
      const isCollapsed = (turn: number): boolean =>
        store.getCollapsed(columnSessionId, turn) === 'collapsed';
      if (debugEnabled) {
        const targets = computeRowTargets(rows, summaries, isCollapsed);
        let hidden = 0;
        const unowned: { key: string; kind: string | undefined }[] = [];
        for (const [row, hide] of targets) {
          if (hide) hidden++;
          else if (isUnownedRow(row)) unowned.push({ key: row.key, kind: row.kind });
        }
        debugReports.push({
          flow: column.getAttribute('data-chat-flow') ?? '?',
          sessionId: columnSessionId,
          summaries: [...summaries.keys()],
          hiddenRows: hidden,
          unowned,
        });
      }
      applyPlan(column, scrollerOf(column), rows, summaries, isCollapsed, compensate, null);
    }
    if (debugEnabled && debugReports.length > 0) {
      console.info('[dsh.turn-collapse] reconcile', { flowCount: columns.length, perColumn: debugReports });
    }
  };

  /**
   * Apply one turn's collapse decision (real or synthesized turn). Kept in
   * the closure so both the public API and the synthesized bars' toggle
   * handlers share one path.
   */
  const applyCollapse = (
    session: string,
    turn: number,
    collapsed: boolean,
    opts?: { userDriven?: boolean },
  ): void => {
    // Find the rendered summary row for this turn; the row is the source
    // of truth for which column it belongs to (multi-session safety) and
    // which session it was rendered for (the `data-dsh-ta-session`
    // attribute). Turn numbers restart per session, so several columns can
    // render the same turn number at once — resolving by the caller's
    // session (via `pickSummaryRowBySession`) is what keeps a multi-session
    // document from applying this decision to another column's
    // identically-numbered turn. Fall back to the synthesized bar's row,
    // then to the first `[data-chat-flow]` — a single-column host in that
    // case still resolves the column from the only one available.
    const summaryRow = pickSummaryRowBySession(
      Array.from(document.querySelectorAll<HTMLElement>(`[${DATA_TURN}="${turn}"]`)),
      session,
    );
    let column: HTMLElement | null =
      summaryRow !== null ? summaryRow.closest<HTMLElement>('[data-chat-flow]') : null;
    if (column === null) {
      const synthRow = document.querySelector<HTMLElement>(`[${DATA_SYNTH_TURN}="${turn}"]`);
      column = synthRow !== null ? synthRow.closest<HTMLElement>('[data-chat-flow]') : null;
    }
    if (column === null) {
      column = document.querySelector<HTMLElement>('[data-chat-flow]');
    }
    if (column === null) return;
    // DOM summaries merged with the membership snapshot cache and the
    // synthesized fallbacks: the toggle still works when the summary row
    // left the document (paged history) or never existed (window-cut turn).
    const rows = describeRows(column);
    const domSummaries = collectSummaries(column);
    const ownerFromDom = pickColumnSessionId(domSummaries) ?? session;
    const { summaries } = resolveColumnSummaries(column, rows, ownerFromDom);
    if (!summaries.has(turn)) return; // summary facts not available yet
    // Prefer the row's own session (multi-column truth) over the caller's
    // `session` argument; the latter can be stale if a viewer just switched
    // tabs and the MutationObserver has not yet re-emitted.
    const ref = summaries.get(turn);
    const ownerSession = ref?.sessionId ?? session;
    const isCollapsed = (t: number): boolean =>
      t === turn ? collapsed : store.getCollapsed(ownerSession, t) === 'collapsed';
    if (opts?.userDriven === true) {
      // The fold control anchors the TOP of its turn, so a user toggle
      // needs no scroll compensation at all: the fold control stays put
      // and the activity animates beneath it. Just animate (or apply
      // instantly when motion is reduced / the change is mixed).
      applyPlan(column, scrollerOf(column), rows, summaries, isCollapsed, true, {
        animate: true,
        reducedMotion: prefersReducedMotion(),
      });
      return;
    }
    applyPlan(column, scrollerOf(column), rows, summaries, isCollapsed, true, null);
  };

  return {
    start() {
      if (running) return;
      running = true;
      unsubscribe = store.subscribe(schedule);
      if (typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(schedule);
        // `style` and `data-dsh-ta-collapsed` are intentionally omitted:
        // applyRowTargets writes both, and observing our own writes would
        // schedule a redundant rAF reconcile on every hide/unhide. The host
        // (React re-render / DSH row rebuild) is observed via `class` and the
        // row-key attributes; a rebuilt row is caught by the childList
        // mutation and re-marked by the next reconcile.
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'data-chat-anchor-key', 'data-chat-flow-kind'],
        });
      }
      schedule();
    },
    stop() {
      running = false;
      if (unsubscribe !== null) {
        unsubscribe();
        unsubscribe = null;
      }
      if (observer !== null) {
        observer.disconnect();
        observer = null;
      }
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    },
    setSession(id: string | null) {
      sessionId = id;
      if (running) schedule();
    },
    applyTurnCollapse(
      session: string,
      turn: number,
      collapsed: boolean,
      opts?: { userDriven?: boolean },
    ): void {
      applyCollapse(session, turn, collapsed, opts);
    },
    reconcile() {
      applyAll(false);
    },
    bulkCollapse(collapsed: boolean): void {
      const columns = document.querySelectorAll<HTMLElement>('[data-chat-flow]');
      for (const column of columns) {
        const domSummaries = collectSummaries(column);
        const ownerSessionId = pickColumnSessionId(domSummaries) ?? sessionId;
        if (ownerSessionId === null) continue;
        const rows = describeRows(column);
        const { summaries } = resolveColumnSummaries(column, rows, ownerSessionId);
        if (summaries.size === 0) continue;
        const latestTurn = Math.max(...summaries.keys());
        for (const turn of summaries.keys()) {
          if (collapsed && turn === latestTurn) continue;
          store.setCollapsed(ownerSessionId, turn, collapsed ? 'collapsed' : 'expanded');
        }
        const isCollapsed = (turn: number): boolean =>
          store.getCollapsed(ownerSessionId, turn) === 'collapsed';
        applyPlan(column, scrollerOf(column), rows, summaries, isCollapsed, true, null);
      }
    },
  };
}
