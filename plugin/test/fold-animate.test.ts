import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  animateFoldRows,
  processRowsSelector,
  type FoldAnimateDeps,
} from '../src/client/fold-animate.ts';

interface FakeAnim {
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  cancelled: boolean;
  finish: () => void;
  finished: Promise<unknown>;
}

interface FakeRow {
  el: HTMLElement;
  style: Record<string, string>;
  classes: Set<string>;
  height: number;
  marginTop: number;
  anims: FakeAnim[];
}

function makeRow(height: number, marginTop: number): FakeRow {
  const style: Record<string, string> = {};
  const classes = new Set<string>();
  const anims: FakeAnim[] = [];
  const el = {
    style,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
    offsetHeight: height,
  } as unknown as HTMLElement;
  return { el, style, classes, height, marginTop, anims };
}

/** 假动画：记录 frames/options，finish() 手动 resolve。 */
function makeFakeAnim(): FakeAnim {
  let resolveFinish: (() => void) | undefined;
  const anim: FakeAnim = {
    frames: [],
    options: {},
    cancelled: false,
    finish: () => resolveFinish?.(),
    finished: new Promise((resolve) => { resolveFinish = resolve; }),
  };
  return anim;
}

/** 假帧/假定时器：用例手动推进，断言序列而不等待真实时间。 */
function makeDeps(rows: FakeRow[], reduced = false): {
  deps: FoldAnimateDeps;
  flushFrame: () => void;
  flushTimeout: () => void;
} {
  let frames: (() => void)[] = [];
  let timeouts: (() => void)[] = [];
  return {
    deps: {
      requestFrame: (cb) => {
        frames.push(cb);
        return frames.length;
      },
      cancelFrame: () => {
        frames = [];
      },
      scheduleTimeout: (cb) => {
        timeouts.push(cb);
        return timeouts.length;
      },
      cancelTimeout: () => {
        timeouts = [];
      },
      measure: (el) => {
        const row = rows.find((candidate) => candidate.el === el);
        assert.ok(row !== undefined, 'measured an unknown element');
        return { height: row.height, marginTop: row.marginTop };
      },
      reducedMotion: () => reduced,
      animate: (el, frames, options) => {
        const row = rows.find((candidate) => candidate.el === el);
        assert.ok(row !== undefined, 'animated an unknown element');
        const anim = makeFakeAnim();
        anim.frames = frames;
        anim.options = options;
        row.anims.push(anim);
        return {
          finished: anim.finished,
          cancel: () => { anim.cancelled = true; },
        };
      },
    },
    flushFrame: () => {
      for (let i = 0; i < 6; i += 1) {
        const cb = frames.shift();
        if (cb === undefined) break;
        cb();
      }
    },
    flushTimeout: () => {
      const cb = timeouts.shift();
      cb?.();
    },
  };
}

