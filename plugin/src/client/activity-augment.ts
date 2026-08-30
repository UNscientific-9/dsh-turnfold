/**
 * 增强 face 契约与纯决策函数（DOM-free）。
 *
 * 本插件不再渲染自有折叠条：官方 `turn-process` 折叠条负责本体渲染，
 * 本模块把 turn-activity 状态机的产出整形为「增强数据」（发布到 Turn
 * location 供 shadow renderer 读取）与「增强决策」（completed 白名单、
 * 折叠条文案）。所有函数纯逻辑，localStorage 经参数注入。
 */
import { readFlag } from './persist.ts';
import type { TurnEndReasonKind } from './activity-state.ts';
import type { TurnActivityKey } from './locales.ts';

/** Published on the turn location as `ConversationTurnDataMap['turn-activity']`. */
export interface TurnActivityAugment {
  readonly durationMs: number;
  readonly thinkingSteps: number;
  readonly reasonKind: TurnEndReasonKind;
}

/**
 * completed 白名单开关的 localStorage 键。默认关（尊重官方「轮次终结即
 * 折叠」）；置 `'1'` 后，终结原因非 completed 的轮（用户中断、失败、超限）
 * 强制保持展开。
 */
export const COMPLETED_ONLY_KEY = 'dsh.turn-collapse.completedOnly';

/** Feature switch: `'1'` enables; missing/unreadable storage defaults to off. */
export function isCompletedOnlyEnabled(storage: Storage | undefined): boolean {
  return readFlag(storage, COMPLETED_ONLY_KEY) === '1';
}

/**
 * 白名单决策：开启且终结原因已知时，非 completed 的轮强制展开。
 * augment 未就绪（历史重放尚未到达该轮的 `turn/end`）时不强制——此时
 * 跟随官方行为，避免在数据缺席时做出错误推断。
 */
export function shouldForceExpand(
  reasonKind: TurnEndReasonKind | undefined,
  completedOnlyEnabled: boolean,
): boolean {
  return completedOnlyEnabled && reasonKind !== undefined && reasonKind !== 'completed';
}

/** 官方折叠条计数 face（`TurnProcessChatData` 的计数子集）。 */
export interface FoldBarCounts {
  readonly messageCount: number;
  readonly toolCallCount: number;
  readonly subagentCount: number;
}

/** 文案装配依赖（renderer 注入 t 与时长格式化，保持本模块 DOM-free）。 */
export interface FoldBarTextKit {
  t(key: TurnActivityKey, params?: Record<string, unknown>): string;
  formatDuration(ms: number): string;
}

/**
 * 折叠条文案，拆两段以便增强段以 tertiary 色弱化：
 * - `base`：官方计数段（工具调用/消息/subagent，全零 → 「已思考」），
 *   段序与官方 TurnProcessNodeView 一致；
 * - `augment`：用时 + 思考段数（增强 face 未就绪时为空串）。
 */
export function composeFoldBarLabel(
  counts: FoldBarCounts,
  augment: TurnActivityAugment | undefined,
  kit: FoldBarTextKit,
): { base: string; augment: string } {
  const { t } = kit;
  const segments: string[] = [];
  // 官方计数段的统一装配：n > 0 才上屏，one/other 按计数二分。
  const addCount = (n: number, one: TurnActivityKey, other: TurnActivityKey): void => {
    if (n > 0) segments.push(t(n === 1 ? one : other, { count: n }));
  };
  addCount(counts.toolCallCount, 'turnActivity.bar.toolCallsOne', 'turnActivity.bar.toolCallsOther');
  addCount(counts.messageCount, 'turnActivity.bar.messagesOne', 'turnActivity.bar.messagesOther');
  addCount(counts.subagentCount, 'turnActivity.bar.subagentsOne', 'turnActivity.bar.subagentsOther');
  const base = segments.length === 0
    ? t('turnActivity.bar.thoughtForAWhile')
    : segments.join(t('turnActivity.bar.separator'));
  if (augment === undefined) return { base, augment: '' };
  const augmented: string[] = [
    t('turnActivity.bar.duration', { time: kit.formatDuration(augment.durationMs) }),
  ];
  if (augment.thinkingSteps > 0) {
    augmented.push(t(augment.thinkingSteps === 1
      ? 'turnActivity.bar.thinkingOne'
      : 'turnActivity.bar.thinkingOther', { count: augment.thinkingSteps }));
  }
  return { base, augment: augmented.join(t('turnActivity.bar.separator')) };
}
