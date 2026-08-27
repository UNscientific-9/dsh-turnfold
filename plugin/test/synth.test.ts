import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSyntheticSummaries,
  synthLabel,
  type SynthSourceRow,
} from '../src/client/synth.ts';

function row(key: string, kind = ''): SynthSourceRow {
  return { key, kind, element: { __key: key } as unknown as HTMLElement };
}

function cachedRef(
  turn: number,
  finalStep: number | undefined,
  toolCallIds: readonly string[],
  retryIds: readonly string[] = [],
): { finalStep: number | undefined; toolCallIds: readonly string[]; retryIds: readonly string[] } {
  return { finalStep, toolCallIds, retryIds };
}

test('a window-cut turn (no turn/start) yields a synthesized summary', () => {
  // Real live-session shape: the window starts mid-turn-4; turn 5's
  // turn/start is outside the window, its first visible row is 5:1.
  const rows = [
    row('13:input-messagea99a', 'user'),
    row('14:assistant-step4:20'),
    row('9:tool-callcall-A'),
    row('9:tool-callcall-B'),
    row('14:assistant-step4:23'),
    row('9:turn-tail4'),
    row('13:input-message39d2', 'user'),
    row('14:assistant-step5:1'),
    row('9:tool-callcall-C'),
    row('9:turn-tail5'),
  ];
  const synth = computeSyntheticSummaries(rows, new Map(), new Map(), 'sess-1');
  assert.deepEqual([...synth.keys()].sort(), [4, 5]);
  const t5 = synth.get(5)!;
  assert.equal(t5.turn, 5);
  assert.equal(t5.finalStep, 1);
  assert.deepEqual([...t5.toolCallIds], ['call-C']);
  assert.equal(t5.stepCount, 1);
  assert.equal(t5.sessionId, 'sess-1');
  assert.equal(t5.fromCache, false);
  // anchor = the turn's first visible activity row (5:1), never the user row
  assert.equal((t5.anchorRow as unknown as { __key: string }).__key, '14:assistant-step5:1');
});

test('a running turn (no turn-tail row) is never synthesized', () => {
  const rows = [
    row('9:turn-tail3'),
    row('13:input-messagex', 'user'),
    row('14:assistant-step4:1'),
    row('9:tool-callcall-run'),
    // no turn-tail4 — the turn is still streaming
  ];
  const synth = computeSyntheticSummaries(rows, new Map(), new Map(), null);
  assert.deepEqual([...synth.keys()], []);
});

test('tool rows before the turn\u2019s first step row stay out of the previous turn', () => {
  // A tool row's anchor can sort before the owning step's row; flow order
  // must not attribute it to the previous turn (pending queue).
  const rows = [
    row('14:assistant-step4:2'),
    row('9:tool-callcall-late4'),
    row('9:turn-tail4'),
    row('9:tool-callcall-early5'),
    row('14:assistant-step5:1'),
    row('9:turn-tail5'),
  ];
  const synth = computeSyntheticSummaries(rows, new Map(), new Map(), null);
  assert.deepEqual(synth.get(4)!.toolCallIds, ['call-late4']);
  assert.deepEqual(synth.get(5)!.toolCallIds, ['call-early5']);
});

test('turns with a real summary row in the DOM are skipped; cache wins for facts', () => {
  const rows = [
    row('14:assistant-step6:1'),
    row('9:tool-callcall-x'),
    row('9:turn-tail6'),
    row('14:assistant-step7:2'),
    row('9:tool-callcall-y'),
    row('9:turn-tail7'),
  ];
  const domTurns = new Map([[6, true]]);
  const cached = new Map([[7, cachedRef(7, 1, ['call-accurate'], ['r1'])]]);
  const synth = computeSyntheticSummaries(rows, domTurns, cached, 's');
  // turn 6 has a real bar in the DOM -> skipped; turn 7 synthesized with
  // the cached (accurate) final step, tools and retry ids.
  assert.deepEqual([...synth.keys()], [7]);
  const t7 = synth.get(7)!;
  assert.equal(t7.finalStep, 1);
  assert.deepEqual([...t7.toolCallIds], ['call-accurate']);
  assert.deepEqual([...t7.retryIds], ['r1']);
  assert.equal(t7.fromCache, true);
  assert.equal(t7.stepCount, 1);
});

test('duplicate tool ids collapse and finalStep falls back to the max step', () => {
  const rows = [
    row('14:assistant-step8:1'),
    row('9:tool-calldup'),
    row('9:tool-calldup'),
    row('14:assistant-step8:3'),
    row('14:assistant-step8:5'),
    row('9:turn-tail8'),
  ];
  const synth = computeSyntheticSummaries(rows, new Map(), new Map(), null);
  const t8 = synth.get(8)!;
  assert.deepEqual([...t8.toolCallIds], ['dup']);
  assert.equal(t8.finalStep, 5);
  assert.equal(t8.stepCount, 3);
});

test('malformed and unrelated keys are ignored', () => {
  const rows = [
    row('garbage'),
    row('call:call_00_xx'),
    row('14:assistant-stepbad'),
    row('9:turn-tail9'),
    row('14:assistant-step9:2'),
    row('9:turn-tail9'),
  ];
  const synth = computeSyntheticSummaries(rows, new Map(), new Map(), null);
  assert.deepEqual([...synth.keys()], [9]);
  assert.equal(synth.get(9)!.finalStep, 2);
});

test('synthLabel is bilingual with a tool segment only when tools exist', () => {
  const zhWithTools = synthLabel(3, 2, 'zh-CN');
  const zhNoTools = synthLabel(3, 0, 'zh-CN');
  const enWithTools = synthLabel(3, 2, 'en-US');
  assert.ok(zhWithTools.includes('执行步骤 3') && zhWithTools.includes('工具 2'));
  assert.equal(zhNoTools, '执行步骤 3');
  assert.ok(enWithTools.includes('3 steps') && enWithTools.includes('2 tools'));
});
