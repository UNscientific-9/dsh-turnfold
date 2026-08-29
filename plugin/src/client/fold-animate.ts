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
 * 时序约束（防闪帧）：官方在父组件 ChatNodeSeat 的 useLayoutEffect 里切
 * hidden（React layout effect 子先于父），所以展开方向必须「等布局就绪」
 * 再测量——hidden 摘除、offsetHeight 非 0 后才锁定 0 高、下一帧展开，
 * 否则会把 0 当目标（0→0 无过渡 = 内容消失）。收起方向行本就可见，首帧
 * 同步测量。测量不到自然高时放弃动画（回退官方瞬间切换），绝不把 0 当
 * 目标。详见 measureWhenReady。
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
  /** 注入 Web Animations API（测试可替换为假动画）。 */
  readonly animate: (el: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    readonly finished: Promise<unknown>;
    cancel(): void;
  };
}

/**
 * 等成员行「布局就绪」再测量自然高。
 *
 * 官方把成员行的 `hidden="until-found"` 放在父组件 ChatNodeSeat 的
 * `useSearchableHidden` useLayoutEffect 里切换；React layout effect 子先于
 * 父，所以本插件（子）的动画 effect 跑时，官方还没摘 hidden——成员行仍是
 * `hidden` 的 0 高 box，`offsetHeight` 恒为 0。若此时测量自然高，会把
 * 0 当目标，`0→0` 无过渡，内容要么消失一瞬（等父摘 hidden 后弹出）、要么
 * 收起时直接塌掉（父先摘 hidden 内容先消失）。
 *
 * 就绪判定：`measure(el)` 返回的 height > 0 才认为布局就绪。展开方向
 * （行从 hidden 到可见）必须在 rAF 回调里轮询——父 layout effect 在提交
 * 阶段已执行，hidden 已摘，但内容（工具卡片等）可能异步物化，offsetHeight
 * 要等内容渲染完才稳定。收起方向行本就可见，首帧同步测量即可。
 */
