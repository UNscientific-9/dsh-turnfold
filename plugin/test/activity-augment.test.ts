import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeFoldBarLabel,
  isCompletedOnlyEnabled,
  shouldForceExpand,
  COMPLETED_ONLY_KEY,
  type FoldBarTextKit,
} from '../src/client/activity-augment.ts';
import type { TurnActivityAugment } from '../src/client/activity-augment.ts';

/** t 记录调用键并按 zh 字典形状返回（测试只关心键选择与插值透传）。 */
function makeKit(calls: string[] = []): FoldBarTextKit & { calls: string[] } {
  return {
    calls,
    t(key: string, params?: Record<string, unknown>): string {
      calls.push(key);
      if (key === 'turnActivity.bar.separator') return ' · ';
      if (params === undefined) return key;
      return `${key}(${Object.entries(params).map(([k, v]) => `${k}=${String(v)}`).join(',')})`;
    },
    formatDuration: (ms: number) => `DUR${ms}`,
  };
}

const countsAll = { messageCount: 2, toolCallCount: 3, subagentCount: 1 };
const augment: TurnActivityAugment = { durationMs: 65_000, thinkingSteps: 4, reasonKind: 'completed' };

test('composeFoldBarLabel mirrors the official segment order with counts', () => {
  const kit = makeKit();
  const { base, augment: aug } = composeFoldBarLabel(countsAll, augment, kit);
  assert.equal(
    base,
    'turnActivity.bar.toolCallsOther(count=3) · turnActivity.bar.messagesOther(count=2) · turnActivity.bar.subagentsOne(count=1)',
  );
  assert.equal(aug, 'turnActivity.bar.duration(time=DUR65000) · turnActivity.bar.thinkingOther(count=4)');
  // 官方段序：toolCalls → messages → subagents。
  assert.deepEqual(kit.calls.slice(0, 3), [
    'turnActivity.bar.toolCallsOther',
    'turnActivity.bar.messagesOther',
    'turnActivity.bar.subagentsOne',
  ]);
});

test('composeFoldBarLabel uses the singular keys at count 1', () => {
  const { base, augment: aug } = composeFoldBarLabel(
    { messageCount: 1, toolCallCount: 1, subagentCount: 0 },
    { durationMs: 0, thinkingSteps: 1, reasonKind: 'completed' },
    makeKit(),
  );
  assert.match(base, /toolCallsOne\(count=1\)/);
  assert.match(base, /messagesOne\(count=1\)/);
  assert.match(aug, /thinkingOne\(count=1\)/);
});

test('composeFoldBarLabel falls back to thoughtForAWhile when all counts are zero', () => {
  const { base, augment: aug } = composeFoldBarLabel(
    { messageCount: 0, toolCallCount: 0, subagentCount: 0 },
    undefined,
    makeKit(),
  );
  assert.equal(base, 'turnActivity.bar.thoughtForAWhile');
  assert.equal(aug, '', 'augment absent -> no augment segment');
});

test('composeFoldBarLabel omits the thinking segment when zero', () => {
  const { augment: aug } = composeFoldBarLabel(
    countsAll,
    { durationMs: 1200, thinkingSteps: 0, reasonKind: 'completed' },
    makeKit(),
  );
  assert.equal(aug, 'turnActivity.bar.duration(time=DUR1200)');
});

test('shouldForceExpand fires only for known non-completed reasons while enabled', () => {
  assert.equal(shouldForceExpand('aborted', true), true);
  assert.equal(shouldForceExpand('error', true), true);
  assert.equal(shouldForceExpand('completed', true), false);
  assert.equal(shouldForceExpand(undefined, true), false, 'augment not ready -> follow official');
  assert.equal(shouldForceExpand('aborted', false), false, 'switch off -> follow official');
});

test('isCompletedOnlyEnabled reads the switch with off as the default', () => {
  const storage = (value: string | null) =>
    ({ getItem: (k: string) => (k === COMPLETED_ONLY_KEY ? value : null) }) as Storage;
  assert.equal(isCompletedOnlyEnabled(storage('1')), true);
  assert.equal(isCompletedOnlyEnabled(storage('0')), false);
  assert.equal(isCompletedOnlyEnabled(storage(null)), false);
  assert.equal(isCompletedOnlyEnabled(undefined), false);
});
