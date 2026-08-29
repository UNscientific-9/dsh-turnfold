/**
 * turn-activity ConversationNodeDefinition: 每个 turn 一个 engine context，
 * 从原始 Session 日志累计活动事实，轮次结束（turn/end + 有最终消息）时把
 * 增强数据发布到 turn location。
 *
 * 0.3 起本 definition 不再产出自有视图节点：折叠条本体由官方
 * `turn-process` renderer 承担（本插件以 priority -1 shadow 接管渲染），
 * 这里只负责把状态机算出的增强事实（用时 / 思考段数 / 终结原因）投喂到
 * Turn location，供 shadow renderer 经 `useTurnData('turn-activity')` 读取。
 */
import type {
  ConversationLocationData,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { TurnActivityAugment } from './activity-augment.ts';
import {
  initialTurnActivityState,
  matchTurnActivity,
  TURN_ACTIVITY_KIND,
  updateTurnActivityState,
  type TurnActivityState,
} from './activity-state.ts';

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** 官方折叠条的增强 face：用时 / 思考段数 / 终结原因。 */
    'turn-activity': TurnActivityAugment;
  }
}

/**
 * state-only definition：不产 view node，因此必须省略 target——官方 register
 * 运行时断言「target 与 buildViewNode 成对出现」（二者皆缺才是 state-only
 * 形状），单独声明 target 会在 apply 时同步 throw。
 */
export function createTurnActivityDefinition(): ConversationNodeDefinition<TurnActivityState> {
  return {
    kind: TURN_ACTIVITY_KIND,
    match: matchTurnActivity,
    start: (_context, match) => {
      if (match.event.type !== 'turn/start') {
        throw new Error('turn-activity start requires turn/start');
      }
      return initialTurnActivityState(match.event.data.turn, match.event.time);
    },
    update: (context, match) => updateTurnActivityState(context.state, match.event),
    // thinking 计数在流式途中虽然增长，但官方折叠条只在轮次封闭后渲染，
    // 中途发布无人消费。一次发布即定型。（理论序「消息晚于 turn/end」下
    // augment 缺席，renderer 退化为纯官方文案——数据缺席不推断。）
    publication: (match) => (match.event.type === 'turn/end' ? 'immediate' : 'none'),
    buildLocationData: (context, scope): ConversationLocationData | null => {
      if (scope !== 'turn' || context.state === undefined) return null;
      const { turn, startTime, end, hasFinalMessage, thinkingSteps } = context.state;
      if (end === undefined || !hasFinalMessage) return null;
      return {
        kind: 'turn',
        turn,
        key: TURN_ACTIVITY_KIND,
        value: {
          durationMs: Math.max(0, end.time - startTime),
          thinkingSteps: thinkingSteps.length,
          reasonKind: end.reasonKind,
        },
      };
    },
  };
}
