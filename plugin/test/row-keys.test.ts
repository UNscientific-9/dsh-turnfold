import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTurnRow, parseChatRowKey } from '../src/client/row-keys.ts';
import type { TurnActivitySummary } from '../src/client/activity-state.ts';

const summary: TurnActivitySummary = {
  turn: 5,
  startSeq: 1,
  endSeq: 99,
  durationMs: 1000,
  toolCount: 2,
  thinkingSteps: 1,
  hasFinalMessage: true,
  reasonKind: 'completed',
  finalStep: 3,
  toolCallIds: ['call-aa', 'call-bb'],
};

test('parseChatRowKey round-trips conversationContextKey shapes', () => {
  assert.deepEqual(parseChatRowKey('14:assistant-step5:3'), { kind: 'assistant-step', id: '5:3' });
  assert.deepEqual(parseChatRowKey('9:tool-callcall-aa'), { kind: 'tool-call', id: 'call-aa' });
  assert.deepEqual(parseChatRowKey('9:turn-tail5'), { kind: 'turn-tail', id: '5' });
  assert.equal(parseChatRowKey(''), null);
  assert.equal(parseChatRowKey('garbage'), null);
  assert.equal(parseChatRowKey('x:abc'), null); // non-numeric length
});

test('parseChatRowKey rejects truncated or future-format keys', () => {
  // Declared kind length is 14 but the key is only long enough for 5 chars
  // after the colon — would have silently returned a phantom {kind, id}.
  assert.equal(parseChatRowKey('14:assis'), null);
  // Empty id is not a valid row identity.
  assert.equal(parseChatRowKey('9:tool-call'), null);
  assert.equal(parseChatRowKey('0:'), null); // kind length 0 is rejected
});

test('assistant-step rows: activity vs final vs other turn', () => {
  assert.equal(classifyTurnRow('14:assistant-step5:1', summary), 'activity');
  assert.equal(classifyTurnRow('14:assistant-step5:3', summary), 'final');
  assert.equal(classifyTurnRow('14:assistant-step5:4', summary), 'activity');
  assert.equal(classifyTurnRow('14:assistant-step6:1', summary), 'other');
  assert.equal(classifyTurnRow('14:assistant-step5:0', summary), 'activity');
});

test('tool-call rows: activity when the call belongs to the turn', () => {
  assert.equal(classifyTurnRow('9:tool-callcall-aa', summary), 'activity');
  assert.equal(classifyTurnRow('9:tool-callcall-bb', summary), 'activity');
  assert.equal(classifyTurnRow('9:tool-callcall-zz', summary), 'other');
});

test('unrelated kinds are never touched', () => {
  for (const key of ['9:turn-tail5', '10:turn-error5', '4:user5', '11:model-retry5:0']) {
    assert.equal(classifyTurnRow(key, summary), 'other', key);
  }
});

test('a turn without a final step keeps every assistant row as activity', () => {
  const noFinal: TurnActivitySummary = { ...summary, finalStep: undefined };
  assert.equal(classifyTurnRow('14:assistant-step5:3', noFinal), 'activity');
});
