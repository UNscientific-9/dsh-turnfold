import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkAutoLoadOnce,
  setAutoLoadSessions,
  type AutoLoadSessions,
} from '../src/client/auto-load.ts';

interface FakeHost {
  scrollTop: number;
  children: ({ dataset: Record<string, string> } | { querySelector(sel: string): FakeMarker | null })[];
  querySelector(sel: string): unknown;
}

function el(attrs: Record<string, string>): { getAttribute(name: string): string | null } {
  return { getAttribute: (name: string) => attrs[name] ?? null };
}

function docWith(
  hosts: Array<{ scrollTop: number; column?: { marker: Record<string, string> } | null }>,
): Document {
  const hostNodes = hosts.map((host) => ({
    scrollTop: host.scrollTop,
    querySelector(sel: string) {
      if (sel === '[data-chat-flow]' && host.column !== undefined && host.column !== null) {
        return { querySelector: (_s: string) => el(host.column!.marker) };
      }
      return null;
    },
  }));
  return {
    querySelectorAll: <T extends Element>(_: string) => hostNodes as unknown as ArrayLike<T>,
  } as unknown as Document;
}

function service(calls: string[]): AutoLoadSessions {
  return {
    scope(sessionId: string) {
      return {
        get(name: string) {
          if (name !== 'conversation') return undefined;
          return {
            loadOlder: async () => {
              calls.push(sessionId);
            },
          };
        },
      };
    },
  };
}

test('auto-load fires loadOlder for hosts resting at the top', async () => {
  const calls: string[] = [];
  setAutoLoadSessions(service(calls));
  const doc = docWith([{ scrollTop: 0, column: { marker: { 'data-dsh-ta-session': 's1' } } }]);
  const dispatched = await checkAutoLoadOnce(doc, 1000);
  assert.deepEqual(dispatched, ['s1']);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, ['s1']);
});

test('auto-load skips hosts scrolled away and hosts without a session marker', async () => {
  const calls: string[] = [];
  setAutoLoadSessions(service(calls));
  const doc = docWith([
    { scrollTop: 120, column: { marker: { 'data-dsh-ta-session': 's1' } } },
    { scrollTop: 0, column: null },
  ]);
  assert.deepEqual(await checkAutoLoadOnce(doc, 1000), []);
});

test('auto-load paces consecutive pulls (second pull within the window is skipped)', async () => {
  const calls: string[] = [];
  setAutoLoadSessions(service(calls));
  const doc = docWith([{ scrollTop: 0, column: { marker: { 'data-dsh-ta-session': 's1' } } }]);
  assert.equal((await checkAutoLoadOnce(doc, 1000)).length, 1);
  assert.equal((await checkAutoLoadOnce(doc, 1100)).length, 0, "within 400ms pace window");
  assert.equal((await checkAutoLoadOnce(doc, 1500)).length, 1, "after the pace window");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, ['s1', 's1']);
});

test('disabled switch stops all dispatches', async () => {
  const calls: string[] = [];
  setAutoLoadSessions(service(calls));
  const previous = globalThis.localStorage;
  // Simulate the off switch with a storage stub.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => (k === 'dsh.turn-collapse.autoLoad' ? '0' : null) },
  });
  try {
    const doc = docWith([{ scrollTop: 0, column: { marker: { 'data-dsh-ta-session': 's1' } } }]);
    assert.deepEqual(await checkAutoLoadOnce(doc, 1000), []);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previous,
    });
  }
});
