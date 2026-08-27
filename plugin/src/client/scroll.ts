/**
 * 滚动：滚动容器探测、行描述、锚点/视口几何。全部纯函数，无模块级状态。
 */
import type { RowWithElement } from './row-membership.ts';

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
export function describeRows(column: HTMLElement): RowWithElement[] {
  return [...column.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')].map(
    (element) => ({
      key: element.dataset.chatAnchorKey ?? '',
      kind: element.dataset.chatFlowKind,
      element,
    }),
  );
}

/** Row position in scrollport coordinates (viewport-independent). */
export function flowTop(row: HTMLElement, scrollport: HTMLElement): number {
  return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top;
}

/** First row whose box is at or below the scrollport top, skipping rows this
 *  operation will change (they may vanish mid-measurement). */
export function pickAnchor(
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
export function isAtBottom(scrollport: HTMLElement): boolean {
  return scrollport.scrollTop + scrollport.clientHeight >= scrollport.scrollHeight - 25;
}
