/**
 * 折叠条展开/收起动画：逐行动画成员行 wrapper（`data-chat-turn` +
 * `data-turn-process-member` 圈定）的 height + margin-top + opacity，并把
 * open 翻转的「官方伴生几何」（折叠条 closed 态 margin-bottom、answer 行的
 * compact 形态切换）一并纳入同一组 WAAPI 过渡。
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
 * open 翻转的官方提交会瞬时改一批非成员行的几何（真机逐帧实证的抽动源，
 * 成员行动画本身平滑）：
 * - 折叠条 closed 态 `margin-bottom: 8px`（本插件 styles 的
 *   `.dsh-tf-bar:not([data-open])` 规则）会把 bar 与 answer 之间的行（如
 *   system-prompt）净推下 8px——官方的补偿只对冲 answer 行自身的
 *   margin-top（16→8），中间夹层行无人补偿；
 * - answer 行内容随 open 重渲染，自身高度瞬间 ±40px（compactAnswer 形态
 *   差来自 React 内容而非 CSS 属性，挂 `data-turn-process-answer` 属性无法
 *   复现，动画前测不到终值）。
 * 对策分三段：① bar 的 margin-bottom 是我们自己的元素与规则，收起时随主
 * 动画 WAAPI 渐变到 closed 值（夹层行被平滑推下），提交帧官方值与动画终值
 * 一致；② open 翻转提前到主动画尾段（`onFlip`，剩约 70ms 时
 * `setOpen(false)`）——hidden 挂上时成员行 opacity 已近 0，answer 形态切换
 * 落在收拢运动尾窗内；③ answer 高度差在 flip 落地后由视图层读官方新值补
 * 一段短 WAAPI（从 flip 前实测值平滑到提交后实测值），两段值都是实测、无
 * 硬编码。快速连点则原地 `Animation.reverse()`，保留当前进度。
 *
 * 驱动用 Web Animations API（el.animate）：由浏览器动画时间线驱动，不依赖
 * rAF 或 CSS transition 的「起点帧」——IAB 后台/未激活面板里 rAF 停发、渲染帧
 * 被抑制，CSS transition 的起点无法可靠建立（同帧「锁自然高 + 写 0」会让
 * 起点被覆盖成 0，动画直接跳 0），WAAPI 则照常播放。微任务同样不依赖
 * rAF，后台场景时序不变。
 */

/** 官方成员行 wrapper 的圈定选择器（见 ChatNodeSeat 的 data-* 契约）。 */
export function processRowsSelector(turn: number): string {
  return `[data-chat-turn="${turn}"][data-turn-process-member]:not([data-turn-process-hidden])`;
}

/** 官方 flow 列容器（折叠条与成员行的共同父列，拓扑契约见 architecture.md）。 */
export function resolveFlowColumn(barRoot: HTMLElement): HTMLElement | undefined {
  return barRoot.closest('[data-chat-flow-key]')?.parentElement ?? undefined;
}

/**
 * 收集本 turn 当前可见的成员行。
 */
export function collectProcessRows(turn: number, barRoot: HTMLElement): HTMLElement[] {
  const column = resolveFlowColumn(barRoot);
  if (column === undefined) return [];
  return [...column.querySelectorAll<HTMLElement>(processRowsSelector(turn))];
}

/** 本 turn 全部成员行 wrapper（含已 hidden 的，供清理钉住样式）。 */
export function allProcessRowsSelector(turn: number): string {
  return `[data-chat-turn="${turn}"][data-turn-process-member]`;
}

/**
 * 清理收起终态钉住的成员行样式。兜底路径专用：flip 之后的正常路径 settle
 * 时行已 hidden、直接清理，不走这里。在官方 hidden 落地后的宏任务里由视
 * 图调用；不筛选 hidden——钉住窗口期行尚未挂 hidden，必须能命中。
 */
export function clearPinnedRows(turn: number, barRoot: HTMLElement): void {
  const column = resolveFlowColumn(barRoot);
  if (column === undefined) return;
  for (const el of column.querySelectorAll<HTMLElement>(allProcessRowsSelector(turn))) {
    clearRowInline(el);
  }
}

