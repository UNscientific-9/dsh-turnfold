import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkAutoLoadOnce,
  setAutoLoadSessionReader,
  setAutoLoadSessions,
  type AutoLoadSessions,
} from '../src/client/auto-load.ts';

function docWith(hosts: Array<{ scrollTop: number }>): Document {
  const hostNodes = hosts.map((host) => ({ scrollTop: host.scrollTop }));
  return {
    querySelectorAll: <T extends Element>(_: string) => hostNodes as unknown as ArrayLike<T>,
  } as unknown as Document;
}

function service(calls: string[]): AutoLoadSessions {
  return {
    binding(sessionId: string) {
      return {
        session: {
          loadOlder: async () => {
            calls.push(sessionId);
          },
        },
      };
    },
  };
}

test('auto-load fires loadOlder for hosts resting at the top', async () => {
  const calls: string[] = [];
  setAutoLoadSessions(() => service(calls));
  setAutoLoadSessionReader(() => 's1');
  const doc = docWith([{ scrollTop: 0 }]);
  const dispatched = await checkAutoLoadOnce(doc, 1000);
  assert.deepEqual(dispatched, ['s1']);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, ['s1']);
});

test('auto-load skips hosts scrolled away and sessions without an identity', async () => {
  const calls: string[] = [];
  setAutoLoadSessions(() => service(calls));
  setAutoLoadSessionReader(() => 's1');
  // Two hosts: the scrolled-away one is skipped, only the top one dispatches.
  const doc = docWith([{ scrollTop: 120 }, { scrollTop: 0 }]);
  assert.deepEqual(await checkAutoLoadOnce(doc, 1000), ['s1']);

  // Without a session identity the pass is a no-op.
  setAutoLoadSessionReader(() => null);
  assert.deepEqual(await checkAutoLoadOnce(docWith([{ scrollTop: 0 }]), 2000), []);
  setAutoLoadSessionReader(() => 's1');
});

test('auto-load paces consecutive pulls (second pull within the window is skipped)', async () => {
  const calls: string[] = [];
  setAutoLoadSessions(() => service(calls));
  setAutoLoadSessionReader(() => 's1');
  const doc = docWith([{ scrollTop: 0 }]);
  assert.equal((await checkAutoLoadOnce(doc, 1000)).length, 1);
  assert.equal((await checkAutoLoadOnce(doc, 1100)).length, 0, "within 400ms pace window");
  assert.equal((await checkAutoLoadOnce(doc, 1500)).length, 1, "after the pace window");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, ['s1', 's1']);
});

test('disabled switch stops all dispatches', async () => {
  const calls: string[] = [];
  setAutoLoadSessions(() => service(calls));
  setAutoLoadSessionReader(() => 's1');
  const previous = globalThis.localStorage;
  // Simulate the off switch with a storage stub.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => (k === 'dsh.turn-collapse.autoLoad' ? '0' : null) },
  });
  try {
    const doc = docWith([{ scrollTop: 0 }]);
    assert.deepEqual(await checkAutoLoadOnce(doc, 1000), []);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previous,
    });
  }
});

test('auto-load degrades when the binding is missing or loadOlder throws', async () => {
  // binding 缺失：整个 pass no-op，且不重置别的 host pace（此处只有 no-op）。
  setAutoLoadSessions(() => ({
    binding() {
      return undefined;
    },
  }));
  setAutoLoadSessionReader(() => 's1');
  assert.deepEqual(await checkAutoLoadOnce(docWith([{ scrollTop: 0 }]), 1000), []);

  // loadOlder 抛错：dispatch 视为失败，pace 重置（下一次 tick 立即重试）。
  const calls: string[] = [];
  let attempts = 0;
  setAutoLoadSessions(() => ({
    binding(id: string) {
      return {
        session: {
          loadOlder: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error('network boom');
            calls.push(id);
          },
        },
      };
    },
  }));
  const doc = docWith([{ scrollTop: 0 }]);
  assert.deepEqual(await checkAutoLoadOnce(doc, 2000), [], 'first attempt fails');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await checkAutoLoadOnce(doc, 2000)).length, 1, 'retry after failure');
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, ['s1']);
});

test('auto-load rejects a second dispatch while one is still in flight', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = 0;
  setAutoLoadSessions(() => ({
    binding() {
      return {
        session: {
          loadOlder: async () => {
            started += 1;
            await gate;
          },
        },
      };
    },
  }));
  setAutoLoadSessionReader(() => 's1');
  const doc = docWith([{ scrollTop: 0 }]);
  const first = checkAutoLoadOnce(doc, 3000);
  // 首次调用已进入 inFlight（loadOlder 挂起）——第二个 pass 必须被拒。
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(await checkAutoLoadOnce(doc, 3010), []);
  release();
  assert.equal((await first).length, 1, 'the in-flight dispatch completes');
  assert.equal(started, 1);
});
