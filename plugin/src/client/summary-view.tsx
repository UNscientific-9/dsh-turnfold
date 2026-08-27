/**
 * The turn-activity summary row: a Disclosure button plus the single divider
 * between the activity region and the final answer.
 *
 * Responsibilities:
 * - Render the engine-published summary (duration, tool count, thinking
 *   segments) and expose membership facts to the DOM projector via
 *   `data-dsh-ta-*` attributes.
 * - On first mount of a fresh completed turn, apply the auto-collapse rule
 *   once and record it; on rehydrate, restore the recorded decision.
 * - Toggle collapse/expand through the store; the projector owns the actual
 *   row hiding and scroll compensation.
 */
import { memo, useEffect, useSyncExternalStore } from 'react';
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client';
import type { ChatNode, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { shouldAutoCollapse, type TurnActivitySummary } from './activity-state.ts';
import { formatDurationChinese, formatDurationEnglish } from './format.ts';
import { NS, type DurationLocaleTag } from './locales.ts';
import {
  DATA_DURATION,
  DATA_FINAL_STEP,
  DATA_RETRIES,
  DATA_SESSION,
  DATA_THINKING,
  DATA_TOOLS,
  DATA_TURN,
  rememberMembership,
} from './projector.ts';
import { getProjector, getStore } from './singletons.ts';

/** Registered renderer payload for the turn-activity Chat node. */
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'turn-activity': TurnActivitySummary;
  }
}

type TurnActivityNode = ChatNode<'turn-activity'>;

/** Props actually consumed by this view (subset of the chat node seat props). */
interface TurnActivityViewProps {
  node: TurnActivityNode;
  t: (key: string, params?: Record<string, string>) => string;
  useSession: <T>(selector: (snapshot: ConversationSnapshot) => T) => T;
}

function formatDuration(ms: number, t: TurnActivityViewProps['t']): string {
  // Use the DSH-supplied locale tag rather than `navigator.language` so the
  // duration follows the same locale as the rest of the summary text. The
  // dictionary key `turnActivity.durationLocale` is `'zh'` or `'en'`; missing
  // or unrecognised values fall back to the browser language, then English.
  const tag = t(`${NS}.durationLocale`) as DurationLocaleTag | string;
  if (tag === 'zh') return formatDurationChinese(ms);
  if (tag === 'en') return formatDurationEnglish(ms);
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'zh-CN';
  return lang.toLowerCase().startsWith('zh') ? formatDurationChinese(ms) : formatDurationEnglish(ms);
}

function summaryText(summary: TurnActivitySummary, t: TurnActivityViewProps['t']): string {
  const time = formatDuration(summary.durationMs, t);
  const tools = String(summary.toolCount);
  const thinking = String(summary.thinkingSteps);
  if (summary.toolCount > 0 && summary.thinkingSteps > 0) {
    return t('turnActivity.summary', { time, tools, thinking });
  }
  if (summary.toolCount > 0) {
    return t('turnActivity.summaryNoThinking', { time, tools });
  }
  if (summary.thinkingSteps > 0) {
    return t('turnActivity.summaryNoTools', { time, thinking });
  }
  return t('turnActivity.summaryPlain', { time });
}

