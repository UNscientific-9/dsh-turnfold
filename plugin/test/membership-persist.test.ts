import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelMembershipFlushForTest,
  MEMBERSHIP_STORAGE_KEY,
  readMembershipMap,
  recordMembershipForPersist,
} from '../src/client/membership-persist.ts';
import type { SummaryRef } from '../src/client/projector.ts';

function fakeStorage(): { store: Map<string, string>; getItem(k: string): string | null; setItem(k: string, v: string): void } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
  };
}

function ref(turn: number, sessionId: string): SummaryRef {
  return { turn, finalStep: turn + 1, toolCallIds: [`c${turn}`], retryIds: [], sessionId };
}

test('readMembershipMap returns an empty map without storage or on corrupt data', () => {
  assert.equal(readMembershipMap(undefined).size, 0);
  const storage = fakeStorage();
  storage.store.set(MEMBERSHIP_STORAGE_KEY, '{not json');
  assert.equal(readMembershipMap(storage as unknown as Storage).size, 0);
  storage.store.set(MEMBERSHIP_STORAGE_KEY, JSON.stringify({ s: { x: { tools: 'bad' } } }));
  assert.equal(readMembershipMap(storage as unknown as Storage).size, 0);
});

test('recordMembershipForPersist debounces a lossless round-trip', async () => {
  const storage = fakeStorage();
  recordMembershipForPersist(storage as unknown as Storage, 'sess-A', ref(5, 'sess-A'));
  recordMembershipForPersist(storage as unknown as Storage, 'sess-A', ref(6, 'sess-A'));
  recordMembershipForPersist(storage as unknown as Storage, 'sess-B', ref(1, 'sess-B'));
  // Debounced: nothing written synchronously.
  assert.equal(storage.store.size, 0);
  cancelMembershipFlushForTest();
  // Re-record with the timer cancelled would leave nothing; use a short
  // manual flush by recording and awaiting past the delay.
  recordMembershipForPersist(storage as unknown as Storage, 'sess-A', ref(5, 'sess-A'));
  await new Promise((r) => setTimeout(r, 700));
  const restored = readMembershipMap(storage as unknown as Storage);
  assert.equal(restored.get('sess-A')?.size, 2);
  assert.deepEqual(restored.get('sess-A')?.get(5), {
    turn: 5,
    finalStep: 6,
    toolCallIds: ['c5'],
    retryIds: [],
    sessionId: 'sess-A',
  });
  assert.equal(restored.get('sess-B')?.size, 1);
  cancelMembershipFlushForTest();
});

test('readMembershipMap rejects entries with malformed fields', () => {
  const storage = fakeStorage();
  storage.store.set(
    MEMBERSHIP_STORAGE_KEY,
    JSON.stringify({
      good: {
        '3': { finalStep: 2, tools: ['a'], retries: [] },
        'bad-final': { finalStep: 'x', tools: [], retries: [] },
        'bad-tools': { finalStep: 1, tools: [1, 2], retries: [] },
        'no-arrays': { finalStep: 1 },
      },
    }),
  );
  const restored = readMembershipMap(storage as unknown as Storage);
  assert.equal(restored.get('good')?.size, 1);
  assert.ok(restored.get('good')?.has(3));
});
