import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  animateCompanionCatchUp,
  animateFoldRows,
  processRowsSelector,
  type FoldAnimateDeps,
} from '../src/client/fold-animate.ts';

interface FakeAnim {
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  cancelled: boolean;
  reverseCount: number;
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
    // settle 的「已 hidden 直接清样式」分流检查；默认未 hidden（走钉住路径）。
    hasAttribute: () => false,
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
    reverseCount: 0,
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
          reverse: () => { anim.reverseCount += 1; },
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

test('collapse animates from natural height to zero with fade-out, then pins terminal state', async () => {
  const rows = [makeRow(120, 16), makeRow(80, 16)];
  const { deps } = makeDeps(rows);
  const done: string[] = [];
  animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'collapse', () => done.push('done'), {}, deps);
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
    assert.equal(
      row.anims[0].options.fill,
      'both',
      'pending/finished effect keeps covering the terminal underlay',
    );
    assert.equal(row.style.overflow, 'hidden');
    assert.ok(row.classes.has('dsh-tf-animating'));
  }
  // 完成所有动画 → settle 钉住终态（不得清样式：官方 hidden 尚未落地，
  // 清样式 = 行以完整形态闪现一帧，下方元素被推下再弹回）。
  for (const row of rows) row.anims[0].finish();
  await settleAnimation();
  for (const row of rows) {
    assert.equal(row.style.height, '0px', 'terminal state is pinned, not cleared');
    assert.equal(row.style.marginTop, '0px', 'pinned margin');
    assert.equal(row.style.opacity, '0', 'pinned invisible');
    assert.equal(row.style.overflow, 'hidden');
    assert.ok(row.classes.has('dsh-tf-animating'));
  }
  assert.deepEqual(done, ['done']);
});

test('collapse keeps terminal geometry underneath staggered row animations', async () => {
  // 浏览器可因每行动画的 ready 时刻不同而错帧完成。第一行先结束时，第二行
  // 仍在播放；底层样式若还是起点自然高，WAAPI effect 退出后第一行会重新
  // 撑开一帧，带动全部后续元素抽动。
  const rows = [makeRow(120, 16), makeRow(80, 16)];
  const { deps } = makeDeps(rows);
  const done: string[] = [];
  animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'collapse', () => done.push('done'), {}, deps);
  await settleAnimation();

  assert.equal(rows[0].style.height, '0px', 'underlying height is the collapsed terminal value');
  assert.equal(rows[0].style.marginTop, '0px', 'underlying spacing is already collapsed');
  assert.equal(rows[0].style.opacity, '0', 'underlying opacity is already collapsed');

  rows[0].anims[0].finish();
  await settleAnimation();
  assert.deepEqual(done, [], 'the group still waits for the second row');
  assert.equal(rows[0].style.height, '0px', 'the early row never restores natural height');
});

test('pinned terminal state is overwritten by a following expand animation', async () => {
  const rows = [makeRow(120, 16)];
  const { deps, flushTimeout, flushMicrotask } = makeDeps(rows);
  // 先收起并 settle（钉住终态）。
  animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'collapse', () => {}, {}, deps);
  await settleAnimation();
  rows[0].anims[0].finish();
  await settleAnimation();
  assert.equal(rows[0].style.height, '0px', 'pinned after collapse');

  // 再展开：钉住约束下首测得 0 → 走解除约束测量，必须测得自然高而非把 0
  // 当目标；展开动画覆写钉住的行内样式。
  const done: string[] = [];
  animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'expand', () => done.push('done'), {}, deps);
  flushMicrotask(); // 首测失败（钉住约束）→ 预压
  flushTimeout(); // 轮询：临时解除约束测量 → 成功
  await settleAnimation();
  assert.equal(rows[0].anims.length, 2, 'one collapse + one expand animation total');
  const to = rows[0].anims[1].frames[1];
  assert.equal(to.height, '120px', 'natural height measured through the pinned constraint');
  assert.equal(to.opacity, '1', 'fades back in from the pinned invisible state');
  rows[0].anims[1].finish();
  await settleAnimation();
  assert.deepEqual(done, ['done']);
});

test('cancel after settle is a no-op: pin cleanup belongs to clearPinnedRows', async () => {
  // settle 后 handle 已 finished，cancel 不得再动样式也不得重复触发 done；
  // 钉住样式的兜底清理由视图在官方 hidden 落地后经 clearPinnedRows 执行。
  const rows = [makeRow(90, 16)];
  const { deps } = makeDeps(rows);
  const done: string[] = [];
  const handle = animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'collapse', () => done.push('done'), {}, deps);
  await settleAnimation();
  rows[0].anims[0].finish();
  await settleAnimation();
  assert.equal(rows[0].style.height, '0px', 'pinned after collapse');
  handle.cancel();
  assert.equal(rows[0].style.height, '0px', 'cancel must not touch settled rows');
  assert.deepEqual(done, ['done'], 'done fired exactly once');
});

