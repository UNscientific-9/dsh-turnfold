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
  animateFoldRows,
  collectProcessRows,
  type FoldAnimationHandle,
  type FoldDirection,
} from './fold-animate.ts';
import { formatDurationChinese, formatDurationEnglish } from './format.ts';
import {
  createStoragePersistence,
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

function getStorage(): Storage | undefined {
  return typeof localStorage !== 'undefined' ? localStorage : undefined;
}

/** Module-lifetime persistence (memory-cached storage adapter). */
let persistence: CollapsePersistence | undefined;
function getPersistence(): CollapsePersistence {
  if (persistence === undefined) {
    persistence = createStoragePersistence(getStorage());
  }
  return persistence;
}

/** 测试注入点：注入 undefined 恢复惰性默认。 */
export function setFoldPersistence(value: CollapsePersistence | undefined): void {
  persistence = value;
}

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
    && shouldForceExpand(augment?.reasonKind, isCompletedOnlyEnabled(getStorage()));

  // —— 展开/收起动画的状态（见 fold-animate.ts）——
  const barRef = useRef<HTMLButtonElement>(null);
  const prevOpenRef = useRef(open);
  // 程序性恢复（persist 恢复 / 白名单强制展开）置位：下一次 open 翻转不播
  // 动画——刷新时几十个轮同时恢复，逐个播放会整页跳动。
  const skipAnimRef = useRef(false);
  const animationRef = useRef<{ handle: FoldAnimationHandle; direction: FoldDirection } | undefined>(
    undefined,
  );

  useEffect(() => () => {
    animationRef.current?.handle.cancel();
    animationRef.current = undefined;
  }, []);

  useLayoutEffect(() => {
    const previous = prevOpenRef.current;
    prevOpenRef.current = open;
    if (previous === open) return;
    if (!foldable || !open || skipAnimRef.current) {
      skipAnimRef.current = false;
      return;
    }
    // 用户点击触发的展开（toggle 里只调了 setOpen）：成员行刚摘 hidden，
    // rAF 在本轮 paint 前把行压到 0 高再过渡展开，不闪帧。
    const bar = barRef.current;
    if (bar === null) return;
    const rows = collectProcessRows(turn, bar);
    if (rows.length === 0) return;
    const handle = animateFoldRows(rows, 'expand', () => {
      animationRef.current = undefined;
    });
    animationRef.current = { handle, direction: 'expand' };
  }, [foldable, open, turn]);

  useEffect(() => {
    if (!foldable) return;
    if (forceExpand) {
      // 白名单轮：官方默认收起（store 无条目），强制展开后官方 store 持有
      // 该条目，effect 收敛不再触发。用户在此形态下没有收起入口——这正是
      // 「中断轮不折叠」的语义。
      if (!open) {
        skipAnimRef.current = true;
        setOpen(true);
      }
      return;
    }
    if (open) return;
    // 持久化恢复：官方 store 刷新后为空（open=false），persisted ===
    // 'expanded' 的轮经 setOpen 回流恢复。generation 变化（答案重写）后
    // 同样走这里，把用户意愿套到新 generation 上。
    if (readPersistedTurn(getPersistence(), sessionId, turn) === 'expanded') {
      skipAnimRef.current = true;
      setOpen(true);
    }
  }, [foldable, forceExpand, open, setOpen, sessionId, turn]);

  if (!foldable || forceExpand) return null;

  const { base, augment: augmentLabel } = composeFoldBarLabel(node.data, augment, {
    t,
    formatDuration: (ms) => formatDuration(ms, t),
  });
  const toggle = (): void => {
    const store = getPersistence();
    if (animationRef.current !== undefined) {
      // 动画进行中再点：视觉正在去的方向的反面就是用户要的，直接反转。
      const { handle, direction } = animationRef.current;
      const next: FoldDirection = direction === 'expand' ? 'collapse' : 'expand';
      handle.reverse(() => {
        animationRef.current = undefined;
        if (next === 'collapse') setOpen(false);
      });
      animationRef.current = { handle, direction: next };
      store.write(withPersistedTurn(store, sessionId, turn, next === 'expand' ? 'expanded' : 'collapsed'));
      return;
    }
    if (open) {
      // 收起：先播高度过渡，落地后再 setOpen(false) 摘内容（避免内容先
      // 消失再看到空档）。没有可动画的成员行（纯 inline reasoning 轮）
      // 时退化为官方的瞬时切换。
      const bar = barRef.current;
      const rows = bar === null ? [] : collectProcessRows(turn, bar);
      if (rows.length > 0) {
        const handle = animateFoldRows(rows, 'collapse', () => {
          animationRef.current = undefined;
          setOpen(false);
        });
        animationRef.current = { handle, direction: 'collapse' };
        store.write(withPersistedTurn(store, sessionId, turn, 'collapsed'));
        return;
      }
    }
    // 展开意图（或不可动画的收起）：直接交官方状态机，展开动画由上面的
    // layout effect 补播。
    setOpen(!open);
    store.write(withPersistedTurn(store, sessionId, turn, open ? 'collapsed' : 'expanded'));
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

export default FoldBarView;
