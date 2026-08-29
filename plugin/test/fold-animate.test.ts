import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  animateFoldRows,
  processRowsSelector,
  type FoldAnimateDeps,
} from '../src/client/fold-animate.ts';

interface FakeRow {
  el: HTMLElement;
  style: Record<string, string>;
  classes: Set<string>;
  height: number;
  marginTop: number;
  transitionEnds: ((event: { target: unknown; propertyName: string }) => void)[];
  signals: { aborted: boolean }[];
}

function makeRow(height: number, marginTop: number): FakeRow {
  const style: Record<string, string> = {};
  const classes = new Set<string>();
  const transitionEnds: FakeRow['transitionEnds'] = [];
  const signals: FakeRow['signals'] = [];
  const el = {
    style,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
    offsetHeight: height,
    addEventListener: (
      _type: string,
      fn: (event: { target: unknown; propertyName: string }) => void,
      options: { signal: { aborted: boolean } },
    ) => {
      transitionEnds.push(fn);
      signals.push(options.signal);
    },
  } as unknown as HTMLElement;
  return { el, style, classes, height, marginTop, transitionEnds, signals };
}

/** 假帧/假定时器：用例手动推进，断言序列而不等待真实时间。 */
function makeDeps(rows: FakeRow[], reduced = false): {
  deps: FoldAnimateDeps;
  flushFrame: () => void;
  flushTimeout: () => void;
} {
  let frame: (() => void) | undefined;
  let settle: (() => void) | undefined;
  return {
    deps: {
      requestFrame: (cb) => {
        frame = cb;
        return frame;
      },
      cancelFrame: () => {
        frame = undefined;
      },
      scheduleTimeout: (cb) => {
        settle = cb;
        return settle;
      },
      cancelTimeout: () => {
        settle = undefined;
      },
      measure: (el) => {
        const row = rows.find((candidate) => candidate.el === el);
        assert.ok(row !== undefined, 'measured an unknown element');
        return { height: row.height, marginTop: row.marginTop };
      },
      reducedMotion: () => reduced,
    },
    flushFrame: () => {
      const cb = frame;
      frame = undefined;
      cb?.();
    },
    flushTimeout: () => {
      const cb = settle;
      settle = undefined;
      cb?.();
    },
  };
}

test('processRowsSelector targets member rows of the turn that are not hidden', () => {
  const selector = processRowsSelector(7);
  assert.match(selector, /\[data-chat-turn="7"\]/);
  assert.match(selector, /\[data-turn-process-member\]/);
  assert.match(selector, /:not\(\[data-turn-process-hidden\]\)/);
});

test('collapse locks current geometry, transitions to zero, then cleans up', () => {
  const rows = [makeRow(120, 16), makeRow(80, 16)];
  const { deps, flushFrame, flushTimeout } = makeDeps(rows);
  const done: string[] = [];
  animateFoldRows(rows.map((row) => row.el), 'collapse', () => done.push('done'), deps);

  for (const row of rows) {
    assert.equal(row.style.height, `${row.height}px`, 'collapse locks natural height first');
    assert.equal(row.style.marginTop, `${row.marginTop}px`);
    assert.equal(row.style.overflow, 'hidden');
    assert.ok(row.classes.has('dsh-tf-animating'));
  }
  flushFrame();
  for (const row of rows) {
    assert.equal(row.style.height, '0px');
    assert.equal(row.style.marginTop, '0px');
    assert.equal(row.style.opacity, '0');
  }
  flushTimeout();
  for (const row of rows) {
    assert.equal(row.style.height, '', 'inline styles are handed back to official layout');
    assert.equal(row.style.marginTop, '');
    assert.equal(row.style.opacity, '');
    assert.equal(row.style.overflow, '');
    assert.ok(!row.classes.has('dsh-tf-animating'));
  }
  assert.deepEqual(done, ['done']);
});