function clearRowInline(el: HTMLElement): void {
  el.classList.remove('dsh-tf-animating');
  el.style.height = '';
  el.style.marginTop = '';
  el.style.marginBottom = '';
  el.style.opacity = '';
  el.style.overflow = '';
}

export type FoldDirection = 'expand' | 'collapse';

/** 单行动画需要的几何量（height/margin 用 border-box 与 computed 像素值）。 */
export interface RowMeasure {
  readonly height: number;
  readonly marginTop: number;
}

/**
 * 伴生行的几何：在成员行 height/marginTop 之外还允许带 marginBottom
 * （折叠条自身的 closed 态补偿量）。
 */
export interface CompanionGeometry extends RowMeasure {
  readonly marginBottom?: number;
}

/** 一条动画目标：member 的 from/to 由测量阶段推导（省略）；companion 由视图实测必带。 */
export type FoldRowPlan =
  | { readonly el: HTMLElement; readonly role: 'member' }
  | {
      readonly el: HTMLElement;
      readonly role: 'companion';
      readonly from: CompanionGeometry;
      readonly to: CompanionGeometry;
    };

/** 把成员行元素装配成 member plan（视图与测试共用的样板收敛）。 */
export function memberPlans(rows: readonly HTMLElement[]): FoldRowPlan[] {
  return rows.map((el): FoldRowPlan => ({ el, role: 'member' }));
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
    reverse(): void;
  };
}

/**
 * 等成员行「布局就绪」再测量自然高（时序与驱动选型的完整论证见文件头）。
 * 官方 hidden 由父组件 ChatNodeSeat 的 useLayoutEffect 摘除（React layout
 * effect 子先于父），所以行从 hidden 到可见后，内容（工具卡片等）可能异步
 * 物化，offsetHeight 要等内容渲染完才稳定。
 *
 * 收起方向行本就可见，首帧同步测量，未就绪直接放弃（退化官方瞬间切换）。
 * 展开方向先用微任务首测，首测不全成功则预压 0（`presetZero`）并回退
 * setTimeout 轮询——预压后行高为 0，测量改走「临时解除 height 约束 → 读 →
 * 立即写回」。`isStale` 供测量中途 reverse/cancel/finish 时作废未决的调度
 * （否则旧回调会再次预压/挂轮询，留下无人清理的预压样式）。仍测不到就放弃，
 * 绝不把 0 当目标。伴生行几何由视图实测传入，不参与该测量。
 */
function measureWhenReady(
  rows: readonly HTMLElement[],
  direction: FoldDirection,
  deps: FoldAnimateDeps,
  presetZero: () => void,
  isStale: () => boolean,
): Promise<ReadonlyMap<HTMLElement, RowMeasure>> | undefined {
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
    return ready() ? Promise.resolve(natural) : undefined;
  }
  return new Promise((resolve) => {
    let attempts = 0;
    const poll = (): void => {
      if (isStale()) return;
      attempts += 1;
      if (ready()) {
        resolve(natural);
        return;
      }
      // 微任务首测后至多重试 2 次（总测量机会 3 次，约 ~50ms）。仍测不到
      // 就放弃动画（回退官方瞬间切换），绝不把 0 当目标。
      if (attempts >= 3) {
        resolve(new Map());
        return;
      }
      deps.scheduleTimeout(poll, 16);
    };
    deps.scheduleMicrotask(() => {
      if (isStale()) return;
      attempts += 1;
      if (ready()) {
        resolve(natural);
        return;
      }
      // 首测失败（行内容未物化）：立即预压 0 阻止后续帧闪现，再轮询。
      preset = true;
      presetZero();
      deps.scheduleTimeout(poll, 0);
    });
  });
}

/** CSS 像素值解析（'8px' → 8，异常/空串得 0）。 */
export const parsePx = (value: string): number => Number.parseFloat(value) || 0;

/**
 * 浏览器几何测量（border-box 高 + computed margin）；成员行与伴生行共用
 * 这一个口径——口径分叉是抽动的另一种成因。
 */
