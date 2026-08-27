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
 * The chat column lays rows out with `gap: 16px` (host ChatView css) and rows
 * carry no margin of their own. During a height transition every changed row
 * therefore gets `margin-bottom: -16px` to cancel its gap: without it a fold
 * would end with a 16px×N jump when the rows leave flow (and an expand would
 * start with one).
 */
const COLUMN_GAP_PX = 16;
const ANIMATE_MS = 220;
const ANIMATE_FALLBACK_MS = 420;

/** True when the OS asks for reduced motion; animation is skipped then. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Animate a fold (rows shrink and fade to zero) or unfold (rows grow and
 * fade in) with height/opacity transitions, then apply the final collapse
 * marker (`data-dsh-ta-collapsed`) and run `done`. Rows are marked with the
 * `dsh-ta-animating` class for the duration so background reconciles skip
 * them (`applyRowTargets`), and a newer animation interrupts the previous
 * one (its rows are reset to their natural state first).
 *
 * Both directions happen entirely inside one task before the browser paints:
 * start state → force reflow → target state, so there is no flash of the
 * fully-expanded or fully-hidden intermediate layout. `margin-bottom` is
 * transitioned in parallel to cancel the column gap (see `COLUMN_GAP_PX`).
 *
 * Heights are the row's RENDERED height (`offsetHeight`), not `scrollHeight`:
 * activity rows contain internally capped blocks (e.g. a tool body with
 * `max-height` + scroll), so `scrollHeight` is the full content height and
 * would yank the row taller than it ever renders — the "twitch" at the start
 * of a fold.
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
    // Fold: rows are visible at their rendered height; pin the start state
    // then transition height/opacity to zero. `offsetHeight` (not
    // `scrollHeight`) so internally capped blocks keep their rendered size.
    // Measure ALL rows before writing any style: a read after each write
    // forces a separate layout pass per row (heavy tool cards make that
    // measurably slow on click — the "delayed reaction" the user reported),
    // while one batched read costs a single pass.
    const heights = new Map<HTMLElement, string>();
    for (const el of els) heights.set(el, `${el.offsetHeight}px`);
    for (const [el, height] of heights) {
      el.classList.add('dsh-ta-animating');
      el.style.height = height;
      el.style.marginBottom = '0px';
      el.style.opacity = '1';
    }
    // DO NOT MOVE: synchronous reflow is intentional — commits the start
    // state so the browser paints neither 0-height nor full-height first.
    void documentRef.body.offsetHeight;
    for (const el of els) {
      el.style.height = '0px';
      el.style.marginBottom = `${-COLUMN_GAP_PX}px`;
      el.style.opacity = '0';
    }
  } else {
    // Rows are display:none; reveal them at zero height, measure the
    // RENDERED height (`offsetHeight` — read right after the reveal, in the
    // same task, so the browser never paints the full-size intermediate),
    // then grow to it. Batched read before any write, same one-layout rule
    // as the fold direction.
    for (const el of els) delete el.dataset.dshTaCollapsed;
    const heights = new Map<HTMLElement, string>();
    for (const el of els) heights.set(el, `${el.offsetHeight}px`);
    for (const el of els) {
      el.classList.add('dsh-ta-animating');
      el.style.height = '0px';
      el.style.marginBottom = `${-COLUMN_GAP_PX}px`;
      el.style.opacity = '0';
    }
    // DO NOT MOVE: synchronous reflow is intentional — same reason as the
    // fold direction above.
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

/** Global animation state; single projector instance per document. */
let animToken = 0;
const animatingRows = new Set<HTMLElement>();
let animTimer: number | null = null;

/** Reset every animating row to its natural (un-animated) state. */
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
