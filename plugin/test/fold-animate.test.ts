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
  /** 模拟浏览器外部取消（元素脱离文档等）：finished reject 而非本代码 cancel。 */
  reject: () => void;
  finished: Promise<unknown>;
}

interface FakeRow {
  el: HTMLElement;
  style: Record<string, string>;
  classes: Set<string>;
  height: number;
  marginTop: number;
  anims: FakeAnim[];
  /** false 模拟行内容未物化（offsetHeight 为 0），物化后恢复自然高。 */
  materialized: boolean;
}

function makeRow(height: number, marginTop: number, materialized = true): FakeRow {
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
  return { el, style, classes, height, marginTop, anims, materialized };
}

/** 假动画：记录 frames/options，finish() 手动 resolve、reject() 模拟外部取消。 */
function makeFakeAnim(): FakeAnim {
  let resolveFinish: (() => void) | undefined;
  let rejectFinish: (() => void) | undefined;
  const anim: FakeAnim = {
    frames: [],
    options: {},
    cancelled: false,
    finish: () => resolveFinish?.(),
    reject: () => rejectFinish?.(new Error('animation cancelled externally')),
    finished: new Promise((resolve, reject) => {
      resolveFinish = resolve;
      rejectFinish = reject;
    }),
  };
  return anim;
}

/**
 * 假时器：用例手动推进，断言序列而不等待真实时间。
 *
 * measure 模拟真实 offsetHeight 语义：内容未物化测得 0；height 被内联压
 * '0px'（预压约束未解除）也测得 0——解除约束测量是动画代码的职责，漏了
 * 就永远测不到，相关用例会失败。
 */
