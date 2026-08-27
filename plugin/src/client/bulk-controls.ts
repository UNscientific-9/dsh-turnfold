/**
 * The floating bulk controls: "collapse all" (keeping the latest turn open)
 * and "expand all" — one small fixed chip stack at the viewport's right
 * edge, out of the composer's way. Pure DOM, created once per document and
 * idempotent across reconciles (the projector's MutationObserver sees the
 * insertion, the next pass finds the controls already present and mutates
 * nothing).
 */

const CONTROLS_ID = 'dsh-ta-bulk-controls';

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dsh-ta-bulk-btn';
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', onClick);
  return button;
}

/**
 * Create the bulk controls when absent; refresh their visibility from the
 * presence of any fold bar (real or synthesized) so pages without a
 * conversation render nothing.
 */
export function ensureBulkControls(
  doc: Document,
  hasFolds: () => boolean,
  onCollapseAll: () => void,
  onExpandAll: () => void,
): void {
  let root = doc.getElementById(CONTROLS_ID);
  if (root === null) {
    root = doc.createElement('div');
    root.id = CONTROLS_ID;
    root.className = 'dsh-ta-bulk';
    root.appendChild(
      button('⇑ 全部折叠', '折叠全部轮次（保留最新一轮展开）', onCollapseAll),
    );
    root.appendChild(button('⇓ 全部展开', '展开全部轮次', onExpandAll));
    doc.body.appendChild(root);
  }
  root.style.display = hasFolds() ? '' : 'none';
  // Visibility must track the conversation lifecycle, not just store events
  // (the first summary bar can appear without a store write). A 1s poll is
  // negligible and keeps the chip honest after window-cut swaps.
  if (!root.dataset.dshTaPolling) {
    root.dataset.dshTaPolling = '1';
    doc.defaultView?.setInterval(() => {
      root.style.display = hasFolds() ? '' : 'none';
    }, 1000);
  }
}