/** 推进到「自然高就绪」完成（含微任务）。 */
async function settleAnimation(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test('processRowsSelector targets member rows of the turn that are not hidden', () => {
  const selector = processRowsSelector(7);
  assert.match(selector, /\[data-chat-turn="7"\]/);
  assert.match(selector, /\[data-turn-process-member\]/);
  assert.match(selector, /:not\(\[data-turn-process-hidden\]\)/);
});

test('collapse animates from natural height to zero, then cleans up', async () => {
  const rows = [makeRow(120, 16), makeRow(80, 16)];
  const { deps, flushTimeout } = makeDeps(rows);
  const done: string[] = [];
  animateFoldRows(rows.map((row) => row.el), 'collapse', () => done.push('done'), deps);
  await settleAnimation();

  // 收起方向行本就可见：首帧测量即就绪 → WAAPI 从自然高 → 0。
  for (const row of rows) {
    assert.equal(row.anims.length, 1, 'one animation per row');
    const [from, to] = row.anims[0].frames;
    assert.equal(from.height, `${row.height}px`, 'starts at natural height');
    assert.equal(from.marginTop, `${row.marginTop}px`);
    assert.equal(to.height, '0px', 'ends at zero');
    assert.equal(row.style.overflow, 'hidden');
    assert.ok(row.classes.has('dsh-tf-animating'));
  }
  // 完成所有动画 → settle 清理
  for (const row of rows) row.anims[0].finish();
  await settleAnimation();
  for (const row of rows) {
    assert.equal(row.style.height, '', 'inline styles are handed back to official layout');
    assert.ok(!row.classes.has('dsh-tf-animating'));
  }
  assert.deepEqual(done, ['done']);
});

test('expand animates from zero to natural height', async () => {
  const rows = [makeRow(120, 16)];
  const { deps, flushTimeout } = makeDeps(rows);
  const done: string[] = [];
  animateFoldRows(rows.map((row) => row.el), 'expand', () => done.push('done'), deps);
  flushTimeout(); // 驱动测量轮询（expand 走 scheduleTimeout）
  await settleAnimation();

  assert.equal(rows[0].anims.length, 1);
  const [from, to] = rows[0].anims[0].frames;
  assert.equal(from.height, '0px', 'starts at zero');
  assert.equal(to.height, '120px', 'ends at natural height');
  rows[0].anims[0].finish();
  await settleAnimation();
  assert.deepEqual(done, ['done']);
  assert.equal(rows[0].style.height, '', 'cleaned up');
});

test('expand gives up (no styles) when height never becomes measurable', async () => {
  // 模拟「行一直 hidden / 内容未物化」：measure 恒返回 0。
  const rows = [makeRow(0, 0)];
  const { deps, flushTimeout } = makeDeps(rows);
  const done: string[] = [];
  const handle = animateFoldRows(rows.map((row) => row.el), 'expand', () => done.push('done'), deps);
  // 3 次轮询都测不到 → resolve([]) → settle 放弃动画，立即完成回调。
  for (let i = 0; i < 4; i += 1) flushTimeout();
  await settleAnimation();
  assert.deepEqual(done, ['done'], 'measurement-failure falls back to instant switch');
  assert.equal(rows[0].anims.length, 0, 'no animation was started');
  assert.equal(rows[0].style.height, '', 'no style was written');
  handle.cancel();
});

test('all rows settling via animation finish triggers done once', async () => {
  const rows = [makeRow(40, 8), makeRow(60, 8)];
  const { deps, flushTimeout } = makeDeps(rows);
  const done: string[] = [];
  animateFoldRows(rows.map((row) => row.el), 'expand', () => done.push('done'), deps);
  flushTimeout();
  await settleAnimation();
  for (const row of rows) row.anims[0].finish();
  await settleAnimation();
  assert.deepEqual(done, ['done']);
  assert.equal(rows[0].style.height, '', 'cleanup ran');
});

test('reverse switches direction and swaps the completion callback', async () => {
  const rows = [makeRow(100, 12)];
  const { deps, flushTimeout } = makeDeps(rows);
  const done: string[] = [];
  const handle = animateFoldRows(
    rows.map((row) => row.el),
    'collapse',
    () => done.push('collapse'),
    deps,
  );
  await settleAnimation();
  handle.reverse(() => done.push('expand'));
  // reverse 取消旧动画，从当前值反向再跑。
  assert.equal(rows[0].anims[0].cancelled, true, 'old animation cancelled');
  assert.equal(rows[0].anims.length, 2, 'new animation started');
  const [from] = rows[0].anims[1].frames;
  assert.equal(from.height, '0px', 'reverse to expand starts at zero');
  rows[0].anims[1].finish();
  await settleAnimation();
  assert.deepEqual(done, ['expand'], 'only the reversed callback fires');
});

test('reverse during measurement restarts with the new direction', async () => {
  const rows = [makeRow(100, 12)];
  const { deps, flushTimeout } = makeDeps(rows);
  const done: string[] = [];
  const handle = animateFoldRows(
    rows.map((row) => row.el),
    'expand',
    () => done.push('expand'),
    deps,
  );
  // 测量未完成时 reverse 到收起方向。
  handle.reverse(() => done.push('collapse'));
  await settleAnimation();
  flushTimeout(); // 驱动新测量的轮询
  await settleAnimation();
  rows[0].anims[0]?.finish();
  await settleAnimation();
  assert.deepEqual(done, ['collapse'], 'measurement-phase reverse wins');
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

test('cancel cleans up without firing the completion callback', async () => {
  const rows = [makeRow(90, 16)];
  const { deps } = makeDeps(rows);
  const done: string[] = [];
  const handle = animateFoldRows(rows.map((row) => row.el), 'collapse', () => done.push('done'), deps);
  await settleAnimation();
  handle.cancel();
  assert.equal(rows[0].anims[0].cancelled, true, 'animation cancelled');
  assert.equal(rows[0].style.height, '', 'styles cleared');
  assert.ok(!rows[0].classes.has('dsh-tf-animating'));
  assert.deepEqual(done, [], 'cancel must not invoke onDone');
});

test('cancel during measurement cleans up without firing the completion callback', async () => {
  const rows = [makeRow(120, 16)];
  const { deps, flushTimeout } = makeDeps(rows);
  const done: string[] = [];
  const handle = animateFoldRows(rows.map((row) => row.el), 'expand', () => done.push('done'), deps);
  handle.cancel();
  flushTimeout();
  assert.deepEqual(done, [], 'cancel during measurement must not invoke onDone');
  assert.equal(rows[0].style.height, '', 'no style was written');
});