export function measureGeometry(el: HTMLElement, withMarginBottom = false): CompanionGeometry {
  const cs = getComputedStyle(el);
  return {
    height: el.offsetHeight,
    marginTop: parsePx(cs.marginTop),
    ...(withMarginBottom ? { marginBottom: parsePx(cs.marginBottom) } : {}),
  };
}

const browserDeps: FoldAnimateDeps = {
  scheduleMicrotask: (cb) => queueMicrotask(cb),
  scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
  cancelTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  measure: (el) => measureGeometry(el),
  reducedMotion: () =>
    typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-reduced-motion: reduce)').matches,
  animate: (el, frames, options) => el.animate(frames, options),
};

export interface FoldAnimationHandle {
  /** 是否仍在测量或播放；同步降级返回的 handle 从一开始就是 false。 */
  readonly active: boolean;
  /** 当前动画方向（reverse 时翻转）；视图由此推导反转目标，无需平行记账。 */
  readonly direction: FoldDirection;
  /**
   * collapse 主动画的 `onFlip`（提前 setOpen(false)）是否已触发。视图在
   * flip 后反转回 expand 时必须补 `setOpen(true)`——flip 已把官方 open 翻
   * 成 false，反转的 onDone 只靠方向判断会漏翻。
   */
  readonly flipFired: boolean;
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
 * open 翻转（flip）提前量：主动画剩这么多毫秒时触发 onFlip。足够晚——
 * 成员行 opacity 已衰减到接近 0，hidden 挂上无可感突变；也足够早——提交
 * 落地后仍有一段动画窗口消化 answer 形态切换。
 */
const FLIP_LEAD_MS = 70;
/** flip 落地后 answer 形态差的追赶动画时长。 */
const CATCH_UP_MS = 140;

/** 共享 WAAPI 时序；fill:both 临时覆盖终值，整组 settle 时同步 cancel 不残留。 */
const foldTiming = (duration: number): KeyframeAnimationOptions => ({
  duration,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
  fill: 'both',
});

export interface FoldAnimateOptions {
  /**
   * collapse 专用：主动画剩 `FLIP_LEAD_MS` 时触发一次（视图借此把
   * `setOpen(false)` 提前到动画尾段，官方提交的伴生几何全部落在动画窗
   * 口内）。幂等回调，settle 时若尚未触发会补发一次。
   */
  readonly onFlip?: () => void;
}

/**
 * 对成员行 + 伴生行执行一次高度过渡（测量的时序策略与 WAAPI 选型理由见
 * 文件头）：就绪后用 el.animate 驱动 height/margin/opacity 过渡。
 * `plans` 为空或用户偏好减少动效时立即完成（不写任何样式）。同一时刻一
 * 个 turn 只应有一个动画——再次交互由调用方通过 `reverse` 处理。测量不到
 * 自然高时放弃动画（回退官方瞬间切换），绝不把 0 当目标（0→0 无过渡 =
 * 内容消失）。
 */
export function animateFoldRows(
  plans: readonly FoldRowPlan[],
  direction: FoldDirection,
  onDone: () => void,
  options: FoldAnimateOptions = {},
  deps: FoldAnimateDeps = browserDeps,
): FoldAnimationHandle {
  const memberRows = plans
    .filter((plan): plan is Extract<FoldRowPlan, { role: 'member' }> => plan.role === 'member')
    .map((plan) => plan.el);
  const companions = plans.filter(
    (plan): plan is Extract<FoldRowPlan, { role: 'companion' }> => plan.role === 'companion',
  );
  if (memberRows.length === 0 || deps.reducedMotion()) {
    onDone();
    return {
      get active() { return false; },
      get direction() { return direction; },
      get flipFired() { return false; },
      reverse() { return false; },
      cancel() { /* 无痕迹 */ },
    };
  }

  let direction_ = direction;
  let finished = false;
  let done = onDone;
  const animations = new Map<HTMLElement, ReturnType<FoldAnimateDeps['animate']>>();
  let timeout: unknown;
  let flipTimer: unknown;
  let flipFired = false;
  let animationGeneration = 0;
  // undefined = measuring（等自然高就绪），赋值后 = animating（过渡中）。
  let currentMeasures: ReadonlyMap<HTMLElement, RowMeasure> | undefined;
  let measureGeneration = 0;

  const clearAllStyles = (): void => {
    for (const el of memberRows) clearRowInline(el);
    for (const plan of companions) clearRowInline(plan.el);
  };

  /** 收起的 0 高隐身态：预压与终态钉住共用同一写入（防闪现）。 */
  const writeCollapseTerminal = (el: HTMLElement): void => {
    el.classList.add('dsh-tf-animating');
    el.style.overflow = 'hidden';
    el.style.height = '0px';
    el.style.marginTop = '0px';
    el.style.opacity = '0';
  };

  /** 展开首测失败的预压：与展开动画起点一致的 0 高隐身态（防闪现）。 */
  const presetZero = (): void => {
    for (const el of memberRows) writeCollapseTerminal(el);
  };

  const cancelFallback = (): void => {
    if (timeout === undefined) return;
    deps.cancelTimeout(timeout);
    timeout = undefined;
  };

  const cancelFlipTimer = (): void => {
    if (flipTimer === undefined) return;
    deps.cancelTimeout(flipTimer);
    flipTimer = undefined;
  };

  /** settle/cancel/reverse 共用的失效序列：撤兜底 timeout 与 flip 定时器。 */
  const invalidate = (): void => {
    cancelFallback();
    cancelFlipTimer();
  };

  const fireFlip = (): void => {
    if (flipFired || finished || options.onFlip === undefined) return;
    flipFired = true;
    cancelFlipTimer();
    options.onFlip();
  };

  const armFlip = (delayMs: number): void => {
    if (options.onFlip === undefined || direction_ !== 'collapse' || flipFired) return;
    cancelFlipTimer();
    flipTimer = deps.scheduleTimeout(() => {
      flipTimer = undefined;
      fireFlip();
    }, delayMs);
  };

  const cancelAnimations = (): void => {
    for (const anim of animations.values()) anim.cancel();
    animations.clear();
  };

  /**
   * 把指定行的「底层指定样式」先写成当前方向的终态。WAAPI effect 只在
   * 上面覆盖视觉插值；任一行动画提前结束、被替换或被浏览器移除时，露出的
   * 仍是终态，不会恢复起点高度并带动后续元素抽动。伴生行不碰 opacity
   * （它们全程可见，只有几何参与过渡）。
   */
  const applyTerminalRow = (
    el: HTMLElement,
    target: FoldDirection,
    geometry?: CompanionGeometry,
  ): void => {
    if (geometry !== undefined) {
      el.classList.add('dsh-tf-animating');
      el.style.overflow = 'hidden';
      el.style.height = `${geometry.height}px`;
      el.style.marginTop = `${geometry.marginTop}px`;
      if (geometry.marginBottom !== undefined) el.style.marginBottom = `${geometry.marginBottom}px`;
      return;
    }
    const measure = currentMeasures?.get(el);
    if (measure === undefined) return;
    if (target === 'collapse') {
      writeCollapseTerminal(el);
      return;
    }
    el.classList.add('dsh-tf-animating');
    el.style.overflow = 'hidden';
    el.style.height = `${measure.height}px`;
    el.style.marginTop = `${measure.marginTop}px`;
    el.style.opacity = '1';
  };

  const applyTerminalStyles = (target: FoldDirection): void => {
    if (currentMeasures !== undefined) {
      for (const el of memberRows) applyTerminalRow(el, target);
    }
    for (const plan of companions) applyTerminalRow(plan.el, target, plan.to);
  };

  const settle = (): void => {
    if (finished) return;
    // collapse 的 onFlip 兜底：flip 定时器没来得及触发（异常调度）也要保
    // 证 open 终态翻转。幂等回调，重复调用无害。fireFlip 自带 finished
    // 守卫，必须在置位前调用。
    if (direction_ === 'collapse' && options.onFlip !== undefined) fireFlip();
    finished = true;
    measureGeneration += 1;
    animationGeneration += 1;
    invalidate();
    // 先把底层同步落到终态，再 cancel 临时 fill effect；两步处于同一同步块，
    // 浏览器没有机会画出动画起点或中间值。
    applyTerminalStyles(direction_);
    cancelAnimations();
    // 展开终态交还自然布局。收起终态：flip 已触发（正常路径）则官方
    // hidden 已落地，直接清样式不闪现；仅当 hidden 未落地（极端慢提交）
    // 时钉住 0 高，交由视图的 clearPinnedRows 宏任务兜底清理。
    if (direction_ === 'expand' || memberRows.every((el) => el.hasAttribute('hidden'))) {
      clearAllStyles();
    } else {
      presetZero();
    }
    done();
  };

  const watchAnimations = (): void => {
    const myGeneration = ++animationGeneration;
    const target = direction_;
    let remaining = animations.size;
    if (remaining === 0) {
      settle();
      return;
    }
    const completeTarget = (el: HTMLElement): void => {
      if (finished || myGeneration !== animationGeneration) return;
      // 每个成员各自完成时立即确认终态；不等待最后一个，杜绝错帧完成窗口。
      const companion = companions.find((plan) => plan.el === el);
      applyTerminalRow(el, target, companion?.to);
      remaining -= 1;
      if (remaining === 0) settle();
    };
    for (const [el, anim] of animations) {
      void anim.finished.then(
        () => completeTarget(el),
        // 浏览器外部取消同样安全落到终态；其他行继续，不把整组提前截断。
        () => completeTarget(el),
      );
    }
    timeout = deps.scheduleTimeout(() => {
      if (!finished && myGeneration === animationGeneration) settle();
    }, DURATION_MS + 500);
  };

  const runAnimation = (measures: ReadonlyMap<HTMLElement, RowMeasure>): void => {
    currentMeasures = measures;
    const expand = direction_ === 'expand';
    applyTerminalStyles(direction_);
    const animationOptions = foldTiming(DURATION_MS);
    const startAnimation = (
      el: HTMLElement,
      from: CompanionGeometry,
      to: CompanionGeometry,
      withOpacity: boolean,
    ): void => {
      const first: Keyframe = { height: `${from.height}px`, marginTop: `${from.marginTop}px` };
      const last: Keyframe = { height: `${to.height}px`, marginTop: `${to.marginTop}px` };
      if (from.marginBottom !== undefined) first.marginBottom = `${from.marginBottom}px`;
      if (to.marginBottom !== undefined) last.marginBottom = `${to.marginBottom}px`;
      if (withOpacity) {
        first.opacity = expand ? '0' : '1';
        last.opacity = expand ? '1' : '0';
      }
      animations.set(el, deps.animate(el, [first, last], animationOptions));
    };
    for (const [el, m] of measures) {
      // 展开淡入（0→1）、收起淡出（1→0）：动画全程内容可见性连续过渡。
      startAnimation(
        el,
        { height: expand ? 0 : m.height, marginTop: expand ? 0 : m.marginTop },
        { height: expand ? m.height : 0, marginTop: expand ? m.marginTop : 0 },
        true,
      );
    }
    for (const plan of companions) startAnimation(plan.el, plan.from, plan.to, false);
    if (direction_ === 'collapse') armFlip(DURATION_MS - FLIP_LEAD_MS);
    watchAnimations();
  };

  // —— 状态机：measuring（等自然高就绪）→ animating（过渡中），settle 即终 ——
  // reverse 在 measuring 阶段重新测量（方向已变，旧轮询的 natural 缓存
  // 无效）：generation 递增，旧测量回调检测到变化即放弃。
  const begin = (): void => {
    const myGeneration = measureGeneration;
    // 测量阶段的兜底由 measureWhenReady 自带（展开微任务首测失败预压后
    // 轮询至多 3 次总机会后 resolve([])，收起首帧失败返回 undefined）——
    // 不再额外挂 timeout，避免与轮询在假时序里互相覆盖。isStale 纳入
    // finished：cancel（即使发生在首测微任务执行前）后旧回调不得再预压。
    const stale = (): boolean => finished || myGeneration !== measureGeneration;
    const readyPromise = measureWhenReady(memberRows, direction_, deps, presetZero, stale);
    if (readyPromise === undefined) {
      // 收起方向首帧测不到自然高：行不可见/未物化，放弃动画走官方瞬间切换。
      settle();
      return;
    }
    void readyPromise.then((measures) => {
      if (finished || myGeneration !== measureGeneration) return;
      // 展开方向 3 次仍测不到（隐藏行/内容异步）：放弃动画。
      if (measures.size === 0) {
        settle();
        return;
      }
      runAnimation(measures);
    });
  };

  begin();

  return {
    get active(): boolean {
      return !finished;
    },
    get direction(): FoldDirection {
      return direction_;
    },
    get flipFired(): boolean {
      return flipFired;
    },
    reverse(nextDone: () => void): boolean {
      if (finished) {
        nextDone();
        return false;
      }
      direction_ = direction_ === 'expand' ? 'collapse' : 'expand';
      done = nextDone;
      if (currentMeasures === undefined) {
        // 测量还没出结果：重新发起（旧测量回调因 isStale 被放弃）。展开
        // 首测失败后的预压态行被压 0，收起方向同步测量会得 0 高——先解除
        // 预压恢复自然布局再重测。begin 内可能同步 settle（收起首帧测不
        // 到即放弃），以 finished 区分「仍活跃」与「已终止」。
        measureGeneration += 1;
        clearAllStyles();
        begin();
        return !finished;
      }
      // 动画进行中反转：保留同一批 WAAPI player 的当前进度，底层指定样式
      // 先切到新终态，再原地 reverse；取消重建会从端点重播并产生跳变。
      // flip 语义跟随新方向：反转成 collapse（此前是展开、flip 从未触发）
      // 重新武装一个短延迟 flip；反转成 expand 则撤掉未触发的 flip（open
      // 本就为 true）。flip 已触发过的情况由视图在 onDone 里补翻 open。
      invalidate();
      applyTerminalStyles(direction_);
      try {
        for (const anim of animations.values()) anim.reverse();
      } catch {
        // timeline 不可用等极端环境下稳定优先：同步落新终态并结束本组。
        settle();
        return false;
      }
      if (direction_ === 'collapse' && !flipFired) armFlip(FLIP_LEAD_MS);
      watchAnimations();
      return true;
    },
    cancel(): void {
      if (finished) return;
      finished = true;
      measureGeneration += 1;
      animationGeneration += 1;
      invalidate();
      cancelAnimations();
      clearAllStyles();
    },
  };
}

/**
 * flip 落地后的 answer 形态追赶：官方提交把 answer 行重渲染成 compact 形态
 * （高度差来自 React 内容，动画前测不到），此函数从 flip 前实测高度平滑过
 * 渡到提交后的当前实测高度。在视图的 open 翻 false layout effect 里同步调
 * 用（paint 前），`fill: both` 覆盖官方新值避免突变帧；动画结束自然释放回
 * 官方值。高度无差（未变化/已一致）则不启动。
 */
export function animateCompanionCatchUp(
  el: HTMLElement,
  fromHeight: number,
  deps: Pick<FoldAnimateDeps, 'animate'> = browserDeps,
): void {
  const toHeight = el.offsetHeight;
  if (Math.abs(toHeight - fromHeight) < 1) return;
  const anim = deps.animate(
    el,
    [
      { height: `${fromHeight}px` },
      { height: `${toHeight}px` },
    ],
    foldTiming(CATCH_UP_MS),
  );
  // 终帧与官方值一致：结束后取消 fill effect 交还官方样式（释放瞬间无
  // 视觉差），避免长期 fill 压住后续官方提交。
  void anim.finished.then(() => anim.cancel(), () => { /* 外部取消即已释放 */ });
}
