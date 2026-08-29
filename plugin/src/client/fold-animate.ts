/**
 * 折叠条展开/收起动画（v0.2 时代行高动画的回归版）。
 *
 * 官方 0.1.2 的折叠是瞬间的：ChatNodeSeat 直接切换成员行 wrapper 的
 * `hidden="until-found"`。本模块在官方状态机外围补回高度过渡——作用于本
 * turn 的成员行 flowItem（`data-chat-turn` + `data-turn-process-member`
 * 属性圈定，见官方 ChatNodeSeat），逐行过渡 height + margin-top（相邻行
 * 的间距是官方 `.column` 相邻选择器给的 margin-top，一并过渡到 0 才不会
 * 在收尾时跳一格），完成后移除全部内联样式交还官方布局。
 *
 * 时序约束（防闪帧）：展开方向必须在成员行刚摘 hidden 的同一帧内把行压
 * 到 0 高——调用方（fold-bar-view）在 open 翻转后的 layout effect 里经
 * requestAnimationFrame 启动；rAF 回调先于本轮 paint 执行，用户看不到
 * 「内容闪现一帧再收缩」的中间态。收起方向相反：先播过渡，落地后才让
 * 调用方 `setOpen(false)` 摘内容。
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
  readonly requestFrame: (cb: () => void) => unknown;
  readonly cancelFrame: (handle: unknown) => void;
  readonly scheduleTimeout: (cb: () => void, ms: number) => unknown;
  readonly cancelTimeout: (handle: unknown) => void;
  readonly measure: (el: HTMLElement) => RowMeasure;
  readonly reducedMotion: () => boolean;
}

const parsePx = (value: string): number => Number.parseFloat(value) || 0;

const browserDeps: FoldAnimateDeps = {
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (handle) => cancelAnimationFrame(handle as number),
  scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
  cancelTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  measure: (el) => ({
    height: el.offsetHeight,
    marginTop: parsePx(getComputedStyle(el).marginTop),
  }),
  reducedMotion: () =>
    typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-reduced-motion: reduce)').matches,
};

export interface FoldAnimationHandle {
  /**
   * 反转方向（动画进行中再次点击折叠条）。行保持在动画态，transition 从
   * 当前值平滑过渡到新目标；完成回调替换为 `onDone`。
   */
  reverse(onDone: () => void): void;
  /** 清理全部动画痕迹，不触发完成回调（组件卸载时用）。 */
  cancel(): void;
}

const DURATION_MS = 220;
/** transitionend 的兜底时限（reduced-motion 下事件不触发，靠它收尾）。 */
const SETTLE_TIMEOUT_MS = DURATION_MS + 40;

/**
 * 对成员行执行一次高度过渡。`rows` 为空或用户偏好减少动效时立即完成
 * （不写任何样式）。同一时刻一个 turn 只应有一个动画——再次交互由调用
 * 方通过 `reverse` 处理。
 */
export function animateFoldRows(
  rows: readonly HTMLElement[],
  direction: FoldDirection,
  onDone: () => void,
  deps: FoldAnimateDeps = browserDeps,
): FoldAnimationHandle {
  if (rows.length === 0 || deps.reducedMotion()) {
    onDone();
    return { reverse() { /* 已完成 */ }, cancel() { /* 无痕迹 */ } };
  }

  // natural 的测量时机按方向分治：收起方向行本来可见，同步测即可；展开
  // 方向必须在帧回调里测——本模块由调用方的 layout effect 启动，而 React
  // 的 layout effect 子先于父，此刻官方还没摘成员行的 hidden（display:none
  // 下 offsetHeight 恒为 0），提前测会把 natural 全测成 0，0→0 无过渡、
  // transitionend 永不来，最后只能靠兜底把内容直接弹到全高。
  const natural = new Map<HTMLElement, RowMeasure>();
  let direction_ = direction;
  const measureRow = (el: HTMLElement): RowMeasure => {
    let m = natural.get(el);
    if (m === undefined) {
      m = deps.measure(el);
      natural.set(el, m);
    }
    return m;
  };
  if (direction_ === 'collapse') {
    for (const el of rows) measureRow(el);
  }
  let finished = false;
  let done = onDone;
  let frame: unknown;
  let timeout: unknown;
  let watched = new AbortController();

  const lockRow = (el: HTMLElement): void => {
    el.classList.add('dsh-tf-animating');
    el.style.overflow = 'hidden';
    if (direction_ === 'expand') {
      el.style.height = '0px';
      el.style.marginTop = '0px';
      el.style.opacity = '0';
    } else {
      const m = measureRow(el);
      el.style.height = `${m.height}px`;
      el.style.marginTop = `${m.marginTop}px`;
    }
  };

  const setTargets = (el: HTMLElement): void => {
    if (direction_ === 'expand') {
      const m = measureRow(el);
      el.style.height = `${m.height}px`;
      el.style.marginTop = `${m.marginTop}px`;
      el.style.opacity = '';
    } else {
      el.style.height = '0px';
      el.style.marginTop = '0px';
      el.style.opacity = '0';
    }
  };

  const clearStyles = (): void => {
    for (const el of rows) {
      el.classList.remove('dsh-tf-animating');
      el.style.height = '';
      el.style.marginTop = '';
      el.style.opacity = '';
      el.style.overflow = '';
    }
  };

  const settle = (): void => {
    if (finished) return;
    finished = true;
    watched.abort();
    if (timeout !== undefined) deps.cancelTimeout(timeout);
    if (frame !== undefined) deps.cancelFrame(frame);
    clearStyles();
    done();
  };

  const watchSettle = (): void => {
    watched.abort();
    watched = new AbortController();
    let remaining = rows.length;
    for (const el of rows) {
      el.addEventListener('transitionend', (event) => {
        if (event.target === el && event.propertyName === 'height') {
          remaining -= 1;
          if (remaining <= 0) settle();
        }
      }, { signal: watched.signal });
    }
    if (timeout !== undefined) deps.cancelTimeout(timeout);
    timeout = deps.scheduleTimeout(settle, SETTLE_TIMEOUT_MS);
  };

  // 完成兜底（timeout + transitionend 监听）同步排布，不依赖帧回调——被
  // 遮挡/后台的 tab 里 requestAnimationFrame 完全不执行，若把收尾链路放进
  // 帧，动画会卡死在锁定帧（内容被压 0 高且永不清理）。
  const startFrame = (): void => {
    frame = deps.requestFrame(() => {
      frame = undefined;
      if (finished) return;
      for (const el of rows) setTargets(el);
    });
  };

  // 第一帧锁定起点（含一次强制 reflow，让 0 值先生效），下一帧写目标，
  // transition 才有「从哪到哪」。
  for (const el of rows) lockRow(el);
  void rows[0]?.offsetHeight;
  watchSettle();
  startFrame();

  return {
    reverse(nextDone: () => void): void {
      if (finished) {
        nextDone();
        return;
      }
      direction_ = direction_ === 'expand' ? 'collapse' : 'expand';
      done = nextDone;
      if (frame !== undefined) {
        // 起点帧还没跑（点击过快）：作废本次帧，按新方向重新锁定。
        deps.cancelFrame(frame);
        frame = undefined;
        for (const el of rows) lockRow(el);
        void rows[0]?.offsetHeight;
        watchSettle();
        startFrame();
        return;
      }
      for (const el of rows) setTargets(el);
      watchSettle();
    },
    cancel(): void {
      if (finished) return;
      finished = true;
      watched.abort();
      if (timeout !== undefined) deps.cancelTimeout(timeout);
      if (frame !== undefined) deps.cancelFrame(frame);
      clearStyles();
    },
  };
}
