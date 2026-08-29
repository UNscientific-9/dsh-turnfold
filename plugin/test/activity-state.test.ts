import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
import {
  initialTurnActivityState,
  matchTurnActivity,
  updateTurnActivityState,
  type TurnActivityState,
} from '../src/client/activity-state.ts';

let seqCounter = 1000;

function event(
  type: SessionEvent['type'],
  data: Record<string, unknown>,
  time = 0,
): SessionEvent {
  return { type, seq: seqCounter++, time, data } as unknown as SessionEvent;
}

function runTurn(events: SessionEvent[]): TurnActivityState {
  const start = events[0];
  assert.equal(start.type, 'turn/start');
  let state = initialTurnActivityState(start.data.turn, start.time);
  for (const e of events.slice(1)) {
    assert.notEqual(matchTurnActivity(e), null, `event ${e.type} should match`);
    state = updateTurnActivityState(state, e);
  }
  return state;
}

test('matchTurnActivity accepts the turn lifecycle and activity events', () => {
  assert.deepEqual(matchTurnActivity(event('turn/start', { turn: 1 })), { id: '1', role: 'start' });
  for (const type of ['turn/end', 'step/start', 'step/end', 'assistant/chunk', 'assistant/message', 'tool/call', 'tool/result', 'llm/retry'] as const) {
    const e = event(type, { turn: 1, step: 0 });
    assert.deepEqual(matchTurnActivity(e), { id: '1', role: 'update' }, type);
  }
  assert.equal(matchTurnActivity(event('user/message', { turn: 1, message: {} })), null);
  assert.equal(matchTurnActivity(event('agent/start', { turn: 1 })), null);
});

test('reasoning-delta steps are counted once per step', () => {
  seqCounter = 6000;
  const state = runTurn([
    event('turn/start', { turn: 4 }, 0),
    event('step/start', { turn: 4, step: 0 }, 10),
    event('assistant/chunk', { turn: 4, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: 'a' } }, 20),
    event('assistant/chunk', { turn: 4, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: 'b' } }, 30),
    event('assistant/chunk', { turn: 4, step: 0, chunk: { type: 'usage', usage: {} } }, 40),
    event('assistant/message', { turn: 4, step: 0, message: { role: 'assistant', content: [] } }, 50),
    event('turn/end', { turn: 4, reason: { kind: 'completed' } }, 60),
  ]);
  assert.deepEqual(state.thinkingSteps, [0]);
});

test('a completed turn captures duration and reason', () => {
  seqCounter = 7000;
  const state = runTurn([
    event('turn/start', { turn: 3 }, 1000),
    event('assistant/chunk', { turn: 3, step: 0, chunk: { type: 'text-delta', index: 0, text: 'hi' } }, 1100),
    event('assistant/message', { turn: 3, step: 0, message: { role: 'assistant', content: [] } }, 1200),
    event('turn/end', { turn: 3, reason: { kind: 'completed' } }, 1300),
  ]);
  assert.equal(state.end?.time, 1300);
  assert.equal(state.end?.reasonKind, 'completed');
  assert.equal(state.hasFinalMessage, true);
  assert.deepEqual(state.thinkingSteps, []);
});

test('a tool-only turn without a final message stays unpublished', () => {
  seqCounter = 8000;
  const state = runTurn([
    event('turn/start', { turn: 7 }, 0),
    event('tool/call', { turn: 7, step: 0, callId: 'c1', name: 'x', arguments: '{}' }, 10),
    event('tool/result', { turn: 7, step: 0, message: { role: 'tool', source: { callId: 'c1' }, content: [] } }, 20),
    event('turn/end', { turn: 7, reason: { kind: 'completed' } }, 30),
  ]);
  assert.equal(state.hasFinalMessage, false);
});

test('a later turn/end overwrites the recorded reason', () => {
  seqCounter = 9000;
  const state = runTurn([
    event('turn/start', { turn: 6 }, 0),
    event('assistant/message', { turn: 6, step: 0, message: { role: 'assistant', content: [] } }, 10),
    event('turn/end', { turn: 6, reason: { kind: 'aborted', reason: 'user-stop' } }, 20),
    event('turn/end', { turn: 6, reason: { kind: 'completed' } }, 30),
  ]);
  assert.equal(state.end?.reasonKind, 'completed');
});
