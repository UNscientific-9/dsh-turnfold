/**
 * 合成折叠条（synth bar）：为没有引擎 summary 行的 turn（窗口裁剪的历史）
 * 构建/同步/移除折叠条。合成条由 projector 直接管理，从不经过 React 渲染
 * 器；根元素带 `data-dsh-ta-synth-turn`（而非 `data-dsh-ta-turn`），
 * collectSummaries 不会把它误认成引擎 summary。
 */
import { DATA_SESSION, DATA_SYNTH_TURN } from './constants.ts';
import { synthLabel, type SynthesizedSummary } from './synth.ts';

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