test('expand measures in a microtask (before paint) and skips timeout polling', async () => {
  const rows = [makeRow(120, 16)];
  const { deps, flushMicrotask, pendingTimeouts } = makeDeps(rows);
  const done: string[] = [];
  animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'expand', () => done.push('done'), {}, deps);
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

test('expand keeps natural geometry underneath staggered row animations', async () => {
  // 展开方向同理：底层必须先是自然终态；否则先完成的行会在其 effect 退出
  // 后重新掉回 0 高，直到最后一行动画完成并统一清理。
  const rows = [makeRow(120, 16), makeRow(80, 16)];
  const { deps, flushMicrotask } = makeDeps(rows);
  const done: string[] = [];
  animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'expand', () => done.push('done'), {}, deps);
  flushMicrotask();
  await settleAnimation();

  assert.equal(rows[0].style.height, '120px', 'underlying height is the expanded terminal value');
  assert.equal(rows[0].style.marginTop, '16px', 'underlying spacing is already expanded');
  assert.equal(rows[0].style.opacity, '1', 'underlying opacity is already expanded');

  rows[0].anims[0].finish();
  await settleAnimation();
  assert.deepEqual(done, [], 'the group still waits for the second row');
  assert.equal(rows[0].style.height, '120px', 'the early row never falls back to zero height');
});

test('expand presets zero on first miss, then animates once content materializes', async () => {
  const rows = [makeRow(120, 16, false)]; // 内容未物化，首测只能得 0
  const { deps, flushTimeout, flushMicrotask } = makeDeps(rows);
  const done: string[] = [];
  animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'expand', () => done.push('done'), {}, deps);
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
  const handle = animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'expand', () => done.push('done'), {}, deps);
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
  animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'expand', () => done.push('done'), {}, deps);
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
    rows.map((row) => ({ el: row.el, role: 'member' as const })),
    'collapse',
    () => done.push('collapse'),
    {},
    deps,
  );
  await settleAnimation();
  handle.reverse(() => done.push('expand'));
  // 原生 reverse 保留动画当前进度；取消后从端点新建动画会产生肉眼跳变。
  assert.equal(rows[0].anims[0].cancelled, false, 'active animation stays attached');
  assert.equal(rows[0].anims[0].reverseCount, 1, 'WAAPI animation reverses in place');
  assert.equal(rows[0].anims.length, 1, 'no replacement animation was created');
  assert.equal(rows[0].style.height, '100px', 'underlying style switches to expanded terminal height');
  assert.equal(rows[0].style.opacity, '1', 'underlying style switches to expanded terminal opacity');
  rows[0].anims[0].finish();
  await settleAnimation();
  assert.deepEqual(done, ['expand'], 'only the reversed callback fires');
});

test('reverse during measurement restarts with the new direction', async () => {
  const rows = [makeRow(100, 12)];
  const { deps, flushMicrotask } = makeDeps(rows);
  const done: string[] = [];
  const handle = animateFoldRows(
    rows.map((row) => ({ el: row.el, role: 'member' as const })),
    'expand',
    () => done.push('expand'),
    {},
    deps,
  );
  // 首测微任务尚未执行时 reverse 到收起方向。
  handle.reverse(() => done.push('collapse'));
  flushMicrotask(); // 旧首测回调：generation 已变，必须放弃（不得预压）
  await settleAnimation();
  rows[0].anims[0]?.finish();
  await settleAnimation();
  assert.deepEqual(done, ['collapse'], 'measurement-phase reverse wins');
  assert.equal(rows[0].style.height, '0px', 'collapse give-up pins the terminal state (row stays hidden)');
  assert.equal(rows[0].style.opacity, '0');
  assert.equal(rows[0].anims.length, 1, 'exactly one animation (collapse) ran');
});

test('reverse during preset zero clears the constraint and collapses', async () => {
  const rows = [makeRow(100, 12, false)];
  const { deps, flushTimeout, flushMicrotask } = makeDeps(rows);
  const done: string[] = [];
  const handle = animateFoldRows(
    rows.map((row) => ({ el: row.el, role: 'member' as const })),
    'expand',
    () => done.push('expand'),
    {},
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
  animateFoldRows([], 'expand', () => done.push('empty'), {}, makeDeps([untouched]).deps);
  const reduced = [makeRow(50, 10)];
  animateFoldRows(
    reduced.map((row) => ({ el: row.el, role: 'member' as const })),
    'collapse',
    () => done.push('reduced'),
    {},
    makeDeps(reduced, true).deps,
  );
  assert.deepEqual(done, ['empty', 'reduced']);
  assert.equal(untouched.style.height, undefined, 'no style was written');
  assert.equal(reduced[0].style.height, undefined);
});

test('handle active state distinguishes a live animation from synchronous fallback', async () => {
  const rows = [makeRow(50, 10)];
  const { deps } = makeDeps(rows);
  const handle = animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'collapse', () => {}, {}, deps);
  await settleAnimation();
  assert.equal(handle.active, true, 'started animation is active');
  handle.cancel();
  assert.equal(handle.active, false, 'cancelled animation is inactive');

  const immediate = animateFoldRows([], 'expand', () => {}, {}, deps);
  assert.equal(immediate.active, false, 'synchronous fallback never exposes a stale handle');
});

