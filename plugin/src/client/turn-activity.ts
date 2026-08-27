/**
 * turn-activity ConversationNodeDefinition: one engine context per turn that
 * accumulates activity facts from the raw session log and materializes the
 * summary row (and its turn-scoped data) exactly when the turn has ended with
 * a final message.
 *
 * The summary node's anchor is the TOP of the turn — `firstActivitySeq - 0.5`
 * (frozen at `turn/end` by the state machine) — which the chat assembler
 * sorts after the user/context rows and before the first activity row: the
 * fold control is the turn's head, and activity expands/collapses beneath
 * it.
 */
import type {
  ChatConversationViewNode,
  ConversationLocation,
  ConversationMatch,
  ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client';
import {
  initialTurnActivityState,
  matchTurnActivity,
  summarizeActivity,
  TURN_ACTIVITY_KIND,
  updateTurnActivityState,
  type TurnActivityState,
  type TurnActivitySummary,
} from './activity-state.ts';

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Completed-turn activity facts for the turn-activity surface. */
    'turn-activity': TurnActivitySummary;
  }
}

function contextLocation(context: ConversationNodeContext<TurnActivityState>): ConversationLocation {
  return (
    context.start?.location ??
    context.matches[0]?.location ?? { kind: 'unresolved' }
  );
}

function buildViewNode(context: ConversationNodeContext<TurnActivityState>): ChatConversationViewNode | null {
  if (context.state === undefined) return null;
  const summary = summarizeActivity(context.state);
  if (summary === null) return null;
  // The anchor is frozen by the state machine at `turn/end` to the TOP of
  // the turn (`firstActivitySeq - 0.5`, see activity-state.ts): the fold
  // control renders right after the user/context rows and before the first
  // activity row, so toggling never moves the control and the "never
  // collapse the final answer" exemption is encoded in `finalStep` instead
  // of any anchor arithmetic.
  return {
    key: context.key,
    kind: TURN_ACTIVITY_KIND,
    id: context.id,
    target: 'chat',
    anchorSeq: summary.anchorSeq,
    location: contextLocation(context),
    visibility: 'visible',
    data: summary,
  };
}

export function createTurnActivityDefinition(): ConversationNodeDefinition<TurnActivityState> {
  return {
    kind: TURN_ACTIVITY_KIND,
    target: 'chat',
    match: matchTurnActivity,
    start: (context: ConversationNodeContext<TurnActivityState>, match: ConversationMatch) => {
      if (match.event.type !== 'turn/start') {
        throw new Error('turn-activity start requires turn/start');
      }
      return initialTurnActivityState(match.event.data.turn, match.event.seq, match.event.time);
    },
    update: (context, match) => updateTurnActivityState(context.state, match.event),
    // Publish on the first event that can yield a summarizable state, plus
    // tool/retry events that can land AFTER the initial summary was
    // materialized and so need to re-publish the view node with the
    // up-to-date tool/retry lists.
    //
    // - `turn/end` and `assistant/message` are the regular gates.
    // - `tool/call` / `tool/result` after `turn/end` arrive as late events
    //   that bump `toolCallIds`; without immediate re-publication the
    //   summary's `data-dsh-ta-tools` attribute would be a stale snapshot
    //   and the projector's tool row would never be hidden.
    // - `llm/retry` bumps `retryIds` the same way; re-publication keeps
    //   `data-dsh-ta-retries` fresh so the projector can hide the correlated
    //   `model-retry` rows. Before `turn/end` the state has no
    //   `hasFinalMessage` and `buildViewNode` returns null, so early events
    //   of any of these kinds are no-op publishes.
    publication: (match) => {
      switch (match.event.type) {
        case 'turn/end':
        case 'assistant/message':
        case 'tool/call':
        case 'tool/result':
        case 'llm/retry':
          return 'immediate';
        default:
          return 'none';
      }
    },
    buildLocationData: (context, scope) => {
      if (scope !== 'turn' || context.state === undefined) return null;
      const summary = summarizeActivity(context.state);
      if (summary === null) return null;
      return {
        kind: 'turn',
        turn: context.state.turn,
        key: TURN_ACTIVITY_KIND,
        value: summary,
      };
    },
    buildViewNode,
  };
}
