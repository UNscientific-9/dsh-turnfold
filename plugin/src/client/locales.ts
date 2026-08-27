/** Locale dictionaries owned by this plugin (Chinese is the key-set source of truth). */
export const NS = 'turnActivity';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    turnActivity: unknown;
  }
}

/**
 * Stable locale tag emitted by the dictionaries. The React view uses it to
 * pick a duration formatter that matches the rest of the summary text, even
 * when the user's `navigator.language` is set to a different language.
 */
export type DurationLocaleTag = 'zh' | 'en';

export const zh = {
  'turnActivity.durationLocale': 'zh',
  'turnActivity.summary': '本轮用时 {time} · {tools} 次工具 · {thinking} 段思考',
  'turnActivity.summaryNoTools': '本轮用时 {time} · {thinking} 段思考',
  'turnActivity.summaryNoThinking': '本轮用时 {time} · {tools} 次工具',
  'turnActivity.summaryPlain': '本轮用时 {time}',
  'turnActivity.toggleExpand': '展开本轮执行过程',
  'turnActivity.toggleCollapse': '收起本轮执行过程',
  'turnActivity.divider': '本轮执行过程与最终回答的分隔线',
} as const satisfies Record<string, string>;

export const en = {
  'turnActivity.durationLocale': 'en',
  'turnActivity.summary': 'This turn {time} · {tools} tool calls · {thinking} thinking segments',
  'turnActivity.summaryNoTools': 'This turn {time} · {thinking} thinking segments',
  'turnActivity.summaryNoThinking': 'This turn {time} · {tools} tool calls',
  'turnActivity.summaryPlain': 'This turn {time}',
  'turnActivity.toggleExpand': 'Expand this turn\'s activity',
  'turnActivity.toggleCollapse': 'Collapse this turn\'s activity',
  'turnActivity.divider': 'Divider between activity and the final answer',
} as const satisfies Record<string, string>;
