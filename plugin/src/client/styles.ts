/**
 * 插件 CSS：官方 TurnProcessNodeView 折叠条样式的复刻，固定 `dsh-tf-` 类名
 * （无 CSS-module 哈希——bundle 是单文件 client 插件）。颜色取 DSH 设计
 * 令牌（`--dsw-alias-*`）以适配明暗主题；增强段以 tertiary 色弱化。官方
 * 折叠条 wrapper（`data-chat-flow-kind` 行）样式由 ui-chat 自带，这里只
 * 覆盖 shadow renderer 渲染的 button。
 */
export const TURNFOLD_CSS = `
.dsh-tf-bar {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  height: 33px;
  padding: 0 0 8px;
  border: none;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: none;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.dsh-tf-bar:not([data-open]) {
  margin-bottom: 8px;
}
.dsh-tf-chevron {
  flex: none;
  width: 16px;
  height: 16px;
  margin-left: 6px;
  color: var(--dsw-alias-label-tertiary);
  transform: rotate(-90deg);
  transition: transform 100ms ease;
}
.dsh-tf-bar[data-open] .dsh-tf-chevron {
  transform: rotate(0deg);
}
.dsh-tf-label {
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-tf-augment {
  color: var(--dsw-alias-label-tertiary);
}
/* 动画期类（fold-animate.ts 挂到成员行 wrapper）：动画由 WAAPI（el.animate）
 * 驱动，这里只提供 overflow hidden 兜底；内联样式动画结束即被移除。 */
.dsh-tf-animating {
  overflow: hidden;
}
@media (prefers-reduced-motion: reduce) {
  .dsh-tf-chevron {
    transition: none;
  }
}
`;

export const CSS_TAG_ID = '@UNscientific-9/dsh-turnfold/styles';

/** Inject the stylesheet once; idempotent across HMR / plugin restarts. */
export function ensureStyles(document: Document, version = ''): void {
  const existing = document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`);
  if (existing !== null) {
    if (version !== '') (existing as HTMLElement).dataset.pluginVersion = version;
    return;
  }
  const tag = document.createElement('style');
  tag.dataset.plugin = '@UNscientific-9/dsh-turnfold';
  tag.dataset.pluginCss = CSS_TAG_ID;
  tag.textContent = TURNFOLD_CSS;
  if (version !== '') tag.dataset.pluginVersion = version;
  document.head.appendChild(tag);
}
