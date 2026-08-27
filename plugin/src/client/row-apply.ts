/**
 * 行应用：把分类结果写到真实行上——只动 `data-dsh-ta-collapsed` 属性，
 * 由 styles.ts 的 CSS 规则决定显隐；从不猜 inline style 或宿主类。
 */
import type { RowWithElement } from './types.ts';

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
