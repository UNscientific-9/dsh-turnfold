import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStoragePersistence,
  readPersistedTurn,
  STORAGE_KEY,
  withPersistedTurn,
  type CollapsePersistence,
} from '../src/client/persist.ts';

function memoryStorage(): { storage: Storage; snapshot: Map<string, string> } {
  const snapshot = new Map<string, string>();
  const storage = {
    getItem(key: string): string | null {
      return snapshot.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      snapshot.set(key, value);
    },
    removeItem(key: string): void {
      snapshot.delete(key);
    },
    clear(): void {
      snapshot.clear();
    },
    key(index: number): string | null {
      return [...snapshot.keys()][index] ?? null;
    },
    get length(): number {
      return snapshot.size;
    },
  } as Storage;
  return { storage, snapshot };
}

test('persistence round-trips collapsed and expanded decisions', () => {
  const { storage, snapshot } = memoryStorage();
  const persistence = createStoragePersistence(storage);
  const next = withPersistedTurn(persistence, 'sess-1', 3, 'collapsed');
  persistence.write(next);
  assert.equal(readPersistedTurn(persistence, 'sess-1', 3), 'collapsed');
  assert.equal(readPersistedTurn(persistence, 'sess-1', 4), undefined);

  const expanded = withPersistedTurn(persistence, 'sess-1', 3, 'expanded');
  persistence.write(expanded);
  assert.equal(readPersistedTurn(persistence, 'sess-1', 3), 'expanded');
  assert.equal(snapshot.get(STORAGE_KEY)?.includes('"expanded"'), true);
});

test('corrupt storage degrades to empty', () => {
  const { storage } = memoryStorage();
  storage.setItem(STORAGE_KEY, '{not json');
  const persistence = createStoragePersistence(storage);
  assert.deepEqual(persistence.read(), {});
});

test('persistence tolerates unavailable storage (in-memory fallback)', () => {
  const persistence = createStoragePersistence(undefined);
  assert.deepEqual(persistence.read(), {});
  persistence.write(withPersistedTurn(persistence, 's', 1, 'collapsed'));
  // The memory layer keeps the decision for this page even when setItem is
  // impossible — folding must not flip back to undecided on the next read.
  assert.deepEqual(persistence.read(), { s: { '1': 'collapsed' } });
});

test('malformed persisted records are rejected wholesale', () => {
  const { storage } = memoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ 'sess-1': { '3': 'sideways' } }));
  const persistence: CollapsePersistence = createStoragePersistence(storage);
  assert.deepEqual(persistence.read(), {});
});

test('invalid turn values are refused to keep the persisted map parseable', () => {
  const { storage } = memoryStorage();
  const persistence = createStoragePersistence(storage);
  // Seed a valid decision so we can prove it survives a refused write.
  persistence.write(withPersistedTurn(persistence, 'sess-1', 3, 'collapsed'));
  for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const next = withPersistedTurn(persistence, 'sess-1', bad, 'collapsed');
    // Refused write returns the unchanged map — the existing session is preserved.
    assert.deepEqual(next['sess-1'], { '3': 'collapsed' }, String(bad));
  }
  // And the same is true for `readPersistedTurn`: invalid turns are undefined.
  assert.equal(readPersistedTurn(persistence, 'sess-1', -1), undefined);
  assert.equal(readPersistedTurn(persistence, 'sess-1', 1.5), undefined);
  // The real decision is still intact.
  assert.equal(readPersistedTurn(persistence, 'sess-1', 3), 'collapsed');
});
