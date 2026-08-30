/**
 * 官方 `turn-process` 折叠条的 shadow renderer（priority -1 接管官方
 * TurnProcessNodeView 的渲染槽位）。
 *
 * 职责：跟随官方行为（`foldable=false` 不渲染）；增强文案（用时 / 思考段数，
 * 经 `useTurnData('turn-activity')` 读取本插件 definition 发布的 face，未
 * 就绪退化为纯官方文案）；展开决策持久化（官方 chat store 是内存态，刷新
 * 即失，这里把用户的展开决策写 localStorage，重挂载时经 `setOpen` 恢复）；
 * completed 白名单（可选，默认关）：终结原因非 completed 的轮强制展开且不
 * 渲染折叠条——`setOpen(true)` 经官方 store 回流摘掉成员行 wrapper 的
 * `hidden="until-found"`，等价于「该轮不折叠」。
 *
 * 结构与官方 TurnProcessNodeView 一致（button + label + chevron），官方
 * data-* 契约全保留，样式复刻自官方 CSS module（见 styles.ts）。
 */
import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
// Loads the SlotMap merge（'conversation.chat.node' 的声明、ChatNodeOwnerProps
// 的 turnProcess、useTurnData 注入面）与 ui-session merge 的 session 标准
// props（sessionId）。
import type {} from '@deepseek-ai/dsh-client-ui-chat/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import {
  composeFoldBarLabel,
  isCompletedOnlyEnabled,
  shouldForceExpand,
  type TurnActivityAugment,
} from './activity-augment.ts';
import {
  animateCompanionCatchUp,
  animateFoldRows,
  clearPinnedRows,
  collectProcessRows,
  type CompanionGeometry,
  type FoldAnimationHandle,
  type FoldDirection,
  type FoldRowPlan,
  measureGeometry,
  memberPlans,
  parsePx,
  resolveFlowColumn,
} from './fold-animate.ts';
import { formatDurationChinese, formatDurationEnglish } from './format.ts';
import {
  createStoragePersistence,
  getLocalStorage,
  readPersistedTurn,
  withPersistedTurn,
  type CollapsePersistence,
} from './persist.ts';

/**
 * Complete keyed Chat renderer props for the shadowed `turn-process` kind:
 * runtime share（官方 node / turnProcess owner state / useTurnData 注入面 /
 * session 标准 props 的 sessionId）+ 本插件 locale 的 t。
 */
export type FoldBarViewProps =
  PropsRuntime<'conversation.chat.node', 'turn-process'>
  & PropsLocale<'turnActivity'>;

function formatDuration(ms: number, t: FoldBarViewProps['t']): string {
  // Use the DSH-supplied locale tag rather than `navigator.language` so the
  // duration follows the same locale as the rest of the label. The dictionary
  // key `turnActivity.durationLocale` is `'zh'` or `'en'`; missing or
  // unrecognised values fall back to the browser language, then English.
  const tag = t('turnActivity.durationLocale');
  if (tag === 'zh') return formatDurationChinese(ms);
  if (tag === 'en') return formatDurationEnglish(ms);
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'zh-CN';
  return lang.toLowerCase().startsWith('zh') ? formatDurationChinese(ms) : formatDurationEnglish(ms);
}

/** Module-lifetime persistence (memory-cached storage adapter). */
let persistence: CollapsePersistence | undefined;
function getPersistence(): CollapsePersistence {
  if (persistence === undefined) {
    persistence = createStoragePersistence(getLocalStorage());
  }
  return persistence;
}

// —— open 翻转的伴生几何（真机逐帧实证的抽动源，见 fold-animate.ts 文件头）——
// open 翻转的官方提交会瞬时改折叠条自身（closed 态 margin-bottom）与 answer
// 行（compact 形态差来自 React 内容）的几何；把这些目标与成员行纳入同一组
// WAAPI 过渡，翻转提前到动画尾段（onFlip），突变帧即被动画吸收。

/** bar 之后与本 turn 关联的第一个非成员 assistant-step 行（官方 answer 行）。 */
function findAnswerRow(turn: number, bar: HTMLElement): HTMLElement | undefined {
  const column = resolveFlowColumn(bar);
  if (column === undefined) return undefined;
  const turnKey = String(turn);
  for (let el = bar.nextElementSibling; el !== null; el = el.nextElementSibling) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.getAttribute('data-chat-turn') !== turnKey) continue;
    if (el.getAttribute('data-chat-flow-kind') === 'assistant-step'
      && !el.hasAttribute('data-turn-process-member')) return el;
  }
  return undefined;
}

