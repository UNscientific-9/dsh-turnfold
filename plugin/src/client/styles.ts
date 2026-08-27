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
/* Final answer row of a collapsed turn: the row itself stays visible, but
 * the thinking block the host renders inside it (ReasoningRow, marked
 * data-variant="think" by DSH — see maintenance.md) is activity and must
 * fold with the turn. The marker is projector-managed, like the collapse
 * marker above. */
[data-dsh-ta-final-collapsed="true"] [data-variant="think"] {
  display: none;
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
  tag.textContent = TURN_ACTIVITY_CSS;
  if (version !== '') tag.dataset.pluginVersion = version;
  document.head.appendChild(tag);
}