test('expand locks zero in the first frame, then reveals natural geometry', () => {
  const rows = [makeRow(120, 16)];
  const { deps, flushFrame, flushTimeout } = makeDeps(rows);
  const done: string[] = [];
  animateFoldRows(rows.map((row) => row.el), 'expand', () => done.push('done'), deps);

  assert.equal(rows[0].style.height, '0px', 'zero height is locked before any paint');
  assert.equal(rows[0].style.opacity, '0');
  flushFrame();
  assert.equal(rows[0].style.height, '120px');
  assert.equal(rows[0].style.marginTop, '16px');
  assert.equal(rows[0].style.opacity, '', 'opacity returns to the official default');
  flushTimeout();
  assert.equal(rows[0].style.height, '');
  assert.deepEqual(done, ['done']);
});

test('transitionend settles the animation without waiting for the timeout', () => {
  const rows = [makeRow(40, 8), makeRow(60, 8)];
  const { deps, flushFrame, flushTimeout } = makeDeps(rows);
  const done: string[] = [];
  animateFoldRows(rows.map((row) => row.el), 'expand', () => done.push('done'), deps);
  flushFrame();

  for (const row of rows) {
    const handler = row.transitionEnds.at(-1);
    assert.ok(handler !== undefined);
    handler({ target: row.el, propertyName: 'height' });
  }
  assert.deepEqual(done, ['done'], 'all rows settled via transitionend');
  assert.equal(rows[0].style.height, '', 'cleanup ran');
  flushTimeout();
  assert.deepEqual(done, ['done'], 'timeout after settle is a no-op');
});

test('reverse switches direction and swaps the completion callback', () => {
  const rows = [makeRow(100, 12)];
  const { deps, flushFrame, flushTimeout } = makeDeps(rows);
  const done: string[] = [];
  const handle = animateFoldRows(
    rows.map((row) => row.el),
    'collapse',
    () => done.push('collapse'),
    deps,
  );
  flushFrame();
  handle.reverse(() => done.push('expand'));
  assert.equal(rows[0].style.height, '100px', 'reverse targets natural geometry again');
  assert.equal(rows[0].style.opacity, '');
  flushTimeout();
  assert.deepEqual(done, ['expand'], 'only the reversed callback fires');
});

test('empty row list and reduced motion settle immediately without touching styles', () => {
  const untouched = makeRow(50, 10);
  const done: string[] = [];
  animateFoldRows([], 'expand', () => done.push('empty'), makeDeps([untouched]).deps);
  const reduced = [makeRow(50, 10)];
  animateFoldRows(
    reduced.map((row) => row.el),
    'collapse',
    () => done.push('reduced'),
    makeDeps(reduced, true).deps,
  );
  assert.deepEqual(done, ['empty', 'reduced']);
  assert.equal(untouched.style.height, undefined, 'no style was written');
  assert.equal(reduced[0].style.height, undefined);
});

test('cancel cleans up without firing the completion callback', () => {
  const rows = [makeRow(90, 16)];
  const { deps, flushFrame, flushTimeout } = makeDeps(rows);
  const done: string[] = [];
  const handle = animateFoldRows(rows.map((row) => row.el), 'collapse', () => done.push('done'), deps);
  flushFrame();
  handle.cancel();
  assert.equal(rows[0].style.height, '', 'styles cleared');
  assert.ok(!rows[0].classes.has('dsh-tf-animating'));
  flushTimeout();
  assert.deepEqual(done, [], 'cancel must not invoke onDone');
});

test('occluded tab: settle timeout fires even when the frame callback never runs', () => {
  const rows = [makeRow(120, 16)];
  const { deps, flushTimeout } = makeDeps(rows);
  const done: string[] = [];
  // requestAnimationFrame 被注入为 no-op：模拟被遮挡/后台的 tab（帧完全
  // 停发）。动画不能因此卡在锁定帧——兜底 timeout 必须独立于帧回调。
  const frozenDeps: FoldAnimateDeps = { ...deps, requestFrame: () => 'never', cancelFrame: () => {} };
  animateFoldRows(rows.map((row) => row.el), 'expand', () => done.push('done'), frozenDeps);
  assert.equal(rows[0].style.height, '0px', 'locked before paint');
  flushTimeout();
  assert.deepEqual(done, ['done'], 'fallback settle fired without any frame');
  assert.equal(rows[0].style.height, '', 'cleanup ran');
});
