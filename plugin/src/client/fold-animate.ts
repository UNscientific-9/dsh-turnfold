/**
 * 折叠条展开/收起动画：逐行动画成员行 wrapper（`data-chat-turn` +
 * `data-turn-process-member` 圈定）的 height + margin-top，完成后移除全部
 * 内联样式交还官方布局。
 *
 * 时序（防闪帧）：官方在父组件 ChatNodeSeat 的 useLayoutEffect 里切
 * `hidden="until-found"`（React layout effect 子先于父），展开方向必须让
 * 「压 0 + 隐身」的约束落在 paint 前，否则内容先以完整形态闪一帧再被压没：
 *
 * 1. 首选微任务测量——微任务在整棵树的 layout effect（含官方父组件摘
 *    hidden）跑完之后、浏览器 paint 之前执行。此时行高可测，测到后同一
 *    同步块内压 0、隐身、启动动画，内容从未以完整形态上屏。
 * 2. 微任务里测不到（行内容异步物化）则立即预压 0 阻止后续帧继续闪现，
 *    回退 setTimeout 轮询；轮询测量走「临时解除 height 约束 → 读
 *    offsetHeight → 立即写回」（同步块内无中间 paint）。至多 3 次仍测不到
 *    就放弃动画（清约束回退官方瞬间切换），绝不把 0 当目标。
 *
 * 收起方向行本就可见，首帧同步测量。测量不到自然高时放弃动画。
 *
 * 驱动用 Web Animations API（el.animate）：由浏览器合成器驱动，不依赖 rAF
 * 或 CSS transition 的「起点帧」——IAB 后台/未激活面板里 rAF 停发、渲染帧
 * 被抑制，CSS transition 的起点无法可靠建立（同帧「锁自然高 + 写 0」会让
 * 起点被覆盖成 0，动画直接跳 0），WAAPI 则照常播放。微任务同样不依赖
 * rAF，后台场景时序不变。
 */

/** 官方成员行 wrapper 的圈定选择器（见 ChatNodeSeat 的 data-* 契约）。 */
export function processRowsSelector(turn: number): string {
  return `[data-chat-turn="${turn}"][data-turn-process-member]:not([data-turn-process-hidden])`;
}

/**
 * 收集本 turn 当前可见的成员行。`barRoot` 是折叠条 button 本身——它和成
 * 员行互为兄弟，都在同一个 flow 列容器下，从最近的 flowItem wrapper 上
 * 取 parentElement 即该容器。
 */
export function collectProcessRows(turn: number, barRoot: HTMLElement): HTMLElement[] {
  const column = barRoot.closest('[data-chat-flow-key]')?.parentElement;
  if (column === null || column === undefined) return [];
  return [...column.querySelectorAll<HTMLElement>(processRowsSelector(turn))];
}

export type FoldDirection = 'expand' | 'collapse';

/** 单行动画需要的几何量（height 用 border-box 总高，与内联 height 语义一致）。 */
export interface RowMeasure {
  readonly height: number;
  readonly marginTop: number;
}

export interface FoldAnimateDeps {
  /** 注入微任务调度（测试手动驱动；浏览器为 queueMicrotask）。 */
  readonly scheduleMicrotask: (cb: () => void) => void;
  readonly scheduleTimeout: (cb: () => void, ms: number) => unknown;
  readonly cancelTimeout: (handle: unknown) => void;
  readonly measure: (el: HTMLElement) => RowMeasure;
  readonly reducedMotion: () => boolean;
  /** 注入 Web Animations API（测试可替换为假动画）。 */
  readonly animate: (el: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    readonly finished: Promise<unknown>;
    cancel(): void;
  };
}