export const TurnActivityNodeView = memo(function TurnActivityNodeView({
  node,
  t,
  useSession,
}: TurnActivityViewProps) {
  const summary = node.data as TurnActivitySummary;
  const sessionId = useSession((snapshot) => snapshot.sessionId);

  // Refresh the membership snapshot cache on every render: the facts must
  // survive the summary row leaving the document (paged/windowed history),
  // so the projector can keep folding the turn while the row is absent.
  rememberMembership(sessionId, {
    turn: summary.turn,
    finalStep: summary.finalStep,
    toolCallIds: summary.toolCallIds,
    retryIds: summary.retryIds,
    sessionId,
  });

  const recorded = useSyncExternalStore(
    getStore().subscribe,
    () => getStore().getCollapsed(sessionId, summary.turn) ?? undefined,
  );
  const collapsed = recorded === 'collapsed';

  // Auto-collapse a freshly completed turn exactly once; restore a recorded
  // decision on rehydrate (refresh / session reopen). Deps include the full
  // `summary` so a late event that re-publishes the node (e.g. a tool/call
  // arriving after the summary row mounted) re-applies the projector against
  // the up-to-date membership facts instead of flashing the new row visible
  // for a frame.
  useEffect(() => {
    const store = getStore();
    const projector = getProjector();
    projector.setSession(sessionId);
    let decision = store.getCollapsed(sessionId, summary.turn);
    if (decision === undefined && shouldAutoCollapse(summary)) {
      store.setCollapsed(sessionId, summary.turn, 'collapsed');
      decision = 'collapsed';
    }
    if (decision !== undefined) {
      projector.applyTurnCollapse(sessionId, summary.turn, decision === 'collapsed');
      // Re-apply on the next frame: the activity rows that the projector
      // targets are React siblings, not children, and may not be committed
      // yet. The MutationObserver eventually catches them too, but a
      // same-batch render can otherwise flash the new row visible.
      requestAnimationFrame(() => {
        // Re-read the decision instead of reusing the closure value: a user
        // toggle can land between this effect and the next frame, and the
        // stale `decision` must not overwrite the newer choice.
        const latest = store.getCollapsed(sessionId, summary.turn);
        if (latest !== undefined) {
          projector.applyTurnCollapse(sessionId, summary.turn, latest === 'collapsed');
        }
      });
    }
  }, [sessionId, summary]);

  const toggle = (): void => {
    try {
      toggleInner();
    } catch (error) {
      const bulk = document.getElementById('dsh-ta-bulk-controls');
      if (bulk !== null) bulk.dataset.dshTaError = String(error);
      throw error;
    }
  };
  const toggleInner = (): void => {
    const next = collapsed ? 'expanded' : 'collapsed';
    getStore().setCollapsed(sessionId, summary.turn, next);
    // Apply synchronously for immediate visual feedback. `userDriven` asks
    // the projector to animate the fold and then pin the viewport to the
    // top of this turn (the summary row when collapsing, the first activity
    // row when expanding). The store subscription also schedules a
    // compensated rAF reconcile, but it is idempotent against this
    // synchronous call and skips rows currently animating.
    getProjector().applyTurnCollapse(sessionId, summary.turn, next === 'collapsed', {
      userDriven: true,
    });
  };

  // WAI-ARIA disclosure: the button announces `aria-expanded` plus the
  // descriptive summary text, which already enumerates the activity the
  // toggle controls. We do not own the activity rows themselves, so
  // `aria-controls` is intentionally omitted (the pattern is valid without
  // it). The divider is a visual separator, not a controlled region.
  const dividerLabel = t('turnActivity.divider');
  const toggleTitle = collapsed ? t('turnActivity.toggleExpand') : t('turnActivity.toggleCollapse');
  return (
    <div
      className="dsh-ta-root"
      {...{ [DATA_TURN]: summary.turn }}
      {...{ [DATA_FINAL_STEP]: summary.finalStep ?? '' }}
      {...{ [DATA_TOOLS]: summary.toolCallIds.join(',') }}
      {...{ [DATA_RETRIES]: summary.retryIds.join(',') }}
      {...{ [DATA_THINKING]: String(summary.thinkingSteps) }}
      {...{ [DATA_DURATION]: String(summary.durationMs) }}
      {...{ [DATA_SESSION]: sessionId }}
    >
      <button
        type="button"
        className="dsh-ta-toggle"
        aria-expanded={!collapsed}
        title={toggleTitle}
        onClick={toggle}
      >
        <svg
          className="dsh-ta-chevron"
          aria-hidden="true"
          viewBox="0 0 12 12"
          width="12"
          height="12"
        >
          <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="dsh-ta-label">{summaryText(summary, t)}</span>
      </button>
      <div className="dsh-ta-divider" role="separator" aria-label={dividerLabel} />
    </div>
  );
});

export default TurnActivityNodeView;
