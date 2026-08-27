import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectSummaries,
  computeRowTargets,
  DATA_SESSION,
  mergeCached,
  pickSummaryRowBySession,
  rememberMembership,
  type RowWithElement,
  type SummaryRef,
} from '../src/client/projector.ts';

function row(key: string, kind = ''): RowWithElement {
  return { key, kind, element: {} as HTMLElement };
}

function collectFrom(attrs: Array<Record<string, string | number>>): ReadonlyMap<number, SummaryRef> {
  const fake = {
    querySelectorAll(selector: string): HTMLElement[] {
      assert.equal(selector, '[data-dsh-ta-turn]');
      return attrs.map((a) => {
        const el = { getAttribute: (name: string) => String(a[name] ?? '') } as unknown as HTMLElement;
        return el;
      });
    },
  } as unknown as ParentNode;
  return collectSummaries(fake);
}

test('collectSummaries reads membership facts off summary rows', () => {
  const map = collectFrom([
    { 'data-dsh-ta-turn': 3, 'data-dsh-ta-final-step': 5, 'data-dsh-ta-tools': 'c1,c2', 'data-dsh-ta-retries': 'r1,r2' },
    { 'data-dsh-ta-turn': 4, 'data-dsh-ta-final-step': '', 'data-dsh-ta-tools': '', 'data-dsh-ta-retries': '' },
    { 'data-dsh-ta-turn': 5, 'data-dsh-ta-final-step': 1, 'data-dsh-ta-tools': '', 'data-dsh-ta-session': 'sess-A' },
  ]);
  assert.equal(map.size, 3);
  assert.deepEqual(map.get(3), { turn: 3, finalStep: 5, toolCallIds: ['c1', 'c2'], retryIds: ['r1', 'r2'], sessionId: undefined });
  assert.deepEqual(map.get(4), { turn: 4, finalStep: undefined, toolCallIds: [], retryIds: [], sessionId: undefined });
  assert.deepEqual(map.get(5), { turn: 5, finalStep: 1, toolCallIds: [], retryIds: [], sessionId: 'sess-A' });
});

test('computeRowTargets hides model-retry rows owned by a collapsed turn', () => {
  // `model-retry` rows carry only their random retryId in the key; ownership
  // comes from the summary's published retry ids. This closes the "missing
  // fold" gap where the retry notice stayed visible mid-activity.
  const summaries = collectFrom([
    { 'data-dsh-ta-turn': 5, 'data-dsh-ta-final-step': 3, 'data-dsh-ta-tools': '', 'data-dsh-ta-retries': 'rA,rB' },
  ]);
  const rows = [
    row('11:model-retryrA'),
    row('11:model-retryrB'),
    row('11:model-retryrZ'), // another turn's retry
    row('9:turn-tail5'),
  ];
  const targets = computeRowTargets(rows, summaries, (turn) => turn === 5);
  assert.deepEqual(rows.map((r) => targets.get(r)), [true, true, false, false]);
  // Expanded turn: nothing is hidden.
  const targetsExpanded = computeRowTargets(rows, summaries, () => false);
  assert.deepEqual(rows.map((r) => targetsExpanded.get(r)), [false, false, false, false]);
});

test('computeRowTargets hides activity rows of collapsed turns only', () => {
  const summaries = collectFrom([{ 'data-dsh-ta-turn': 5, 'data-dsh-ta-final-step': 3, 'data-dsh-ta-tools': 'call-aa' }]);
  const rows = [
    row('14:assistant-step5:1'),
    row('14:assistant-step5:3', 'assistant-step'),
    row('9:tool-callcall-aa'),
    row('9:turn-tail5'),
    row('14:assistant-step6:0'),
  ];
  const targets = computeRowTargets(rows, summaries, (turn) => turn === 5);
  assert.deepEqual(
    rows.map((r) => targets.get(r)),
    [true, false, true, false, false],
  );
});

test('computeRowTargets keeps everything visible when no turn is collapsed', () => {
  const summaries = collectFrom([{ 'data-dsh-ta-turn': 5, 'data-dsh-ta-final-step': 3, 'data-dsh-ta-tools': 'call-aa' }]);
  const rows = [row('14:assistant-step5:1'), row('9:tool-callcall-aa')];
  const targets = computeRowTargets(rows, summaries, () => false);
  assert.deepEqual(rows.map((r) => targets.get(r)), [false, false]);
});