/** 展开动画的伴生起点：点击同步块实测的收起态几何（终值由 layout effect 配对）。 */
interface CompanionStart {
  bar: CompanionGeometry;
  ans?: { el: HTMLElement; geo: CompanionGeometry };
}

/** collapse flip 落地后的 answer 形态追赶目标（flip 前实测高度）。 */
interface CatchUpTarget {
  el: HTMLElement;
  fromHeight: number;
}

/**
 * 收起动画的伴生 plan（调用点处于点击的同步块，官方 open 仍为 true——所有
 * 「终态值」都用同同步块内的临时 DOM 改动模拟读出，不 paint）：
 * - bar 的 closed margin-bottom：临时摘 `data-open` 读规则值再恢复；
 * - answer 的 compact margin-top：临时挂 `data-turn-process-answer` 读
 *   gap 变量效果再恢复；其高度差来自 React 内容、动画前测不到，主段不
 *   动 height，flip 落地后由 `animateCompanionCatchUp` 追赶。
 */
function collapseCompanionPlans(
  turn: number,
  bar: HTMLButtonElement,
): { plans: FoldRowPlan[]; ans?: CatchUpTarget } {
  const plans: FoldRowPlan[] = [];
  const hadOpen = bar.hasAttribute('data-open');
  const barFrom = measureGeometry(bar, true);
  bar.removeAttribute('data-open');
  // 摘 data-open 只影响 margin-bottom 规则：height/marginTop 不变，只补读该值。
  const barTo = { ...barFrom, marginBottom: parsePx(getComputedStyle(bar).marginBottom) };
  if (hadOpen) bar.setAttribute('data-open', '');
  plans.push({ el: bar, role: 'companion', from: barFrom, to: barTo });
  const ans = findAnswerRow(turn, bar);
  let ansInfo: CatchUpTarget | undefined;
  if (ans !== undefined) {
    const ansFrom = measureGeometry(ans, false);
    ans.setAttribute('data-turn-process-answer', '');
    const compactMargin = parsePx(getComputedStyle(ans).marginTop);
    ans.removeAttribute('data-turn-process-answer');
    plans.push({
      el: ans,
      role: 'companion',
      from: ansFrom,
      to: { height: ansFrom.height, marginTop: compactMargin },
    });
    ansInfo = { el: ans, fromHeight: ansFrom.height };
  }
  return { plans, ans: ansInfo };
}

/** 展开动画的伴生起点（点击同步块实测的收起态几何；终值由 layout effect 实测配对）。 */
function measureCompanionStart(turn: number, bar: HTMLButtonElement): CompanionStart {
  const ans = findAnswerRow(turn, bar);
  return {
    bar: measureGeometry(bar, true),
    ans: ans === undefined ? undefined : { el: ans, geo: measureGeometry(ans, false) },
  };
}

/** 展开动画的伴生 plan：起点为点击前实测，终点为官方提交落地后的当前值。 */
function expandCompanionPlans(
  turn: number,
  bar: HTMLButtonElement,
  start: CompanionStart,
): FoldRowPlan[] {
  const plans: FoldRowPlan[] = [
    { el: bar, role: 'companion', from: start.bar, to: measureGeometry(bar, true) },
  ];
  const ans = findAnswerRow(turn, bar);
  if (ans !== undefined && start.ans !== undefined && start.ans.el === ans) {
    plans.push({ el: ans, role: 'companion', from: start.ans.geo, to: measureGeometry(ans, false) });
  }
  return plans;
}

/** completed 白名单开关（模块生命周期读一次；改动后刷新生效，与其他设置一致）。 */
const COMPLETED_ONLY_ENABLED = isCompletedOnlyEnabled(getLocalStorage());

