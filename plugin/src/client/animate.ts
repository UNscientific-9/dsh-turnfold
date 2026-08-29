/**
 * 折叠/展开动画：唯一持有动画状态（token / 行集 / 兜底定时器）的模块。
 *
 * 关键约束：
 * - `void documentRef.body.offsetHeight` 的同步 reflow 位置不可挪动——
 *   必须紧跟在「写起始态」之后、「写目标态」之前，禁止移进 rAF（否则
 *   浏览器会先绘制一帧 0 高度/全高度的中间态，折叠时闪一下）。
 * - `animatingRows` 不对外暴露：行跳过逻辑（applyRowTargets 查
 *   `.dsh-ta-animating` class）与动画自身都以 DOM class 为契约。
 * - 动画时长 220ms（styles.ts 的 CSS transition）与 420ms 兜底定时器
 *   保持与重构前完全一致。
 */

/**
 * 聊天列以 `gap: 16px` 排布行（宿主 ChatView CSS），行自身无 margin。
 * 高度过渡期间每个发生变化的行都要加 `margin-bottom: -16px` 抵消 gap：
 * 否则折叠收尾时行脱离文档流会留下 16px×N 的跳动，展开则开头跳一下。
 */
const COLUMN_GAP_PX = 16;
const ANIMATE_MS = 220;
const ANIMATE_FALLBACK_MS = 420;

/** 宿主要求减少动态效果时为 true；此时跳过动画。 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * 折叠/展开动画：行高与透明度渐变到 0（折叠）或从 0 展开，结束后写入
 * 最终的折叠标记（`data-dsh-ta-collapsed`）并执行 `done`。动画期间行带
 * `dsh-ta-animating` class，背景 reconcile 据此跳过它们（`applyRowTargets`）；
 * 新动画会打断旧动画（旧行先复位到自然状态）。
 *
 * 两个方向都在同一个任务内、浏览器绘制之前完成：起始态 → 强制 reflow →
 * 目标态，因此不会闪现全展开或全隐藏的中间布局。`margin-bottom` 与高度
 * 并行过渡以抵消列 gap（见 `COLUMN_GAP_PX`）。
 *
 * 高度读的是行的渲染高度（`offsetHeight`）而非 `scrollHeight`：activity
 * 行内部有封顶块（如 `max-height` + 滚动的工具体），`scrollHeight` 是完整
 * 内容高度，会把行拉到从未渲染过的高度——即折叠起点的"抖动"。
 */
export function beginAnimatedTransition(
  documentRef: Document,
  els: readonly HTMLElement[],
  hide: boolean,
  done: () => void,
): void {
  interruptAnimation();
  if (els.length === 0) {
    done();
    return;
  }
  const token = ++animToken;
  for (const el of els) animatingRows.add(el);

  const finish = (): void => {
    if (token !== animToken) return; // superseded by a newer animation
    if (animTimer !== null) {
      window.clearTimeout(animTimer);
      animTimer = null;
    }
    for (const el of els) {
      el.removeEventListener('transitionend', onEnd);
      el.classList.remove('dsh-ta-animating');
      el.style.height = '';
      el.style.marginBottom = '';
      el.style.opacity = '';
      if (hide) el.dataset.dshTaCollapsed = 'true';
      else delete el.dataset.dshTaCollapsed;
      animatingRows.delete(el);
    }
    done();
  };

  if (hide) {
    // 折叠：行以渲染高度可见；先钉住起始态，再把 height/opacity 过渡到 0。
    // 用 `offsetHeight`（非 `scrollHeight`），内部封顶块保持渲染尺寸。
    // 先批量测完所有行、再写任何样式：写之间夹读会迫使每行各走一次
    // 布局（重型工具卡下点击可感知地变慢——用户报告的"点击延迟"），
    // 而一次批量读只花一次布局。
    const heights = new Map<HTMLElement, string>();
    for (const el of els) heights.set(el, `${el.offsetHeight}px`);
    for (const [el, height] of heights) {
      el.classList.add('dsh-ta-animating');
      el.style.height = height;
      el.style.marginBottom = '0px';
      el.style.opacity = '1';
    }
    // 禁止挪动：同步 reflow 是刻意的——提交起始态，浏览器就不会先绘制
    // 0 高度或全高度的中间帧。
    void documentRef.body.offsetHeight;
    for (const el of els) {
      el.style.height = '0px';
      el.style.marginBottom = `${-COLUMN_GAP_PX}px`;
      el.style.opacity = '0';
    }
  } else {
    // 行是 display:none；以 0 高度显示、测渲染高度（`offsetHeight`——
    // 紧跟显示读取，同一任务内，浏览器永远画不出全尺寸中间态），再长到
    // 目标高度。先批量读再写，与折叠方向同一条单次布局规则。
    for (const el of els) delete el.dataset.dshTaCollapsed;
    const heights = new Map<HTMLElement, string>();
    for (const el of els) heights.set(el, `${el.offsetHeight}px`);
    for (const el of els) {
      el.classList.add('dsh-ta-animating');
      el.style.height = '0px';
      el.style.marginBottom = `${-COLUMN_GAP_PX}px`;
      el.style.opacity = '0';
    }
    // 禁止挪动：同步 reflow 是刻意的，理由同折叠方向。
    void documentRef.body.offsetHeight;
    for (const [el, height] of heights) {
      el.style.height = height;
      el.style.marginBottom = '0px';
      el.style.opacity = '1';
    }
  }

  let remaining = els.length;
  const onEnd = (ev: TransitionEvent): void => {
    const el = ev.target as HTMLElement;
    if (ev.propertyName !== 'height' || !animatingRows.has(el)) return;
    el.removeEventListener('transitionend', onEnd);
    remaining -= 1;
    if (remaining === 0) finish();
  };
  for (const el of els) el.addEventListener('transitionend', onEnd);
  animTimer = window.setTimeout(finish, ANIMATE_FALLBACK_MS);
}

/** 全局动画状态；每个文档只有一个 projector 实例。 */
let animToken = 0;
const animatingRows = new Set<HTMLElement>();
let animTimer: number | null = null;

/** 把所有动画中的行复位到自然（未动画）状态。 */
function interruptAnimation(): void {
  if (animTimer !== null) {
    window.clearTimeout(animTimer);
    animTimer = null;
  }
  for (const el of animatingRows) {
    el.classList.remove('dsh-ta-animating');
    el.style.height = '';
    el.style.marginBottom = '';
    el.style.opacity = '';
  }
  animatingRows.clear();
}