/**
 * 等成员行「布局就绪」再测量自然高。官方 hidden 由父组件 ChatNodeSeat 的
 * useLayoutEffect 摘除（React layout effect 子先于父），所以行从 hidden 到
 * 可见后，内容（工具卡片等）可能异步物化，offsetHeight 要等内容渲染完才
 * 稳定。
 *
 * 收起方向行本就可见，首帧同步测量，未就绪直接放弃（退化官方瞬间切换）。
 * 展开方向先用微任务首测（paint 前，见文件头注释），首测不全成功则预压 0
 * （`presetZero`）并回退 setTimeout 轮询——预压后行高为 0，测量改走「临时
 * 解除 height 约束 → 读 → 立即写回」。`isStale` 供测量中途 reverse/cancel/
 * finish 时作废未决的调度（否则旧回调会再次预压/挂轮询，留下无人清理的
 * 预压样式）。仍测不到就放弃，绝不把 0 当目标。
 */
function measureWhenReady(
  rows: readonly HTMLElement[],
  direction: FoldDirection,
  deps: FoldAnimateDeps,
  presetZero: () => void,
  isStale: () => boolean,
): Promise<RowMeasure[]> | undefined {
  const natural = new Map<HTMLElement, RowMeasure>();
  let preset = false;
  // 预压态下直接测 offsetHeight/computed marginTop 只会得 0：临时解除
  // height/margin 约束读真实自然值再写回。解除与写回在同一同步块内（异常
  // 也不留半解除态），中间不会 paint。
  const measureRow = (el: HTMLElement): boolean => {
    let m: RowMeasure;
    if (preset) {
      const prevHeight = el.style.height;
      const prevMargin = el.style.marginTop;
      try {
        el.style.height = '';
        el.style.marginTop = '';
        m = deps.measure(el);
      } finally {
        el.style.height = prevHeight;
        el.style.marginTop = prevMargin;
      }
    } else {
      m = deps.measure(el);
    }
    if (m.height <= 0) return false;
    natural.set(el, m);
    return true;
  };
  const ready = (): boolean => {
    for (const el of rows) {
      if (!natural.has(el) && !measureRow(el)) return false;
    }
    return true;
  };
  if (direction === 'collapse') {
    return ready() ? Promise.resolve([...natural.values()]) : undefined;
  }
  return new Promise((resolve) => {
    let attempts = 0;
    const poll = (): void => {
      if (isStale()) return;
      attempts += 1;
      if (ready()) {
        resolve([...natural.values()]);
        return;
      }
      // 微任务首测后至多重试 2 次（总测量机会 3 次，约 ~50ms）。仍测不到
      // 就放弃动画（回退官方瞬间切换），绝不把 0 当目标。
      if (attempts >= 3) {
        resolve([]);
        return;
      }
      deps.scheduleTimeout(poll, 16);
    };
    deps.scheduleMicrotask(() => {
      if (isStale()) return;
      attempts += 1;
      if (ready()) {
        resolve([...natural.values()]);
        return;
      }
      // 首测失败（行内容未物化）：立即预压 0 阻止后续帧闪现，再轮询。
      preset = true;
      presetZero();
      deps.scheduleTimeout(poll, 0);
    });
  });
}

const parsePx = (value: string): number => Number.parseFloat(value) || 0;

const browserDeps: FoldAnimateDeps = {
  scheduleMicrotask: (cb) => queueMicrotask(cb),
  scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
  cancelTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  measure: (el) => ({
    height: el.offsetHeight,
    marginTop: parsePx(getComputedStyle(el).marginTop),
  }),
  reducedMotion: () =>
    typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-reduced-motion: reduce)').matches,
  animate: (el, frames, options) => el.animate(frames, options),
};

export interface FoldAnimationHandle {
  /**
   * 反转方向（动画进行中再次点击折叠条）。行保持在动画态，WAAPI 动画从
   * 当前值平滑过渡到新目标；完成回调替换为 `onDone`。
   *
   * 返回动画是否仍然活跃：返回 false 表示已同步终止（此前已完成，或反转
   * 落在同步 settle 上）——完成回调已触发，调用方不得再保留/刷新对本
   * handle 的引用，否则已完成的 handle 残留会让后续交互永久短路。
   */
  reverse(onDone: () => void): boolean;
  /** 清理全部动画痕迹，不触发完成回调（组件卸载时用）。 */
  cancel(): void;
}