test('cancel cleans up without firing the completion callback', async () => {
  const rows = [makeRow(90, 16)];
  const { deps } = makeDeps(rows);
  const done: string[] = [];
  const handle = animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'collapse', () => done.push('done'), {}, deps);
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
  const handle = animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'expand', () => done.push('done'), {}, deps);
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
  const handle = animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'expand', () => done.push('expand'), {}, deps);
  flushMicrotask(); // 首测失败 → 预压
  const active = handle.reverse(() => done.push('collapse'));
  assert.equal(active, false, 'reverse that settles synchronously reports inactive');
  assert.deepEqual(done, ['collapse'], 'done fired exactly once (no double call)');
  assert.equal(rows[0].style.height, '0px', 'collapse give-up pins the terminal state');
  assert.equal(rows[0].style.opacity, '0');

  // 活跃反转：collapse 动画中 reverse 到 expand，动画继续 → true。
  const rows2 = [makeRow(100, 12)];
  const { deps: deps2 } = makeDeps(rows2);
  const handle2 = animateFoldRows(rows2.map((row) => ({ el: row.el, role: 'member' as const })), 'collapse', () => {}, {}, deps2);
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
  animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'expand', () => done.push('done'), {}, deps);
  flushMicrotask();
  await settleAnimation();
  const anim = rows[0].anims[0];
  anim.reject(); // finished=false 时的 reject（非本代码 cancel）
  await settleAnimation();
  assert.deepEqual(done, ['done'], 'external cancel settles immediately');
  assert.equal(rows[0].style.height, '', 'styles restored right away');
  assert.ok(!rows[0].classes.has('dsh-tf-animating'));
});

test('collapse companions animate their own geometry and hidden settle clears all styles', async () => {
  // flip 落地后的正常收起路径：settle 时成员行已 hidden——直接清全部样式
  // （含伴生行），不再走钉住兜底。
  const member = makeRow(120, 16);
  const bar = makeRow(33, 0);
  const answer = makeRow(800, 16);
  for (const row of [member, bar, answer]) {
    (row.el as unknown as { hasAttribute: (n: string) => boolean }).hasAttribute = (n) => n === 'hidden';
  }
  const { deps } = makeDeps([member, bar, answer]);
  const done: string[] = [];
  const handle = animateFoldRows([
    { el: member.el, role: 'member' },
    { el: bar.el, role: 'companion', from: { height: 33, marginTop: 16, marginBottom: 0 }, to: { height: 33, marginTop: 0, marginBottom: 8 } },
    { el: answer.el, role: 'companion', from: { height: 800, marginTop: 16 }, to: { height: 800, marginTop: 8 } },
  ], 'collapse', () => done.push('done'), {}, deps);
  await settleAnimation();
  assert.equal(bar.anims.length, 1, 'bar companion animated once');
  const [barFrom, barTo] = bar.anims[0].frames;
  assert.equal(barFrom.marginBottom, '0px', 'bar starts at open margin');
  assert.equal(barTo.marginBottom, '8px', 'bar ends at closed margin');
  assert.equal(answer.anims.length, 1, 'answer companion animated once');
  const [ansFrom, ansTo] = answer.anims[0].frames;
  assert.equal(ansFrom.height, '800px', 'answer keeps its open height during collapse');
  assert.equal(ansFrom.marginTop, '16px');
  assert.equal(ansTo.marginTop, '8px', 'answer margin settles at compact value');
  assert.equal(ansFrom.opacity, undefined, 'companion opacity untouched');
  assert.equal(handle.flipFired, false, 'no onFlip wired in this test');
  bar.anims[0].finish();
  answer.anims[0].finish();
  member.anims[0].finish();
  await settleAnimation();
  assert.deepEqual(done, ['done']);
  assert.equal(member.style.height, '', 'hidden settle clears member styles (no pin)');
  assert.equal(answer.style.marginTop, '', 'companion styles cleared');
  assert.equal(bar.style.marginBottom, '', 'bar styles cleared');
});

