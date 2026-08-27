/**
 * DOM 契约常量：`data-dsh-ta-*` 属性名。
 *
 * 这些属性名是 React 视图（summary-view.tsx）写出、projector 读回、
 * styles.ts 的 CSS 规则依赖的公开契约——改名会破坏折叠行为与既有
 * localStorage 数据，修改前必须同时核对 styles.ts、fixture 页面与
 * docs/architecture.md 的读入/写出属性表。
 */
export const DATA_TURN = 'data-dsh-ta-turn';
export const DATA_FINAL_STEP = 'data-dsh-ta-final-step';
export const DATA_TOOLS = 'data-dsh-ta-tools';
export const DATA_RETRIES = 'data-dsh-ta-retries';
export const DATA_THINKING = 'data-dsh-ta-thinking';
export const DATA_DURATION = 'data-dsh-ta-duration';
/** Owning session id of the summary row. Optional in the DOM only for
 *  forward-compatibility with rows rendered by an older build that did not
 *  know about multi-column isolation; rows missing the attribute are skipped
 *  during multi-column reconcile (their decisions fall back to the global
 *  projector `sessionId`, which is correct for the single-column case). */
export const DATA_SESSION = 'data-dsh-ta-session';
/** Root attribute of a SYNTHESIZED fold bar (synth.ts). Deliberately NOT
 *  `data-dsh-ta-turn`: `collectSummaries` must never mistake a synthesized
 *  bar for an engine-materialized summary row. */
export const DATA_SYNTH_TURN = 'data-dsh-ta-synth-turn';
/** Root attribute marking the turn's FINAL answer row while the turn is
 *  collapsed. The row itself stays visible (product rule), but the thinking
 *  block the host renders inside it (a `data-variant="think"` ReasoningRow,
 *  see maintenance.md) is activity and must fold with the turn — CSS hides
 *  it, and clearing the marker on expand restores it. */
export const DATA_FINAL_COLLAPSED = 'data-dsh-ta-final-collapsed';
