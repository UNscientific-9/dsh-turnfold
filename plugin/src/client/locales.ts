/** Locale dictionaries owned by this plugin (Chinese is the key-set source of truth). */
export const NS = 'turnActivity';

/** en 经 satisfies 强制覆盖 zh 全部键——双语键集漂移在编译期暴露。 */
export type TurnActivityKey = keyof typeof zh;

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    turnActivity: TurnActivityKey;
  }
}

/**
 * Stable locale tag emitted by the dictionaries (`turnActivity.durationLocale`
 * key): `'zh'` or `'en'`. The fold-bar view uses it to pick a duration
 * formatter that matches the rest of the label.
 */

/**
 * 键集对齐官方折叠条文案的语义（计数段 one/other 二分 + 分隔符 + 全零
 * 兜底），另加增强段（用时/思考段数）。计数段全走 `{count}` 插值。
 */
export const zh = {
  'turnActivity.durationLocale': 'zh',
  'turnActivity.bar.toolCallsOne': '{count} 次工具调用',
  'turnActivity.bar.toolCallsOther': '{count} 次工具调用',
  'turnActivity.bar.messagesOne': '{count} 条消息',
  'turnActivity.bar.messagesOther': '{count} 条消息',
  'turnActivity.bar.subagentsOne': '{count} 个 subagent',
  'turnActivity.bar.subagentsOther': '{count} 个 subagent',
  'turnActivity.bar.thoughtForAWhile': '已思考',
  'turnActivity.bar.separator': ' · ',
  'turnActivity.bar.duration': '用时 {time}',
  'turnActivity.bar.thinkingOne': '{count} 段思考',
  'turnActivity.bar.thinkingOther': '{count} 段思考',
} as const satisfies Record<string, string>;

export const en = {
  'turnActivity.durationLocale': 'en',
  'turnActivity.bar.toolCallsOne': '{count} tool call',
  'turnActivity.bar.toolCallsOther': '{count} tool calls',
  'turnActivity.bar.messagesOne': '{count} message',
  'turnActivity.bar.messagesOther': '{count} messages',
  'turnActivity.bar.subagentsOne': '{count} subagent',
  'turnActivity.bar.subagentsOther': '{count} subagents',
  'turnActivity.bar.thoughtForAWhile': 'Thought for a while',
  'turnActivity.bar.separator': ' · ',
  'turnActivity.bar.duration': 'took {time}',
  'turnActivity.bar.thinkingOne': '{count} thinking segment',
  'turnActivity.bar.thinkingOther': '{count} thinking segments',
} as const satisfies { [K in keyof typeof zh]: string };
