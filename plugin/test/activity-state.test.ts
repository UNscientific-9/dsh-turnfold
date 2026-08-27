import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
import {
  initialTurnActivityState,
  matchTurnActivity,
  shouldAutoCollapse,
  summarizeActivity,
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
  let state = initialTurnActivityState(start.data.turn, start.seq, start.time);
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

test('a completed turn summarizes duration, tools, thinking and final step', () => {
  const t0 = 1000;
  seqCounter = 1000;
  const state = runTurn([
    event('turn/start', { turn: 3 }, t0),
    event('step/start', { turn: 3, step: 0 }, t0 + 100),
    event('assistant/chunk', { turn: 3, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: 'think' } }, t0 + 200),
    event('assistant/chunk', { turn: 3, step: 0, chunk: { type: 'text-delta', index: 1, text: 'hi' } }, t0 + 300),
    event('assistant/message', { turn: 3, step: 0, message: { role: 'assistant', content: [] } }, t0 + 400),
    event('tool/call', { turn: 3, step: 1, callId: 'call-1', name: 'fs', arguments: '{}' }, t0 + 500),
    event('tool/result', { turn: 3, step: 1, message: { role: 'tool', source: { callId: 'call-1' }, content: [] } }, t0 + 600),
    event('tool/call', { turn: 3, step: 2, callId: 'call-2', name: 'bash', arguments: '{}' }, t0 + 700),
    event('tool/result', { turn: 3, step: 2, message: { role: 'tool', source: { callId: 'call-2' }, content: [] } }, t0 + 800),
    event('step/start', { turn: 3, step: 3 }, t0 + 900),
    event('assistant/chunk', { turn: 3, step: 3, chunk: { type: 'reasoning-delta', index: 0, text: 'final think' } }, t0 + 1000),
    event('assistant/chunk', { turn: 3, step: 3, chunk: { type: 'text-delta', index: 1, text: 'done' } }, t0 + 1100),
    event('assistant/message', { turn: 3, step: 3, message: { role: 'assistant', content: [] } }, t0 + 1200),
    event('turn/end', { turn: 3, reason: { kind: 'completed' } }, t0 + 1300),
  ]);

  const summary = summarizeActivity(state);
  assert.ok(summary !== null);
  assert.equal(summary.turn, 3);
  assert.equal(summary.durationMs, 1300);
  assert.equal(summary.toolCount, 2);
  assert.equal(summary.thinkingSteps, 2); // step 0 and step 3
  assert.equal(summary.finalStep, 3);
  assert.equal(summary.reasonKind, 'completed');
  assert.equal(summary.hasFinalMessage, true);
  // The summary anchors at the TOP of the turn (`firstActivitySeq - 0.5`):
  // right after the user/context rows and before the first activity row, so
  // the fold control sits at the turn's head and toggling never moves it.
  // firstActivitySeq = the first VISIBLE activity event (the first chunk,
  // seq 1000+2) — the step/start (1000+1) renders no row and is excluded.
  assert.equal(summary.anchorSeq, 1000 + 2 - 0.5);
  assert.equal(state.firstActivitySeq, 1000 + 2);
  // turn/end comes after the closing message.
  const finalMessageSeq = 1000 + 12;
  assert.ok(summary.endSeq > finalMessageSeq);
  assert.equal(summary.toolCallIds.length, 2);
  assert.equal(shouldAutoCollapse(summary), true);
});