export const FoldBarView = memo(function FoldBarView({
  node,
  turnProcess,
  sessionId,
  useTurnData,
  t,
}: FoldBarViewProps) {
  if (turnProcess === undefined) {
    throw new Error('turn-process node requires Turn process owner state');
  }
  const augment: TurnActivityAugment | undefined = useTurnData('turn-activity');
  const { foldable, open, setOpen } = turnProcess;
  const turn = node.data.turn;
  const forceExpand = foldable
    && shouldForceExpand(augment?.reasonKind, COMPLETED_ONLY_ENABLED);

  // —— 展开/收起动画的状态（见 fold-animate.ts）——
  const barRef = useRef<HTMLButtonElement>(null);
  const prevOpenRef = useRef(open);
  // 程序性恢复（persist 恢复 / 白名单强制展开）置位：下一次 open 翻转不播
  // 动画——刷新时几十个轮同时恢复，逐个播放会整页跳动。
  const skipAnimRef = useRef(false);
  const animationRef = useRef<FoldAnimationHandle | undefined>(undefined);
  // 展开意图在 toggle 同步块实测的伴生起点（官方提交前），layout effect
  // 消费后与官方终值配对成伴生动画。
  const companionStartRef = useRef<CompanionStart | undefined>(undefined);
  // collapse flip 落地后的 answer 形态追赶目标（flip 前实测高度）。
  const catchUpRef = useRef<CatchUpTarget | undefined>(undefined);

  /** 程序性展开（置位 skipAnim + setOpen 必须成对，收敛于此防止漏抄）。 */
  const openSilently = (): void => {
    skipAnimRef.current = true;
    setOpen(true);
  };

  useEffect(() => () => {
    animationRef.current?.cancel();
    animationRef.current = undefined;
  }, []);

  useLayoutEffect(() => {
    const previous = prevOpenRef.current;
    prevOpenRef.current = open;
    if (previous === open) return;
    if (!foldable) return;
    if (!open) {
      skipAnimRef.current = false;
      // collapse 的 flip 已把官方 open 翻成 false（或动画完成后 onDone 兜
      // 底翻转）：官方 hidden 在本次提交的父组件 layout effect 里挂上（子
      // 先父后，此刻可能还没挂）。answer 形态差在本 layout effect（paint
      // 前）用 WAAPI 从 flip 前实测值平滑追赶，不露出突变帧；钉住的终态
      // 内联样式等一拍宏任务清理（hidden 必已生效，清理本身不可见）。
      const catchUp = catchUpRef.current;
      catchUpRef.current = undefined;
      const bar = barRef.current;
      if (bar === null) return;
      // RO 追赶的收尾句柄：compact 形态滞后落地（实测 ~80ms，800ms 为 10 倍
      // 余量上限）；open 翻回/卸载时由 cleanup 撤除，防残留 RO 多余追赶。
      let disconnectTimer: ReturnType<typeof setTimeout> | undefined;
      let ro: ResizeObserver | undefined;
      if (catchUp !== undefined && catchUp.el.isConnected) {
        // 慢路径兜底会在 answer 行留下主动画的 height 终态内联（官方提交
        // 后已失真）；追赶 WAAPI 此刻正从上方覆盖，清内联无视觉差。
        const el = catchUp.el;
        const fromHeight = catchUp.fromHeight;
        el.style.height = '';
        // answer 的 compact 形态由官方组件在 flip 提交之后的自有更新里落
        // 地（真机实测滞后 ~80ms，本 layout effect 时高度差尚未显现，直接
        // 追赶会因差值 <1 空转）。ResizeObserver 在变化帧的渲染步骤
        // （paint 前）回调，此刻启动追赶 WAAPI 可从 flip 前实测值平滑覆盖，
        // 不露出突变帧。
        ro = new ResizeObserver(() => {
          if (Math.abs(el.offsetHeight - fromHeight) < 1) return;
          ro?.disconnect();
          animateCompanionCatchUp(el, fromHeight);
        });
        ro.observe(el);
        disconnectTimer = setTimeout(() => ro?.disconnect(), 800);
      }
      const timer = setTimeout(() => clearPinnedRows(turn, bar), 0);
      return () => {
        clearTimeout(timer);
        if (disconnectTimer !== undefined) clearTimeout(disconnectTimer);
        ro?.disconnect();
      };
    }
    if (skipAnimRef.current) {
      skipAnimRef.current = false;
      return;
    }
    // 用户点击触发的展开（toggle 里只调了 setOpen）：本 layout effect 跑在
    // 官方父组件摘 hidden 之前（React layout effect 子先父后），动画在微任务
    // 里等全部 layout effect 结束、paint 之前测高并压 0 启动——内容不会先
    // 闪一帧完整形态再被压没。伴生行（bar margin-bottom / answer 形态）的
    // 起点在 toggle 同步块实测，终点是此刻官方提交落地后的当前值，与成员
    // 行同组 WAAPI 过渡。
    const bar = barRef.current;
    if (bar === null) return;
    const rows = collectProcessRows(turn, bar);
    const start = companionStartRef.current;
    companionStartRef.current = undefined;
    if (rows.length === 0) return;
    const plans: FoldRowPlan[] = memberPlans(rows);
    if (start !== undefined) plans.push(...expandCompanionPlans(turn, bar, start));
    const handle = animateFoldRows(plans, 'expand', () => {
      animationRef.current = undefined;
    });
    // reduced-motion / 测量失败可同步完成；不得把已结束的 handle 重新写回，
    // 否则下一次点击会走反转分支并吞掉展开意图。
    if (handle.active) animationRef.current = handle;
  }, [foldable, open, turn]);

  useEffect(() => {
    if (!foldable) return;
    if (forceExpand) {
      // 白名单轮：官方默认收起（store 无条目），强制展开后官方 store 持有
      // 该条目，effect 收敛不再触发。用户在此形态下没有收起入口——这正是
      // 「中断轮不折叠」的语义。
      if (!open) openSilently();
      return;
    }
    if (open) return;
    // 持久化恢复：官方 store 刷新后为空（open=false），persisted ===
    // 'expanded' 的轮经 setOpen 回流恢复。generation 变化（答案重写）后
    // 同样走这里，把用户意愿套到新 generation 上。
    if (readPersistedTurn(getPersistence(), sessionId, turn) === 'expanded') {
      openSilently();
    }
  }, [foldable, forceExpand, open, setOpen, sessionId, turn]);

  if (!foldable || forceExpand) return null;

  const { base, augment: augmentLabel } = composeFoldBarLabel(node.data, augment, {
    t,
    formatDuration: (ms) => formatDuration(ms, t),
  });
  const toggle = (): void => {
    const store = getPersistence();
    const persist = (dir: FoldDirection): void => {
      store.write(withPersistedTurn(store, sessionId, turn, dir === 'expand' ? 'expanded' : 'collapsed'));
    };
    if (animationRef.current !== undefined) {
      // 动画进行中再点：视觉正在去的方向的反面就是用户要的，直接反转。
      const handle = animationRef.current;
      const next: FoldDirection = handle.direction === 'expand' ? 'collapse' : 'expand';
      // flip 已把官方 open 翻成 false 之后反转回 expand，完成回调必须补翻
      // 回 true，否则动画展开完官方仍是收起态。
      const flipped = handle.flipFired;
      const active = handle.reverse(() => {
        animationRef.current = undefined;
        if (next === 'collapse') setOpen(false);
        else if (flipped) {
          catchUpRef.current = undefined;
          setOpen(true);
        }
      });
      // 反转落在同步 settle 上时，完成回调已清空 animationRef——不得再
      // 覆盖成已完成的 handle，否则残留 handle 让后续点击永久短路。
      if (active) animationRef.current = handle;
      persist(next);
      return;
    }
    if (open) {
      // 收起：先播高度过渡；flip 在主动画尾段把 setOpen(false) 提前到官方
      // 提交（hidden/补偿几何/answer 形态切换全部落在动画窗口内），落地后
      // 由 layout effect 补追赶动画并清理兜底钉住。没有可动画的成员行
      // （纯 inline reasoning 轮）时退化为官方的瞬时切换。
      const bar = barRef.current;
      const rows = bar === null ? [] : collectProcessRows(turn, bar);
      if (bar !== null && rows.length > 0) {
        const { plans: companionPlans, ans } = collapseCompanionPlans(turn, bar);
        catchUpRef.current = ans;
        const handle = animateFoldRows(
          [...memberPlans(rows), ...companionPlans],
          'collapse',
          () => {
            animationRef.current = undefined;
            setOpen(false);
          },
          { onFlip: () => setOpen(false) },
        );
        if (handle.active) animationRef.current = handle;
        persist('collapse');
        return;
      }
    }
    // 展开意图（或不可动画的收起）：直接交官方状态机，展开动画由上面的
    // layout effect 补播。展开前在点击同步块实测伴生起点（此刻仍是收起态
    // 几何），官方提交后 layout effect 用它与终值配对成伴生动画。
    if (!open && barRef.current !== null) {
      companionStartRef.current = measureCompanionStart(turn, barRef.current);
    }
    setOpen(!open);
    persist(open ? 'collapse' : 'expand');
  };
  return (
    <button
      type="button"
      ref={barRef}
      className="dsh-tf-bar"
      data-open={open || undefined}
      data-turn-process={node.data.turn}
      data-turn-process-messages={node.data.messageCount}
      data-turn-process-tool-calls={node.data.toolCallCount}
      data-turn-process-subagents={node.data.subagentCount}
      {...(augment !== undefined
        ? {
            'data-dsh-tf-duration': String(augment.durationMs),
            'data-dsh-tf-thinking': String(augment.thinkingSteps),
          }
        : {})}
      aria-expanded={open}
      onClick={(event) => {
        event.currentTarget.focus();
        toggle();
      }}
    >
      <span className="dsh-tf-label">
        {base}
        {augmentLabel !== '' && (
          <span className="dsh-tf-augment">
            {t('turnActivity.bar.separator')}
            {augmentLabel}
          </span>
        )}
      </span>
      <svg
        className="dsh-tf-chevron"
        aria-hidden="true"
        viewBox="0 0 12 12"
        width="16"
        height="16"
      >
        <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
});
