/**
 * Chat row identity and turn-activity classification (pure logic, DOM-free).
 *
 * Every rendered Chat node row carries `data-chat-anchor-key` whose value is
 * `conversationContextKey(kind, id)` — `<kind.length>:<kind><id>` (verified in
 * the DSH chat seat, 0.1.2 的 ui-chat ChatNodeSeat 仍渲染同一属性). We parse
 * that key back into kind + id and decide whether the row belongs to a given
 * turn's collapsible activity region, is the turn's final answer (never
 * hidden), or is unrelated.
 */
import type { TurnActivitySummary } from './activity-state.ts';

export interface ParsedChatRowKey {
  readonly kind: string;
  readonly id: string;
}

/** Parse `conversationContextKey(kind, id)` back into its parts. */
export function parseChatRowKey(key: string): ParsedChatRowKey | null {
  const colon = key.indexOf(':');
  if (colon < 0) return null;
  const lenText = key.slice(0, colon);
  if (lenText === '' || !/^\d+$/.test(lenText)) return null;
  const kindLength = Number.parseInt(lenText, 10);
  if (!Number.isFinite(kindLength) || kindLength < 1) return null;
  // The key must be long enough to actually carry the declared kind after the
  // colon; otherwise we'd happily slice a shorter string and return a phantom
  // kind/id pair (e.g. for truncated or future-format keys).
  if (key.length < colon + 1 + kindLength) return null;
  const kind = key.slice(colon + 1, colon + 1 + kindLength);
  const id = key.slice(colon + 1 + kindLength);
  if (id.length === 0) return null;
  return { kind, id };
}

/** Result of classifying one rendered row against one turn summary. */
export type RowRole = 'activity' | 'final' | 'other';

/** assistant-step identity is `<turn>:<step>` (assistantDefinition match). */
const ASSISTANT_ID = /^(\d+):(\d+)$/;

/**
 * Classify a row. `'activity'` rows are hidden when the turn is collapsed;
 * `'final'` is the final answer row and is NEVER hidden; `'other'` (user
 * messages, turn-tail, turn-error, retries, commands, …) is never touched.
 */
export function classifyTurnRow(
  key: string,
  summary: TurnActivitySummary,
): RowRole {
  const parsed = parseChatRowKey(key);
  if (parsed === null) return 'other';
  if (parsed.kind === 'assistant-step') {
    const match = ASSISTANT_ID.exec(parsed.id);
    if (match === null) return 'other';
    const turn = Number(match[1]);
    const step = Number(match[2]);
    if (turn !== summary.turn) return 'other';
    if (summary.finalStep !== undefined && step === summary.finalStep) return 'final';
    return 'activity';
  }
  if (parsed.kind === 'tool-call') {
    return summary.toolCallIds.includes(parsed.id) ? 'activity' : 'other';
  }
  return 'other';
}