function measureWhenReady(
  rows: readonly HTMLElement[],
  direction: FoldDirection,
  deps: FoldAnimateDeps,
): Promise<RowMeasure[]> | undefined {
  const natural = new Map<HTMLElement, RowMeasure>();
  const measureRow = (el: HTMLElement): RowMeasure | undefined => {
    const m = deps.measure(el);
    if (m.height <= 0) return undefined;
    natural.set(el, m);
    return m;
  };
  const ready = (): boolean => {
    for (const el of rows) {
      if (measureRow(el) === undefined) return false;
    }
    return true;
  };
  if (direction === 'collapse') {
    // 收起方向行本就可见：首帧同步测，未就绪直接放弃（退化官方瞬间切换）。
    return ready() ? Promise.resolve([...natural.values()]) : undefined;
  }
  // 展开方向用 setTimeout 轮询（而非 requestAnimationFrame）：IAB 后台/
  // 未激活面板里 rAF 停发，依赖它轮询会永远测不到就绪 → 动画被放弃。
  // setTimeout 在后台照常触发，hidden 摘除后最多等 ~3 帧即可测到。
  return new Promise((resolve) => {
    let attempts = 0;
    const poll = (): void => {
      attempts += 1;
      if (ready()) {
        resolve([...natural.values()]);
        return;
      }
      // 最多等 3 次（约 50ms）。hidden 摘除后高度应立即可测；内容异步
      // 物化的行可能要几帧才稳定。仍测不到就放弃动画（回退官方瞬间切换），
      // 绝不把 0 当目标。
      if (attempts >= 3) {
        resolve([]);
        return;
      }
      deps.scheduleTimeout(poll, 16);
    };
    deps.scheduleTimeout(poll, 0);
  });
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
  animate: (el, frames, options) => el.animate(frames, options),
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

/**
 * 对成员行执行一次高度过渡。`rows` 为空或用户偏好减少动效时立即完成
 * （不写任何样式）。同一时刻一个 turn 只应有一个动画——再次交互由调用
 * 方通过 `reverse` 处理。
 *
 * 时序（等 hidden 摘后测高）：先等自然高就绪（展开方向轮询至多 3 次，
 * 收起方向首帧），就绪后用 **Web Animations API**（el.animate）驱动
 * height/margin-top 过渡。WAAPI 由浏览器合成器驱动，不依赖
 * requestAnimationFrame 或 CSS transition 的「起点帧」——IAB 后台/未激活
 * 面板里 rAF 停发、渲染帧被抑制，CSS transition 的起点无法可靠建立
 * （同帧「锁自然高 + 写 0」会让起点被覆盖成 0，动画直接跳 0），WAAPI
 * 则照常播放。测量不到自然高时放弃动画（回退官方瞬间切换），绝不把 0
 * 当目标（0→0 无过渡 = 内容消失）。
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
    // 每行独立动画：起点 = 锁定值（展开 0 / 收起自然高），目标 = 反向。
    for (let i = 0; i < rows.length; i += 1) {
      const el = rows[i];
      const m = measures[i];
      if (el === undefined || m === undefined) continue;
      el.classList.add('dsh-tf-animating');
      el.style.overflow = 'hidden';
      const fromHeight = direction_ === 'expand' ? 0 : m.height;
      const toHeight = direction_ === 'expand' ? m.height : 0;
      const fromMargin = direction_ === 'expand' ? 0 : m.marginTop;
      const toMargin = direction_ === 'expand' ? m.marginTop : 0;
      // 先把起点值同步落到内联样式（无过渡，WAAPI 接管后续），确保
      // 收起方向起点 = 自然高（内容先保持可见再收起）。
      el.style.height = `${fromHeight}px`;
      el.style.marginTop = `${fromMargin}px`;
      el.style.opacity = direction_ === 'expand' ? '0' : '1';
      const anim = deps.animate(el, [
        { height: `${fromHeight}px`, marginTop: `${fromMargin}px`, opacity: direction_ === 'expand' ? '0' : '1' },
        { height: `${toHeight}px`, marginTop: `${toMargin}px`, opacity: '0' },
      ], { duration: DURATION_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
      animations.set(el, anim);
      void anim.finished.then(() => {
        if (finished) return;
        animations.delete(el);
        if (animations.size === 0) settle();
      }).catch(() => { /* cancelled */ });
    }
    // WAAPI 在后台也照常播放；兜底 timeout 覆盖异常场景（动画被
    // 浏览器中止但 finished 未 resolve）。
    timeout = deps.scheduleTimeout(settle, DURATION_MS + 500);
  };

  // —— 状态机：measuring（等自然高就绪）→ animating（过渡中）→ done ——
  let phase: 'measuring' | 'animating' | 'done' = 'measuring';
  let currentMeasures: RowMeasure[] | undefined;
  let generation = 0;

  const begin = (): void => {
    const myGeneration = generation;
    const readyPromise = measureWhenReady(rows, direction_, deps);
    if (readyPromise === undefined) {
      // 收起方向首帧测不到自然高：行不可见/未物化，放弃动画走官方瞬间切换。
      settle();
      return;
    }
    void readyPromise.then((measures) => {
      if (finished || phase === 'done' || myGeneration !== generation) return;
      if (measures.length === 0) {
        // 展开方向 3 次仍测不到（隐藏行/内容异步）：放弃动画。
        settle();
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
    reverse(nextDone: () => void): void {
      if (finished || phase === 'done') {
        nextDone();
        return;
      }
      direction_ = direction_ === 'expand' ? 'collapse' : 'expand';
      done = nextDone;
      if (phase === 'measuring') {
        // 测量还没出结果：重新发起（旧测量回调因 generation 变化被放弃）。
        generation += 1;
        begin();
        return;
      }
      if (currentMeasures === undefined) {
        settle();
        nextDone();
        return;
      }
      // 动画进行中反转：取消旧动画，从当前值过渡到新方向目标。
      for (const anim of animations.values()) anim.cancel();
      animations.clear();
      if (timeout !== undefined) deps.cancelTimeout(timeout);
      runAnimation(currentMeasures);
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
