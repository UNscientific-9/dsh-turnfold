import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStoragePersistence,
  readPersistedTurn,
  STORAGE_KEY,
  withPersistedTurn,
  type CollapsePersistence,
} from '../src/client/persist.ts';
import { createCollapseStore } from '../src/client/store.ts';

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

test('store notifies subscribers on change', () => {
  const { storage } = memoryStorage();
  const store = createCollapseStore(createStoragePersistence(storage));
  let notified = 0;
  const unsubscribe = store.subscribe(() => {
    notified += 1;
  });
  store.setCollapsed('s', 1, 'collapsed');
  assert.equal(notified, 1);
  unsubscribe();
  store.setCollapsed('s', 1, 'expanded');
  assert.equal(notified, 1);
});

test('store distinguishes undefined from collapsed', () => {
  const { storage } = memoryStorage();
  const store = createCollapseStore(createStoragePersistence(storage));
  assert.equal(store.getCollapsed('s', 1), undefined);
  store.setCollapsed('s', 1, 'collapsed');
  assert.equal(store.getCollapsed('s', 1), 'collapsed');
});

test('subscriber errors are logged but never break the store', () => {
  const { storage } = memoryStorage();
  const store = createCollapseStore(createStoragePersistence(storage));
  const original = console.error;
  const errors: unknown[] = [];
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    let ok = false;
    store.subscribe(() => {
      throw new Error('subscriber boom');
    });
    store.subscribe(() => {
      ok = true;
    });
    // Should not throw, and the second subscriber must still run.
    store.setCollapsed('s', 1, 'collapsed');
    assert.equal(ok, true);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]?.[0]), /subscriber threw/);
  } finally {
    console.error = original;
  }
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
