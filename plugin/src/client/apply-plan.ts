/**
 * 应用计划：把「隐藏/可见性决策」应用到列上，含可选滚动稳定。
 *
 * 参数顺序冻结（8 项，编译期类型保护）——调用方（projector-core 的
 * applyAll / applyCollapse）依赖该顺序，改动必须同步两处。
 *
 * 关键约束（重构拆分时验证过，禁止「优化」掉）：
 * - `applyFinalThinkMarkers` 必须在任何分支之前运行：final 行永远可见，
 *   但其行内 thinking 块要随轮折叠；动画分支把 activity 行交给
 *   `beginAnimatedTransition` 后不会再走 `applyRowTargets`，标记必须
 *   在分叉前就位。
 * - 动画分支（`focus !== null`）完全不做滚动补偿——折叠控件钉在 turn
 *   顶部，折叠/展开发生在它下方，滚动调整会与宿主 ChatView 的
 *   follow 逻辑打架。
 */
import { beginAnimatedTransition } from './animate.ts';
import type { RowWithElement, SummaryRef } from './row-membership.ts';
import { applyFinalThinkMarkers, computeRowTargets } from './row-classify.ts';
import { applyRowTargets } from './row-apply.ts';
import { flowTop, isAtBottom, pickAnchor } from './scroll.ts';

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
export function applyPlan(
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
export function pickColumnSessionId(
  summaries: ReadonlyMap<number, SummaryRef>,
): string | null {
  for (const ref of summaries.values()) {
    if (ref.sessionId !== undefined) return ref.sessionId;
  }
  return null;
}