test('aborted / error / interrupted turns never auto-collapse', () => {
  for (const reason of [
    { kind: 'aborted', reason: 'user-stop' },
    { kind: 'error', error: { code: 'E', message: 'boom' } },
    { kind: 'blocked' },
    { kind: 'max-tokens' },
    { kind: 'interrupted' },
  ]) {
    seqCounter = 2000;
    const state = runTurn([
      event('turn/start', { turn: 1 }, 0),
      event('step/start', { turn: 1, step: 0 }, 10),
      event('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: 'x' } }, 20),
      event('assistant/message', { turn: 1, step: 0, message: { role: 'assistant', content: [] } }, 30),
      event('turn/end', { turn: 1, reason }, 40),
    ]);
    const summary = summarizeActivity(state);
    assert.ok(summary !== null, String(reason));
    assert.equal(summary.reasonKind, reason.kind);
    assert.equal(shouldAutoCollapse(summary), false, String(reason));
  }
});

test('a turn without any final message never summarizes', () => {
  seqCounter = 3000;
  const state = runTurn([
    event('turn/start', { turn: 7 }, 0),
    event('tool/call', { turn: 7, step: 0, callId: 'c1', name: 'x', arguments: '{}' }, 10),
    event('tool/result', { turn: 7, step: 0, message: { role: 'tool', source: { callId: 'c1' }, content: [] } }, 20),
    event('turn/end', { turn: 7, reason: { kind: 'completed' } }, 30),
  ]);
  assert.equal(summarizeActivity(state), null);
});

test('interrupted assistant message still marks the turn as having a final message', () => {
  seqCounter = 4000;
  const state = runTurn([
    event('turn/start', { turn: 9 }, 0),
    event('step/start', { turn: 9, step: 0 }, 10),
    event('assistant/chunk', { turn: 9, step: 0, chunk: { type: 'text-delta', index: 0, text: 'partial' } }, 20),
    event('assistant/message', { turn: 9, step: 0, message: { role: 'assistant', content: [] }, interrupted: true }, 30),
    event('turn/end', { turn: 9, reason: { kind: 'aborted', reason: 'user-stop' } }, 40),
  ]);
  const summary = summarizeActivity(state);
  assert.ok(summary !== null);
  assert.equal(summary.hasFinalMessage, true);
  assert.equal(summary.finalStep, 0);
  assert.equal(shouldAutoCollapse(summary), false);
});

test('duplicate tool calls are deduped and keep first-seen order', () => {
  seqCounter = 5000;
  const state = runTurn([
    event('turn/start', { turn: 2 }, 0),
    event('tool/call', { turn: 2, step: 0, callId: 'a', name: 'x', arguments: '{}' }, 10),
    event('tool/result', { turn: 2, step: 0, message: { role: 'tool', source: { callId: 'a' }, content: [] } }, 20),
    event('tool/call', { turn: 2, step: 1, callId: 'b', name: 'x', arguments: '{}' }, 30),
    event('tool/call', { turn: 2, step: 2, callId: 'a', name: 'x', arguments: '{}' }, 40),
    event('tool/result', { turn: 2, step: 2, message: { role: 'tool', source: { callId: 'a' }, content: [] } }, 50),
    event('assistant/chunk', { turn: 2, step: 3, chunk: { type: 'text-delta', index: 0, text: 'ok' } }, 60),
    event('assistant/message', { turn: 2, step: 3, message: { role: 'assistant', content: [] } }, 70),
    event('turn/end', { turn: 2, reason: { kind: 'completed' } }, 80),
  ]);
  const summary = summarizeActivity(state);
  assert.ok(summary !== null);
  assert.deepEqual([...summary.toolCallIds], ['a', 'b']);
  assert.equal(summary.toolCount, 2);
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
  const summary = summarizeActivity(state);
  assert.ok(summary !== null);
  assert.equal(summary.thinkingSteps, 1);
});

test('summarizeActivity does not copy toolCallIds (read-only alias)', () => {
  seqCounter = 7000;
  const state = runTurn([
    event('turn/start', { turn: 2 }, 0),
    event('tool/call', { turn: 2, step: 0, callId: 'a', name: 'x', arguments: '{}' }, 10),
    event('assistant/message', { turn: 2, step: 1, message: { role: 'assistant', content: [] } }, 20),
    event('turn/end', { turn: 2, reason: { kind: 'completed' } }, 30),
  ]);
  const summary = summarizeActivity(state);
  assert.ok(summary !== null);
  // No defensive copy: summary.toolCallIds is the same array reference as the
  // state accumulator's `readonly string[]`.
  assert.equal(summary.toolCallIds, state.toolCallIds);
});

test('lastFinalizeSeq tracks the most recent assistant/message seq', () => {
  seqCounter = 8000;
  const state = runTurn([
    event('turn/start', { turn: 5 }, 0),
    event('step/start', { turn: 5, step: 0 }, 10),
    event('assistant/message', { turn: 5, step: 0, message: { role: 'assistant', content: [] } }, 20),
    event('step/start', { turn: 5, step: 1 }, 30),
    event('assistant/message', { turn: 5, step: 1, message: { role: 'assistant', content: [] } }, 40),
    event('turn/end', { turn: 5, reason: { kind: 'completed' } }, 50),
  ]);
  // The LAST assistant/message seq wins — used as the upper bound for the
  // summary anchor so it always lands strictly before the final answer.
  const expectedFinalize = 8000 + 4; // seq counter starts at 8000, +4 = the 5th event
  assert.equal(state.lastFinalizeSeq, expectedFinalize);
  // Before any assistant/message lands, the field is undefined.
  assert.equal(initialTurnActivityState(99, 1, 0).lastFinalizeSeq, undefined);
});

test('step/end and llm/retry do NOT advance lastActivitySeq', () => {
  seqCounter = 9000;
  const state = runTurn([
    event('turn/start', { turn: 6 }, 0),
    event('step/start', { turn: 6, step: 0 }, 10),
    event('assistant/chunk', { turn: 6, step: 0, chunk: { type: 'text-delta', index: 0, text: 'a' } }, 20),
    event('assistant/message', { turn: 6, step: 0, message: { role: 'assistant', content: [] } }, 30),
    // step/end arrives AFTER the assistant/message finalize (the closing
    // event for a step is always later than the message that closed it).
    event('step/end', { turn: 6, step: 0 }, 40),
    // llm/retry arrives between steps; it can also land after a finalize.
    event('llm/retry', { turn: 6, retry: 1, retryId: 'r1' }, 50),
    event('turn/end', { turn: 6, reason: { kind: 'completed' } }, 60),
  ]);
  // lastActivitySeq must stay at the assistant/chunk (last visible activity
  // before any closing event), strictly LESS than the final assistant/message
  // seq so the summary can land above the final answer.
  const finalizeSeq = 9000 + 3; // turn/start=9000, step/start=9001, chunk=9002, message=9003
  const lastVisibleActivity = 9000 + 2; // the assistant/chunk
  assert.equal(state.lastActivitySeq, lastVisibleActivity);
  assert.ok(state.lastActivitySeq < finalizeSeq, 'lastActivitySeq must precede the finalize seq');
  // step/end and llm/retry still bump the count so the turn's activity volume
  // stays accurate even though they don't move the anchor.
  assert.ok(state.eventCount >= 5);
  // The retry id is recorded so the summary can publish it and the projector
  // can hide the correlated model-retry row when the turn is collapsed.
  assert.deepEqual(state.retryIds, ['r1']);
});

test('llm/retry ids are deduped and published on the summary', () => {
  seqCounter = 9500;
  const state = runTurn([
    event('turn/start', { turn: 7 }, 0),
    event('step/start', { turn: 7, step: 0 }, 10),
    event('llm/retry', { turn: 7, retry: 1, retryId: 'r-a' }, 20),
    event('assistant/chunk', { turn: 7, step: 0, chunk: { type: 'text-delta', index: 0, text: 'a' } }, 30),
    event('llm/retry', { turn: 7, retry: 2, retryId: 'r-b' }, 40),
    event('llm/retry', { turn: 7, retry: 3, retryId: 'r-a' }, 50), // dup retryId
    event('assistant/message', { turn: 7, step: 0, message: { role: 'assistant', content: [] } }, 60),
    event('step/end', { turn: 7, step: 0 }, 70),
    event('turn/end', { turn: 7, reason: { kind: 'completed' } }, 80),
  ]);
  // Duplicates collapse; order is first-seen.
  assert.deepEqual(state.retryIds, ['r-a', 'r-b']);
  const summary = summarizeActivity(state);
  assert.ok(summary !== null);
  assert.deepEqual(summary.retryIds, ['r-a', 'r-b']);
  // A retry never advances the anchor (same rule as step/end): the anchor
  // stays at the top of the turn, before any activity row. The first visible
  // activity event here is the llm/retry itself (seq 9500+2 — the
  // step/start at +1 renders no row and is excluded).
  assert.equal(summary.anchorSeq, 9500 + 2 - 0.5);
  assert.ok(summary.anchorSeq < state.lastFinalizeSeq!);
});

test('lastActivitySeq stays below lastFinalizeSeq for a typical tool-using turn', () => {
  seqCounter = 10000;
  const state = runTurn([
    event('turn/start', { turn: 8 }, 0),
    event('step/start', { turn: 8, step: 0 }, 10),
    event('tool/call', { turn: 8, step: 0, callId: 't1', name: 'x', arguments: '{}' }, 20),
    event('tool/result', { turn: 8, step: 0, message: { role: 'tool', source: { callId: 't1' }, content: [] } }, 30),
    event('assistant/message', { turn: 8, step: 0, message: { role: 'assistant', content: [] } }, 40),
    event('step/end', { turn: 8, step: 0 }, 50),
    event('turn/end', { turn: 8, reason: { kind: 'completed' } }, 60),
  ]);
  // The visible activity chain is tool/result (advances lastActivitySeq).
  // step/end is correctly excluded from advancing it. The summary anchor,
  // however, sits at the TOP of the turn (`firstActivitySeq - 0.5`) so the
  // fold control renders before the activity rows.
  assert.ok(state.lastActivitySeq < state.lastFinalizeSeq!);
  const summary = summarizeActivity(state);
  assert.ok(summary !== null);
  // All tool activity happened before the closing message: the message IS
  // the final answer and stays exempt from collapsing.
  assert.equal(summary.finalStep, 0);
  // First visible activity = the tool/call (seq 10000+2); the step/start
  // (+1) is excluded from anchoring.
  assert.equal(summary.anchorSeq, 10000 + 2 - 0.5);
});

test('a turn ending with tool activity still anchors the summary at the top', () => {
  // 真实 DSH 事件序：assistant/message（含工具调用声明的消息）先到，
  // tool/call / tool/result 后到。无论轮次如何结束，summary 折叠框都锚定
  // 在轮次顶部（firstActivitySeq - 0.5），在用户消息之后、活动行之前。
  seqCounter = 11000;
  const state = runTurn([
    event('turn/start', { turn: 10 }, 0),
    event('step/start', { turn: 10, step: 0 }, 10),
    event('assistant/chunk', { turn: 10, step: 0, chunk: { type: 'text-delta', index: 0, text: 'let me check' } }, 20),
    event('assistant/message', { turn: 10, step: 0, message: { role: 'assistant', content: [] } }, 30),
    event('tool/call', { turn: 10, step: 0, callId: 'c1', name: 'x', arguments: '{}' }, 40),
    event('tool/result', { turn: 10, step: 0, message: { role: 'tool', source: { callId: 'c1' }, content: [] } }, 50),
    event('turn/end', { turn: 10, reason: { kind: 'aborted', reason: 'user-stop' } }, 60),
  ]);
  const summary = summarizeActivity(state);
  assert.ok(summary !== null);
  // First visible activity = the first chunk (seq 11000+2); the pre-step
  // step/start (+1) is excluded.
  assert.equal(summary.anchorSeq, 11000 + 2 - 0.5);
  assert.ok(summary.anchorSeq < state.lastFinalizeSeq!);
  // 最后消息之后仍有工具活动：该消息只是中间步骤，不是最终答案，折叠时
  // 不应豁免任何行。
  assert.equal(summary.finalStep, undefined);
  assert.equal(shouldAutoCollapse(summary), false);
});

test('a trailing tool/call after the final message also invalidates the final step', () => {
  seqCounter = 12000;
  const state = runTurn([
    event('turn/start', { turn: 11 }, 0),
    event('assistant/message', { turn: 11, step: 0, message: { role: 'assistant', content: [] } }, 10),
    event('tool/call', { turn: 11, step: 0, callId: 'c1', name: 'x', arguments: '{}' }, 20),
    event('turn/end', { turn: 11, reason: { kind: 'interrupted' } }, 30),
  ]);
  const summary = summarizeActivity(state);
  assert.ok(summary !== null);
  assert.equal(summary.finalStep, undefined);
  // first activity event is the assistant/message itself (no step/start in
  // this synthetic turn): the anchor is still the turn's top.
  assert.equal(summary.anchorSeq, 12000 + 1 - 0.5);
});

test('tool events arriving after turn/end refresh facts but never move the frozen anchor', () => {
  seqCounter = 13000;
  let state = runTurn([
    event('turn/start', { turn: 12 }, 0),
    event('assistant/chunk', { turn: 12, step: 0, chunk: { type: 'text-delta', index: 0, text: 'hi' } }, 10),
    event('assistant/message', { turn: 12, step: 0, message: { role: 'assistant', content: [] } }, 20),
    event('turn/end', { turn: 12, reason: { kind: 'completed' } }, 30),
  ]);
  const settled = summarizeActivity(state);
  assert.ok(settled !== null);
  const frozenAnchor = settled.anchorSeq;
  // first activity event is the assistant/chunk (seq 13000+1): anchor sits
  // at the turn's top, frozen at turn/end.
  assert.equal(frozenAnchor, 13000 + 1 - 0.5);
  assert.equal(settled.finalStep, 0);
  // 迟到的 tool 事件（turn/end 之后）刷新工具清单与 lastActivitySeq……
  state = updateTurnActivityState(
    state,
    event('tool/call', { turn: 12, step: 1, callId: 'late', name: 'x', arguments: '{}' }, 40),
  );
  const refreshed = summarizeActivity(state);
  assert.ok(refreshed !== null);
  assert.deepEqual([...refreshed.toolCallIds], ['late']);
  // ……但锚点与最终步骤决策保持冻结，summary 行位置稳定。
  assert.equal(refreshed.anchorSeq, frozenAnchor);
  assert.equal(refreshed.finalStep, 0);
});

test('pre-step step/start BEFORE the user/message must not pull the anchor above the user row', () => {
  // 真机实锤的 DSH 事件序（dsh-session: the queued input's user/message
  // "records the messages entering the step"）：loop 先开 turn，再开 pre-step
  // step0，然后才把排队的用户消息落日志。step/start 不产生可见行，必须被
  // 排除在 firstActivitySeq 之外，否则折叠框会渲染到用户消息上方（上一轮
  // 末尾）——turn 5 真机 bug 的直接复现。
  seqCounter = 14000;
  const turnStart = event('turn/start', { turn: 5 }, 0); // seq 14000
  const preStep = event('step/start', { turn: 5, step: 0 }, 10); // seq 14001
  // seq 14002 is reserved for the turn's `user/message` (not fed to the
  // state machine — matchTurnActivity rejects it — but it occupies a seq).
  const userMessageSeq = 14000 + 2;
  void seqCounter++;
  const state = runTurn([
    turnStart,
    preStep,
    event('assistant/chunk', { turn: 5, step: 0, chunk: { type: 'text-delta', index: 0, text: 'hi' } }, 30),
    event('assistant/message', { turn: 5, step: 0, message: { role: 'assistant', content: [] } }, 40),
    event('step/end', { turn: 5, step: 0 }, 50),
    event('turn/end', { turn: 5, reason: { kind: 'completed' } }, 60),
  ]);
  const summary = summarizeActivity(state);
  assert.ok(summary !== null);
  // 锚点必须严格落在用户消息之后（否则折叠框渲染在上一轮末尾）。
  assert.ok(summary.anchorSeq > userMessageSeq, 'anchor must sit BELOW the user row');
  // firstActivitySeq = 第一个可见活动事件（chunk，seq 14003）。
  assert.equal(state.firstActivitySeq, 14000 + 3);
  assert.equal(summary.anchorSeq, 14000 + 3 - 0.5);
});
