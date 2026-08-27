/**
 * Plugin CSS. Fixed `dsh-ta-` class names (no CSS-module hashing): the DOM
 * projector and the React view share these strings, and the bundle is a
 * single-file client plugin. Colors come from the DSH design tokens
 * (`--dsw-alias-*`) so light/dark themes work without overrides.
 */
export const TURN_ACTIVITY_CSS = `
.dsh-ta-root {
  margin: 8px 0 0;
}
.dsh-ta-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  border: none;
  background: transparent;
  margin: 0;
  padding: 4px 8px 4px 6px;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  border-radius: 8px;
  transition: background-color 120ms ease, color 120ms ease;
}
/* Collapsed state reads as an actionable control: a soft chip background
 * plus the label at secondary contrast. Expanded (the turn is open) stays
 * quiet so the activity region is the visual subject. */
.dsh-ta-toggle[aria-expanded="false"] {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-ta-toggle:hover,
.dsh-ta-toggle:focus-visible {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover-solid);
}
.dsh-ta-toggle:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--dsw-alias-border-l3);
}
.dsh-ta-chevron {
  flex: none;
  width: 12px;
  height: 12px;
  color: inherit;
  transition: transform 220ms cubic-bezier(0.2, 0, 0, 1);
}
.dsh-ta-toggle[aria-expanded="true"] .dsh-ta-chevron {
  transform: rotate(90deg);
}
.dsh-ta-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-ta-divider {
  height: 1px;
  margin: 8px 0 0;
  /* --dsw-alias-border-l2 is the same token the host uses for its own
   * hairline separators; l3 (≈12% black / ≈16% white) rendered below the
   * perceptual threshold and read as "no divider at all". */
  background: var(--dsw-alias-border-l2);
}
/* Projector-managed hide: the !important override wins over any DSH theme
 * rule that also sets display: none on a chat row, so expanding reliably
 * reveals the activity even if the row carries another hidden-state class. */
[data-dsh-ta-collapsed="true"] {
  display: none !important;
}
/* Rows mid fold/unfold animation: height/margin/opacity are driven inline by
 * the projector; the class only supplies the transition and clips overflow
 * (a shrinking row's content would otherwise spill during the fold). The
 * margin transition cancels the host column's 16px row gap so the layout
 * never jumps when rows enter/leave flow. */
.dsh-ta-animating {
  overflow: hidden;
  transition:
    height 220ms cubic-bezier(0.2, 0, 0, 1),
    margin-bottom 220ms cubic-bezier(0.2, 0, 0, 1),
    opacity 150ms ease;
}
@media (prefers-reduced-motion: reduce) {
  .dsh-ta-chevron {
    transition: none;
  }
  .dsh-ta-animating {
    transition: none;
  }
}
/* Floating bulk controls (collapse-all / expand-all): a small chip stack
 * pinned to the right viewport edge, above the composer zone. */
.dsh-ta-bulk {
  position: fixed;
  right: 14px;
  bottom: 132px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 6px;
  opacity: 0.72;
  transition: opacity 120ms ease;
}
.dsh-ta-bulk:hover {
  opacity: 1;
}
.dsh-ta-bulk-btn {
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-interactive-bg-hover));
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  padding: 4px 8px;
  border-radius: 8px;
  cursor: pointer;
}
.dsh-ta-bulk-btn:hover {
  color: var(--dsw-alias-label-primary);
}
`;

export const CSS_TAG_ID = '@dsh-plan/turn-collapse/styles';

/** Inject the stylesheet once; idempotent across HMR / plugin restarts. */
export function ensureStyles(document: Document): void {
  if (document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) !== null) return;
  const tag = document.createElement('style');
  tag.dataset.plugin = '@dsh-plan/turn-collapse';
  tag.dataset.pluginCss = CSS_TAG_ID;
  tag.textContent = TURN_ACTIVITY_CSS;
  document.head.appendChild(tag);
}