test('computeRowTargets never hides the final row even when collapsed', () => {
  const summaries = collectFrom([{ 'data-dsh-ta-turn': 5, 'data-dsh-ta-final-step': 3, 'data-dsh-ta-tools': '' }]);
  const rows = [row('14:assistant-step5:3'), row('14:assistant-step5:2')];
  const targets = computeRowTargets(rows, summaries, () => true);
  assert.deepEqual(rows.map((r) => targets.get(r)), [false, true]);
});

test('malformed keys are treated as untouchable', () => {
  const summaries = collectFrom([{ 'data-dsh-ta-turn': 5, 'data-dsh-ta-final-step': 3, 'data-dsh-ta-tools': '' }]);
  const rows = [row(''), row('garbage'), row('3:xx')];
  const targets = computeRowTargets(rows, summaries, () => true);
  assert.deepEqual(rows.map((r) => targets.get(r)), [false, false, false]);
});

test('mergeCached fills in turns whose summary row is missing from the DOM', () => {
  // Paged/windowed conversations can render activity rows while the summary
  // row is absent; the snapshot cache keeps those turns foldable.
  rememberMembership('sess-cache', {
    turn: 7,
    finalStep: 2,
    toolCallIds: ['c7'],
    retryIds: ['r7'],
    sessionId: 'sess-cache',
  });
  rememberMembership('sess-cache', {
    turn: 8,
    finalStep: undefined,
    toolCallIds: [],
    retryIds: [],
    sessionId: 'sess-cache',
  });
  // DOM summaries: only turn 9 rendered.
  const dom = collectFrom([{ 'data-dsh-ta-turn': 9, 'data-dsh-ta-final-step': 1, 'data-dsh-ta-session': 'sess-cache' }]);
  const merged = mergeCached(dom, 'sess-cache');
  assert.deepEqual([...merged.keys()].sort(), [7, 8, 9]);
  assert.equal(merged.get(7)?.finalStep, 2);
  assert.deepEqual(merged.get(7)?.toolCallIds, ['c7']);
  assert.deepEqual(merged.get(7)?.retryIds, ['r7']);
  // DOM facts win over cached ones.
  rememberMembership('sess-cache', {
    turn: 9,
    finalStep: 99, // stale cached value
    toolCallIds: [],
    retryIds: [],
    sessionId: 'sess-cache',
  });
  const mergedAgain = mergeCached(dom, 'sess-cache');
  assert.equal(mergedAgain.get(9)?.finalStep, 1);
  // Wrong session / null session: cache never leaks across sessions.
  assert.equal(mergeCached(dom, 'sess-other').has(7), false);
  assert.equal(mergeCached(dom, null).has(7), false);
});

test('pickSummaryRowBySession prefers the row rendered for the caller session', () => {
  const fakeRow = (sessionId?: string) =>
    ({
      getAttribute: (name: string) =>
        name === DATA_SESSION ? (sessionId ?? null) : null,
    }) as unknown as HTMLElement;
  const sessA = fakeRow('sess-A');
  const sessB = fakeRow('sess-B');
  const legacy = fakeRow();
  // Two columns render the same turn number for different sessions; the
  // caller's session must win so the decision lands on the right column.
  assert.equal(pickSummaryRowBySession([sessA, sessB], 'sess-B'), sessB);
  assert.equal(pickSummaryRowBySession([sessA, sessB], 'sess-A'), sessA);
  // No session matches (stale caller session): first row, old behavior.
  assert.equal(pickSummaryRowBySession([sessA, sessB], 'sess-C'), sessA);
  // Legacy rows without the attribute: first row still wins.
  assert.equal(pickSummaryRowBySession([legacy, sessA], 'sess-A'), sessA);
  assert.equal(pickSummaryRowBySession([legacy], 'sess-A'), legacy);
  assert.equal(pickSummaryRowBySession([legacy], null), legacy);
  assert.equal(pickSummaryRowBySession([], 'sess-A'), null);
});
