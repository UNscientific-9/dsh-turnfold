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
 *
 * 拆分说明（refactor/projector-split）：本文件现在是 facade——只保留
 * `createProjector` 闭包与其直系（合成条、动画、applyPlan），其余职责已
 * 迁往 constants / row-membership / row-classify / row-apply / scroll；
 * 文件末尾的 re-export 维持旧外部 API 不变，外部 import 路径无需改动。
 */
import { beginAnimatedTransition, prefersReducedMotion } from './animate.ts';
import { computeSyntheticSummaries, synthLabel, type SynthesizedSummary } from './synth.ts';
import type { CollapseStore } from './store.ts';
import { readCurrentSessionId } from './singletons.ts';
import { DATA_SESSION, DATA_SYNTH_TURN, DATA_TURN } from './constants.ts';
import {
  collectSummaries,
  isUnownedRow,
  mergeCached,
  pickSummaryRowBySession,
  type RowWithElement,
  type SummaryRef,
} from './row-membership.ts';
import { applyFinalThinkMarkers, computeRowTargets } from './row-classify.ts';
import { applyRowTargets } from './row-apply.ts';
import { describeRows, flowTop, isAtBottom, pickAnchor, scrollerOf } from './scroll.ts';

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
  // The final answer row stays visible, but its in-row thinking block folds
  // with the turn. Applied on every path — including the animated
  // user-toggle branch, which hands the activity rows to
  // beginAnimatedTransition and never runs applyRowTargets.
  applyFinalThinkMarkers(rows, summaries, isCollapsed);
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
      const ownerSessionId = pickColumnSessionId(domSummaries) ?? sessionId ?? readCurrentSessionId();
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
            // Persist the decision BEFORE applying it: the store is the
            // reconcile source of truth, and without a write the next
            // reconcile pass would roll the toggle back to whatever stale
            // decision (or default) it finds there.
            store.setCollapsed(columnSessionId, turn, nextCollapsed ? 'collapsed' : 'expanded');
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
      console.info('[dsh.turnfold] reconcile', { flowCount: columns.length, perColumn: debugReports });
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
    const ownerFromDom = pickColumnSessionId(domSummaries) ?? session ?? readCurrentSessionId();
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
  };
}

// ── facade re-export ─────────────────────────────────────────────
// 拆分后本文件只保留 createProjector 闭包与其直系（合成条 / 动画 /
// applyPlan），行归属职责已迁往 constants / row-membership /
// row-classify / row-apply / scroll。以下 re-export 维持旧外部 API 不变：
// summary-view.tsx、index.ts、singletons.ts、membership-persist.ts 与
// test/ 的 import 路径都无需改动。
export {
  DATA_TURN,
  DATA_FINAL_STEP,
  DATA_TOOLS,
  DATA_RETRIES,
  DATA_THINKING,
  DATA_DURATION,
  DATA_SESSION,
  DATA_SYNTH_TURN,
  DATA_FINAL_COLLAPSED,
} from './constants.ts';

export {
  collectSummaries,
  rememberMembership,
  hydrateMembership,
  mergeCached,
  pickSummaryRowBySession,
  type RowDescriptor,
  type RowWithElement,
  type SummaryRef,
} from './row-membership.ts';

export {
  computeRowTargets,
  isFinalThinkRow,
  applyFinalThinkMarkers,
} from './row-classify.ts';

export {
  applyRowTargets,
  readRowState,
  type CollapseMarkerRow,
} from './row-apply.ts';

export { scrollerOf } from './scroll.ts';