const DURATION_MS = 220;

/**
 * 对成员行执行一次高度过渡。`rows` 为空或用户偏好减少动效时立即完成
 * （不写任何样式）。同一时刻一个 turn 只应有一个动画——再次交互由调用
 * 方通过 `reverse` 处理。
 *
 * 时序（等 hidden 摘后测高）：先等自然高就绪（展开方向微任务首测，失败
 * 预压 0 后 setTimeout 轮询至多 3 次总机会；收起方向首帧同步），就绪后用
 * **Web Animations API**（el.animate）驱动 height/margin-top/opacity 过渡。
 * WAAPI 由浏览器合成器驱动，不依赖 requestAnimationFrame 或 CSS transition
 * 的「起点帧」——IAB 后台/未激活面板里 rAF 停发、渲染帧被抑制，CSS
 * transition 的起点无法可靠建立（同帧「锁自然高 + 写 0」会让起点被覆盖成
 * 0，动画直接跳 0），WAAPI 则照常播放。测量不到自然高时放弃动画（回退
 * 官方瞬间切换），绝不把 0 当目标（0→0 无过渡 = 内容消失）。
 */
export function animateFoldRows(
  rows: readonly HTMLElement[],
  direction: FoldDirection,
  onDone: () => void,
  deps: FoldAnimateDeps = browserDeps,
): FoldAnimationHandle {
  if (rows.length === 0 || deps.reducedMotion()) {
    onDone();
    return { reverse() { return false; }, cancel() { /* 无痕迹 */ } };
  }

  let direction_ = direction;
  let finished = false;
  let done = onDone;
  let animations = new Map<HTMLElement, ReturnType<FoldAnimateDeps['animate']>>();
  let timeout: unknown;

  const clearStyles = (): void => {
    for (const el of rows) {
      el.classList.remove('dsh-tf-animating');
      el.style.height = '';
      el.style.marginTop = '';
      el.style.opacity = '';
      el.style.overflow = '';
    }
  };

  /** 展开首测失败的预压：与展开动画起点一致的 0 高隐身态（防闪现）。 */
  const presetZero = (): void => {
    for (const el of rows) {
      el.classList.add('dsh-tf-animating');
      el.style.overflow = 'hidden';
      el.style.height = '0px';
      el.style.marginTop = '0px';
      el.style.opacity = '0';
    }
  };

  const settle = (): void => {
    if (finished) return;
    finished = true;
    for (const anim of animations.values()) anim.cancel();
    animations.clear();
    if (timeout !== undefined) deps.cancelTimeout(timeout);
    clearStyles();
    done();
  };

  const runAnimation = (measures: RowMeasure[]): void => {
    for (let i = 0; i < rows.length; i += 1) {
      const el = rows[i];
      const m = measures[i];
      if (el === undefined || m === undefined) continue;
      el.classList.add('dsh-tf-animating');
      el.style.overflow = 'hidden';
      const expand = direction_ === 'expand';
      const fromHeight = expand ? 0 : m.height;
      const toHeight = expand ? m.height : 0;
      const fromMargin = expand ? 0 : m.marginTop;
      const toMargin = expand ? m.marginTop : 0;
      // 展开淡入（0→1）、收起淡出（1→0）：动画全程内容可见性连续过渡，
      // 结束时与无约束的稳态值一致，settle 清样式不产生跳变。
      const fromOpacity = expand ? '0' : '1';
      const toOpacity = expand ? '1' : '0';
      // 先把起点值落到内联样式（无过渡，WAAPI 接管后续），确保收起方向
      // 起点 = 自然高（内容先保持可见再收起）。
      el.style.height = `${fromHeight}px`;
      el.style.marginTop = `${fromMargin}px`;
      el.style.opacity = fromOpacity;
      const anim = deps.animate(el, [
        { height: `${fromHeight}px`, marginTop: `${fromMargin}px`, opacity: fromOpacity },
        { height: `${toHeight}px`, marginTop: `${toMargin}px`, opacity: toOpacity },
      ], { duration: DURATION_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
      animations.set(el, anim);
      void anim.finished.then(() => {
        if (finished) return;
        animations.delete(el);
        if (animations.size === 0) settle();
      }).catch(() => {
        // cancelled：本代码 cancel/reverse 会先置 finished，这里的 reject 是
        // 浏览器外部取消（如行脱离文档）——立即 settle 恢复布局，不等兜底
        // timeout（否则展开方向内联起点 = 隐身态，内容不可见至 720ms）。
        if (!finished) settle();
      });
    }
    // 兜底 timeout 覆盖异常场景（动画被浏览器中止但 finished 未 resolve）。
    timeout = deps.scheduleTimeout(settle, DURATION_MS + 500);
  };

  // —— 状态机：measuring（等自然高就绪）→ animating（过渡中）→ done ——
  // reverse 在 measuring 阶段重新测量（方向已变，旧轮询的 natural 缓存
  // 无效）：generation 递增，旧测量回调检测到变化即放弃。
  let phase: 'measuring' | 'animating' | 'done' = 'measuring';
  let currentMeasures: RowMeasure[] | undefined;
  let generation = 0;

  const begin = (): void => {
    const myGeneration = generation;
    // 测量阶段的兜底由 measureWhenReady 自带（展开微任务首测失败预压后
    // 轮询至多 3 次总机会后 resolve([])，收起首帧失败返回 undefined）——
    // 不再额外挂 timeout，避免与轮询在假时序里互相覆盖。isStale 纳入
    // finished：cancel（即使发生在首测微任务执行前）后旧回调不得再预压。
    const stale = (): boolean => finished || myGeneration !== generation;
    const readyPromise = measureWhenReady(rows, direction_, deps, presetZero, stale);
    if (readyPromise === undefined) {
      // 收起方向首帧测不到自然高：行不可见/未物化，放弃动画走官方瞬间切换。
      settle();
      return;
    }
    void readyPromise.then((measures) => {
      if (finished || phase === 'done' || myGeneration !== generation) return;
      if (measures.length === 0) {
        settle(); // 展开方向 3 次仍测不到（隐藏行/内容异步）：放弃动画。
        return;
      }
      if (phase !== 'measuring') return;
      currentMeasures = measures;
      phase = 'animating';
      runAnimation(measures);
    });
  };

  begin();

  return {
    reverse(nextDone: () => void): boolean {
      if (finished || phase === 'done') {
        nextDone();
        return false;
      }
      direction_ = direction_ === 'expand' ? 'collapse' : 'expand';
      done = nextDone;
      if (phase === 'measuring') {
        // 测量还没出结果：重新发起（旧测量回调因 isStale 被放弃）。展开
        // 首测失败后的预压态行被压 0，收起方向同步测量会得 0 高——先解除
        // 预压恢复自然布局再重测。begin 内可能同步 settle（收起首帧测不
        // 到即放弃），以 finished 区分「仍活跃」与「已终止」。
        generation += 1;
        clearStyles();
        begin();
        return !finished;
      }
      if (currentMeasures === undefined) {
        // 理论不可达（animating 蕴含 currentMeasures 已赋值）；防御分支只
        // 走 settle——它已调用新 done，不得再显式 nextDone 造成双调。
        settle();
        return false;
      }
      // 动画进行中反转：取消旧动画，从当前值过渡到新方向目标。
      for (const anim of animations.values()) anim.cancel();
      animations.clear();
      if (timeout !== undefined) deps.cancelTimeout(timeout);
      runAnimation(currentMeasures);
      return true;
    },
    cancel(): void {
      if (finished) return;
      finished = true;
      for (const anim of animations.values()) anim.cancel();
      animations.clear();
      if (timeout !== undefined) deps.cancelTimeout(timeout);
      clearStyles();
    },
  };
}