test('expand companions animate measured start to committed end and settle clears', async () => {
  const member = makeRow(120, 16);
  const bar = makeRow(33, 0);
  const answer = makeRow(800, 16);
  const { deps, flushMicrotask } = makeDeps([member, bar, answer]);
  const done: string[] = [];
  animateFoldRows([
    { el: member.el, role: 'member' },
    { el: bar.el, role: 'companion', from: { height: 33, marginTop: 0, marginBottom: 8 }, to: { height: 33, marginTop: 16, marginBottom: 0 } },
    { el: answer.el, role: 'companion', from: { height: 760, marginTop: 8 }, to: { height: 800, marginTop: 16 } },
  ], 'expand', () => done.push('done'), {}, deps);
  flushMicrotask(); // 展开首测（成员行微任务测量）
  await settleAnimation();
  assert.equal(bar.anims.length, 1);
  const [barFrom, barTo] = bar.anims[0].frames;
  assert.equal(barFrom.marginBottom, '8px', 'bar starts at closed margin');
  assert.equal(barTo.marginBottom, '0px', 'bar ends at open margin');
  const [ansFrom, ansTo] = answer.anims[0].frames;
  assert.equal(ansFrom.height, '760px', 'answer starts at compact height');
  assert.equal(ansTo.height, '800px', 'answer ends at open height');
  bar.anims[0].finish();
  answer.anims[0].finish();
  member.anims[0].finish();
  await settleAnimation();
  assert.deepEqual(done, ['done']);
  assert.equal(answer.style.height, '', 'companion styles cleared after expand settle');
  assert.equal(member.style.height, '', 'member styles restored to natural layout');
});

test('collapse arms onFlip near the animation end and never fires it twice', async () => {
  const rows = [makeRow(100, 12)];
  const { deps, flushTimeout, pendingTimeouts } = makeDeps(rows);
  const flips: number[] = [];
  const done: string[] = [];
  animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'collapse', () => done.push('done'), { onFlip: () => flips.push(1) }, deps);
  await settleAnimation();
  assert.ok(pendingTimeouts() >= 1, 'flip timer armed');
  flushTimeout(); // 队首是 flip 定时器（先于 720ms 兜底入队）
  assert.deepEqual(flips, [1], 'onFlip fired once before settle');
  rows[0].anims[0].finish();
  await settleAnimation();
  assert.deepEqual(flips, [1], 'settle does not re-fire a fired flip');
  assert.deepEqual(done, ['done']);
});

test('settle fires onFlip as a fallback when the flip timer never ran', async () => {
  const rows = [makeRow(100, 12)];
  const { deps } = makeDeps(rows);
  const flips: number[] = [];
  const done: string[] = [];
  animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'collapse', () => done.push('done'), { onFlip: () => flips.push(1) }, deps);
  await settleAnimation();
  rows[0].anims[0].finish();
  await settleAnimation();
  assert.deepEqual(flips, [1], 'fallback flip fired at settle');
  assert.deepEqual(done, ['done']);
});

test('cancel clears the armed flip without firing it', async () => {
  const rows = [makeRow(100, 12)];
  const { deps, flushTimeout } = makeDeps(rows);
  const flips: number[] = [];
  const handle = animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'collapse', () => {}, { onFlip: () => flips.push(1) }, deps);
  await settleAnimation();
  handle.cancel();
  flushTimeout();
  assert.deepEqual(flips, [], 'cancel must not fire onFlip');
});

test('reverse from expand to collapse re-arms a flip timer', async () => {
  const rows = [makeRow(100, 12)];
  const { deps, flushMicrotask, pendingTimeouts } = makeDeps(rows);
  const handle = animateFoldRows(rows.map((row) => ({ el: row.el, role: 'member' as const })), 'expand', () => {}, { onFlip: () => {} }, deps);
  flushMicrotask();
  await settleAnimation();
  assert.equal(pendingTimeouts(), 1, 'only the settle fallback timer before reverse');
  handle.reverse(() => {});
  assert.equal(pendingTimeouts(), 2, 'reverse to collapse armed a flip timer');
  handle.cancel();
});

test('companion catch-up animates the measured height delta and no-ops when equal', () => {
  const calls: Keyframe[][] = [];
  const fakeDeps = {
    animate: (_el: HTMLElement, frames: Keyframe[]) => {
      calls.push(frames);
      return { finished: Promise.resolve(), cancel() {}, reverse() {} };
    },
  };
  const el = { offsetHeight: 760 } as unknown as HTMLElement;
  animateCompanionCatchUp(el, 800, fakeDeps);
  assert.equal(calls.length, 1, 'height delta triggers one animation');
  assert.equal(calls[0][0].height, '800px', 'starts at the flip-time height');
  assert.equal(calls[0][1].height, '760px', 'ends at the committed height');
  animateCompanionCatchUp(el, 760, fakeDeps);
  assert.equal(calls.length, 1, 'equal heights do not animate');
});
