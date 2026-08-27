/**
 * DOM projector：facade。
 *
 * 重构（refactor/projector-split）后本文件不再包含任何实现——`createProjector`
 * 与 `TurnActivityProjector` 已迁往 projector-core.ts，行归属/动画/合成条/
 * 滚动/应用计划分别在 constants / row-membership / row-classify / row-apply /
 * scroll / animate / synth-bars / apply-plan。下方 re-export 维持旧外部 API
 * 完全不变：summary-view.tsx、index.ts、singletons.ts、membership-persist.ts
 * 与 test/ 的 import 路径都无需改动。
 *
 * 架构语义（不变量）：
 * - store 是唯一真相源；MutationObserver 只调度 rAF 合并 reconcile，从不
 *   自行判定 turn 归属。
 * - 成员事实（finalStep / toolCallIds）只从 summary 行的 `data-dsh-ta-*`
 *   读回（React 视图渲染自引擎节点数据）——projector 从不从 DOM 重新推导
 *   语义。
 * - 行隐藏由单一 `data-dsh-ta-collapsed` 属性驱动，styles.ts 的 CSS 规则
 *   （`display: none !important`）胜出；React 重渲染不动该属性，重建的行由
 *   下一次 reconcile 重新标记。
 * - 依赖方向单向：singletons → projector-core；本文件零 import。
 */
export { createProjector, type TurnActivityProjector } from './projector-core.ts';

export {
  DATA_TURN,
  DATA_FINAL_STEP,
  DATA_TOOLS,
  DATA_RETRIES,
  DATA_THINKING,
  DATA_DURATION,
  DATA_SESSION,
  DATA_SYNTH_TURN,
  DATA_FINAL_COLLAPSED,
} from './constants.ts';

export {
  collectSummaries,
  rememberMembership,
  hydrateMembership,
  mergeCached,
  pickSummaryRowBySession,
  type RowDescriptor,
  type RowWithElement,
  type SummaryRef,
} from './row-membership.ts';

export {
  computeRowTargets,
  isFinalThinkRow,
  applyFinalThinkMarkers,
} from './row-classify.ts';

export {
  applyRowTargets,
  readRowState,
  type CollapseMarkerRow,
} from './row-apply.ts';

export { scrollerOf } from './scroll.ts';

export { buildSynthBar, syncSynthBars } from './synth-bars.ts';

export { type ApplyFocus } from './apply-plan.ts';
