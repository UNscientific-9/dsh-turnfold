/**
 * turn-activity 状态机（纯逻辑，DOM-free）。
 *
 * 每个 turn 一个 definition context，由原始 Session 事件流驱动。只跟踪
 * 发布增强 face（用时 / 思考段数 / 终结原因）所需的事实，其余事件一律
 * 忽略——v0.3 起不再自绘 summary 行，anchor / 工具清单 / retry 等字段
 * 已无消费方，全部移除。
 */
import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client';
// 0.1.2：`llm/retry` / `llm/retry-started` 由 dsh-llm-retry 包 augment 进
// SessionEventMap（0.1.1 是内建成员），必须显式导入该类型面。
import type {} from '@deepseek-ai/dsh-llm-retry/types';

/** TurnEndReasonMap kinds known to DSH 0.1.1-rc.2; `(string & {})` keeps the
 *  merge-extensible reason map compatible. */
export type TurnEndReasonKind =
  | 'completed'
  | 'aborted'
  | 'blocked'
  | 'error'
  | 'max-tokens'
  | 'interrupted'
  | (string & {});

/** Per-turn accumulator owned by the definition context. */
export interface TurnActivityState {
  readonly turn: number;
  readonly startTime: number;
  /** 由本 turn 自己的 `turn/end` 设定（晚到的第二个 turn/end 覆盖）。 */
  readonly end: { readonly time: number; readonly reasonKind: TurnEndReasonKind } | undefined;
  /** 是否有过 `assistant/message`——纯工具轮不发布 augment。 */
  readonly hasFinalMessage: boolean;
  /** 流式过至少一个 `reasoning-delta` chunk 的 step（去重）。 */
  readonly thinkingSteps: readonly number[];
}

export const TURN_ACTIVITY_KIND = 'turn-activity';

/** 稳定的 per-turn 身份；`role: 'start'` 只发生在 turn/start。 */
export function matchTurnActivity(
  event: SessionEventLike,
): { id: string; role: 'start' | 'update' } | null {
  switch (event.type) {
    case 'turn/start':
      return { id: String(event.data.turn), role: 'start' };
    case 'turn/end':
    case 'step/start':
    case 'step/end':
    case 'assistant/chunk':
    case 'assistant/message':
    case 'tool/call':
    case 'tool/result':
    case 'llm/retry':
      return { id: String(event.data.turn), role: 'update' };
    default:
      return null;
  }
}

export function initialTurnActivityState(turn: number, time: number): TurnActivityState {
  return { turn, startTime: time, end: undefined, hasFinalMessage: false, thinkingSteps: [] };
}

function pushUnique<T>(list: readonly T[], value: T): readonly T[] {
  return list.includes(value) ? list : [...list, value];
}

/** Apply one post-start event; caller guarantees matchTurnActivity accepted it. */
export function updateTurnActivityState(
  state: TurnActivityState,
  event: SessionEventLike,
): TurnActivityState {
  switch (event.type) {
    case 'turn/end':
      return { ...state, end: { time: event.time, reasonKind: event.data.reason.kind } };
    case 'assistant/message':
      return { ...state, hasFinalMessage: true };
    case 'assistant/chunk':
      return event.data.chunk.type === 'reasoning-delta'
        ? { ...state, thinkingSteps: pushUnique(state.thinkingSteps, event.data.step) }
        : state;
    default:
      // step/start、step/end、tool/call、tool/result、llm/retry 对发布面
      // 无贡献，原样返回。
      return state;
  }
}