function makeDeps(rows: FakeRow[], reduced = false): {
  deps: FoldAnimateDeps;
  flushTimeout: () => void;
  flushMicrotask: () => void;
  pendingTimeouts: () => number;
} {
  let timeouts: (() => void)[] = [];
  let microtasks: (() => void)[] = [];
  return {
    deps: {
      scheduleMicrotask: (cb) => {
        microtasks.push(cb);
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
        if (!row.materialized || el.style.height === '0px') {
          return { height: 0, marginTop: row.marginTop };
        }
        // 预压写入的 inline margin 同样会被 computed style 读回——漏解除
        // 就只能测得 0，真实自然 margin 测不到，相关断言会失败。
        if (el.style.marginTop === '0px') {
          return { height: row.height, marginTop: 0 };
        }
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
    flushTimeout: () => {
      const cb = timeouts.shift();
      cb?.();
    },
    flushMicrotask: () => {
      const cb = microtasks.shift();
      cb?.();
    },
    pendingTimeouts: () => timeouts.length,
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

test('collapse animates from natural height to zero with fade-out, then cleans up', async () => {
  const rows = [makeRow(120, 16), makeRow(80, 16)];
  const { deps } = makeDeps(rows);
  const done: string[] = [];
  animateFoldRows(rows.map((row) => row.el), 'collapse', () => done.push('done'), deps);
  await settleAnimation();

  // 收起方向行本就可见：首帧测量即就绪 → WAAPI 从自然高 → 0，淡出。
  for (const row of rows) {
    assert.equal(row.anims.length, 1, 'one animation per row');
    const [from, to] = row.anims[0].frames;
    assert.equal(from.height, `${row.height}px`, 'starts at natural height');
    assert.equal(from.marginTop, `${row.marginTop}px`);
    assert.equal(to.height, '0px', 'ends at zero');
    assert.equal(from.opacity, '1', 'starts fully visible');
    assert.equal(to.opacity, '0', 'fades out');
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

test('expand measures in a microtask (before paint) and skips timeout polling', async () => {
  const rows = [makeRow(120, 16)];
  const { deps, flushMicrotask, pendingTimeouts } = makeDeps(rows);
  const done: string[] = [];
  animateFoldRows(rows.map((row) => row.el), 'expand', () => done.push('done'), deps);
  flushMicrotask(); // 微任务首测（真实环境中发生在 paint 前）
  assert.equal(pendingTimeouts(), 0, 'no timeout polling was scheduled on first-measure success');
  await settleAnimation();

  assert.equal(rows[0].anims.length, 1, 'animation started from the microtask measurement');
  const [from, to] = rows[0].anims[0].frames;
  assert.equal(from.height, '0px', 'starts at zero');
  assert.equal(to.height, '120px', 'ends at natural height');
  assert.equal(from.opacity, '0', 'starts invisible');
  assert.equal(to.opacity, '1', 'fades in (no hard cut at the end)');
  rows[0].anims[0].finish();
  await settleAnimation();
  assert.deepEqual(done, ['done']);
  assert.equal(rows[0].style.height, '', 'cleaned up');
});

test('expand presets zero on first miss, then animates once content materializes', async () => {
  const rows = [makeRow(120, 16, false)]; // 内容未物化，首测只能得 0
  const { deps, flushTimeout, flushMicrotask } = makeDeps(rows);
  const done: string[] = [];
  animateFoldRows(rows.map((row) => row.el), 'expand', () => done.push('done'), deps);
  flushMicrotask();

  // 首测失败 → 立即预压 0 隐身（阻止后续帧以完整形态闪现）。
  assert.equal(rows[0].style.height, '0px', 'preset zero');
  assert.equal(rows[0].style.overflow, 'hidden');
  assert.equal(rows[0].style.opacity, '0');
  assert.equal(rows[0].style.marginTop, '0px');
  assert.ok(rows[0].classes.has('dsh-tf-animating'));
  assert.equal(rows[0].anims.length, 0, 'no animation yet');

  rows[0].materialized = true; // 内容物化，自然高可测
  flushTimeout(); // 轮询：临时解除 height 约束测量 → 成功
  await settleAnimation();

  assert.equal(rows[0].anims.length, 1, 'animation starts after measurement succeeds');
  const [from, to] = rows[0].anims[0].frames;
  assert.equal(from.height, '0px');
  assert.equal(to.height, '120px');
  assert.equal(to.marginTop, '16px', 'natural margin measured through the lifted constraint');
  rows[0].anims[0].finish();
  await settleAnimation();
  assert.deepEqual(done, ['done']);
  assert.equal(rows[0].style.height, '', 'cleaned up');
});

test('expand gives up (styles cleared) when height never becomes measurable', async () => {
  // 模拟「行一直 hidden / 内容未物化」：measure 恒返回 0。
  const rows = [makeRow(0, 0, false)];
  const { deps, flushTimeout, flushMicrotask } = makeDeps(rows);
  const done: string[] = [];
  const handle = animateFoldRows(rows.map((row) => row.el), 'expand', () => done.push('done'), deps);
  // 微任务首测失败（预压）→ 2 次轮询仍测不到 → resolve([]) → settle 放弃。
  flushMicrotask();
  flushTimeout();
  flushTimeout();
  await settleAnimation();
  assert.deepEqual(done, ['done'], 'measurement-failure falls back to instant switch');
  assert.equal(rows[0].anims.length, 0, 'no animation was started');
  assert.equal(rows[0].style.height, '', 'preset constraint was cleared on give-up');
  assert.equal(rows[0].style.opacity, '');
  assert.equal(rows[0].style.overflow, '');
  assert.ok(!rows[0].classes.has('dsh-tf-animating'), 'animating class was removed');
  handle.cancel();
});

test('all rows settling via animation finish triggers done once', async () => {
  const rows = [makeRow(40, 8), makeRow(60, 8)];
  const { deps, flushMicrotask } = makeDeps(rows);
  const done: string[] = [];
  animateFoldRows(rows.map((row) => row.el), 'expand', () => done.push('done'), deps);
  flushMicrotask();
  await settleAnimation();
  for (const row of rows) row.anims[0].finish();
  await settleAnimation();
  assert.deepEqual(done, ['done']);
  assert.equal(rows[0].style.height, '', 'cleanup ran');
});

test('reverse switches direction and swaps the completion callback', async () => {
  const rows = [makeRow(100, 12)];
  const { deps } = makeDeps(rows);
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
  const [from, to] = rows[0].anims[1].frames;
  assert.equal(from.height, '0px', 'reverse to expand starts at zero');
  assert.equal(to.opacity, '1', 'reverse to expand fades in');
  rows[0].anims[1].finish();
  await settleAnimation();
  assert.deepEqual(done, ['expand'], 'only the reversed callback fires');
});

test('reverse during measurement restarts with the new direction', async () => {
  const rows = [makeRow(100, 12)];
  const { deps, flushMicrotask } = makeDeps(rows);
  const done: string[] = [];
  const handle = animateFoldRows(
    rows.map((row) => row.el),
    'expand',
    () => done.push('expand'),
    deps,
  );
  // 首测微任务尚未执行时 reverse 到收起方向。
  handle.reverse(() => done.push('collapse'));
  flushMicrotask(); // 旧首测回调：generation 已变，必须放弃（不得预压）
  await settleAnimation();
  rows[0].anims[0]?.finish();
  await settleAnimation();
  assert.deepEqual(done, ['collapse'], 'measurement-phase reverse wins');
  assert.equal(rows[0].style.height, '', 'stale microtask left no preset constraint');
  assert.equal(rows[0].anims.length, 1, 'exactly one animation (collapse) ran');
});

test('reverse during preset zero clears the constraint and collapses', async () => {
  const rows = [makeRow(100, 12, false)];
  const { deps, flushTimeout, flushMicrotask } = makeDeps(rows);
  const done: string[] = [];
  const handle = animateFoldRows(
    rows.map((row) => row.el),
    'expand',
    () => done.push('expand'),
    deps,
  );
  flushMicrotask(); // 首测失败 → 预压
  assert.equal(rows[0].style.height, '0px', 'preset state');

  rows[0].materialized = true;
  handle.reverse(() => done.push('collapse'));
  await settleAnimation();
  // 预压被解除，收起方向同步测量成功 → 直接从自然高收起。
  assert.equal(rows[0].anims.length, 1, 'collapse animation started');
  const [from, to] = rows[0].anims[0].frames;
  assert.equal(from.height, '100px', 'starts at natural height, not the preset zero');
  assert.equal(to.height, '0px');
  flushTimeout(); // 旧展开轮询若未被作废会在此触发——不得产生第二个动画
  assert.equal(rows[0].anims.length, 1, 'stale expansion poll did not start a second animation');
  rows[0].anims[0].finish();
  await settleAnimation();
  assert.deepEqual(done, ['collapse'], 'only the reversed callback fires');
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

test('cancel during measurement ignores the later microtask and polls', async () => {
  // 未物化行：cancel 后首测微任务回调若仍预压，样式将无人清理（行永久隐
  // 身）——isStale 纳入 finished 后必须拦下。
  const rows = [makeRow(120, 16, false)];
  const { deps, flushTimeout, flushMicrotask } = makeDeps(rows);
  const done: string[] = [];
  const handle = animateFoldRows(rows.map((row) => row.el), 'expand', () => done.push('done'), deps);
  handle.cancel();
  flushMicrotask(); // 取消后排队的首测回调：isStale（finished）必须拦下
  flushTimeout();
  await settleAnimation();
  assert.deepEqual(done, [], 'cancel during measurement must not invoke onDone');
  assert.equal(rows[0].style.height, '', 'no preset was written after cancel');
  assert.equal(rows[0].style.opacity, '');
  assert.equal(rows[0].style.overflow, '');
  assert.ok(!rows[0].classes.has('dsh-tf-animating'), 'no animating class after cancel');
  assert.equal(rows[0].anims.length, 0, 'no animation was started');
});

test('reverse reports false when it settles synchronously, true while still active', async () => {
  // 同步 settle：预压态未物化行反转到收起，收起同步测量也失败 → settle，
  // 调用方（toggle）不得再保留已完成的 handle。
  const rows = [makeRow(100, 12, false)];
  const { deps, flushMicrotask } = makeDeps(rows);
  const done: string[] = [];
  const handle = animateFoldRows(rows.map((row) => row.el), 'expand', () => done.push('expand'), deps);
  flushMicrotask(); // 首测失败 → 预压
  const active = handle.reverse(() => done.push('collapse'));
  assert.equal(active, false, 'reverse that settles synchronously reports inactive');
  assert.deepEqual(done, ['collapse'], 'done fired exactly once (no double call)');
  assert.equal(rows[0].style.height, '', 'preset cleared on give-up');

  // 活跃反转：collapse 动画中 reverse 到 expand，动画继续 → true。
  const rows2 = [makeRow(100, 12)];
  const { deps: deps2 } = makeDeps(rows2);
  const handle2 = animateFoldRows(rows2.map((row) => row.el), 'collapse', () => {}, deps2);
  await settleAnimation();
  const active2 = handle2.reverse(() => {});
  assert.equal(active2, true, 'animating reverse stays active');
  handle2.cancel();
});

test('externally cancelled animation (finished rejects) settles immediately', async () => {
  // 浏览器外部取消（行脱离文档等）：finished reject 时若只吞不恢复，展开
  // 方向会以隐身起点态停留至 720ms 兜底——必须立即 settle 清样式。
  const rows = [makeRow(100, 12)];
  const { deps, flushMicrotask } = makeDeps(rows);
  const done: string[] = [];
  animateFoldRows(rows.map((row) => row.el), 'expand', () => done.push('done'), deps);
  flushMicrotask();
  await settleAnimation();
  const anim = rows[0].anims[0];
  anim.reject(); // finished=false 时的 reject（非本代码 cancel）
  await settleAnimation();
  assert.deepEqual(done, ['done'], 'external cancel settles immediately');
  assert.equal(rows[0].style.height, '', 'styles restored right away');
  assert.ok(!rows[0].classes.has('dsh-tf-animating'));
});
