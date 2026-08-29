/**
 * projector 核心：`createProjector` 工厂与 `TurnActivityProjector` 接口。
 *
 * 职责边界：本文件只做「闭包协调」——持有 sessionId / observer / raf /
 * unsubscribe / running，把 store 决策经 applyPlan 应用到每个
 * `[data-chat-flow]` 列。行归属（row-membership / row-classify /
 * row-apply）、动画（animate）、合成条（synth-bars）、滚动（scroll）、
 * 应用计划（apply-plan）都在各自的模块里，本文件不重复任何一行逻辑。
 *
 * 依赖注入：`readSessionId`（会话 id 读取器）由调用方（singletons.ts）
 * 注入——本文件绝不 import singletons.ts，依赖方向保持单向
 * `singletons → projector-core`，杜绝模块环。
 */
import { computeSyntheticSummaries, type SynthesizedSummary } from './synth.ts';
import type { CollapseStore } from './store.ts';
import { DATA_SYNTH_TURN, DATA_TURN } from './constants.ts';
import { buildSynthBar, syncSynthBars } from './synth-bars.ts';
import { applyPlan, pickColumnSessionId } from './apply-plan.ts';
import { prefersReducedMotion } from './animate.ts';
import {
  collectSummaries,
  isUnownedRow,
  mergeCached,
  pickSummaryRowBySession,
} from './row-membership.ts';
import type { RowWithElement, SummaryRef } from './types.ts';
import { computeRowTargets } from './row-classify.ts';
import { describeRows, scrollerOf } from './scroll.ts';

/**
 * MutationObserver 白名单。故意排除 `style` 与 `data-dsh-ta-*`：
 * applyRowTargets / 动画会写这两者，观察自己的写入会在每次隐藏/恢复时
 * 多调度一次多余的 rAF reconcile。宿主（React 重渲染 / DSH 行重建）通过
 * `class` 与行 key 属性被观察；重建的行由 childList 变更捕获并在下一次
 * reconcile 重新标记。禁止扩展——这是折叠行为零漂移的硬约束。
 */
const PROJECTOR_ATTRIBUTE_FILTER = [
  'class',
  'data-chat-anchor-key',
  'data-chat-flow-kind',
] as const;

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
 * Create the document projector. `requestAnimationFrame` /
 * `cancelAnimationFrame` 与 `readSessionId` 均为注入参数（可测性 + 消除对
 * singletons 的运行时依赖），禁止在闭包内 inline 或用全局默认——调用方
 * （singletons.ts）显式传入。
 */
export function createProjector(
  document: Document,
  store: CollapseStore,
  requestAnimationFrame: (fn: () => void) => number = (fn) => window.requestAnimationFrame(fn),
  cancelAnimationFrame: (handle: number) => void = (handle) => window.cancelAnimationFrame(handle),
  readSessionId: () => string | null = () => null,
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
      const ownerSessionId = pickColumnSessionId(domSummaries) ?? sessionId ?? readSessionId();
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
      // `compensate` 显式传参、禁止默认 true：applyAll 的调度路径（store
      // 通知 / MutationObserver / rAF 合并）永远走 false——背景 reconcile
      // 补偿滚动正是当年「页面跳回顶部」bug 的根源。
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
    // identically-numbered turn. Fall back to the synthesized bar's row;
    // no match at all → give up (约束 2：多列场景禁止回退全局
    // querySelector，宁可保守不折叠也不跨列误折叠).
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
    if (column === null) return;
    // DOM summaries merged with the membership snapshot cache and the
    // synthesized fallbacks: the toggle still works when the summary row
    // left the document (paged history) or never existed (window-cut turn).
    const rows = describeRows(column);
    const domSummaries = collectSummaries(column);
    const ownerFromDom = pickColumnSessionId(domSummaries) ?? session ?? readSessionId();
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
        // `style` 与 `data-dsh-ta-*` 故意不观察（见 PROJECTOR_ATTRIBUTE_FILTER）。
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: [...PROJECTOR_ATTRIBUTE_FILTER],
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
