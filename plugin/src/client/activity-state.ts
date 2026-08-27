/**
 * turn-activity state machine (pure logic, DOM-free).
 *
 * One ConversationNodeDefinition context per turn, fed by the raw Session
 * event log. The only auto-collapse trigger is `turn/end` with
 * `reason.kind === 'completed'` AND at least one `assistant/message` in the
 * turn — every other terminal reason (aborted / blocked / error /
 * max-tokens / interrupted) keeps the activity region expanded, and a turn
 * without a final message never materializes a summary node at all.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types';

/** TurnEndReasonMap kinds known to DSH 0.1.1-rc.2; `(string & {})` keeps the
 *  merge-extensible reason map compatible. */
export type TurnEndReasonKind =
  | 'completed'
  | 'aborted'
  | 'blocked'
  | 'error'
  | 'max-tokens'
  | 'interrupted'
  | (string & {});

/** Mutable per-turn accumulator owned by the definition context. */
export interface TurnActivityState {
  readonly turn: number;
  readonly startSeq: number;
  readonly startTime: number;
  /** Set exactly once, by the turn's own `turn/end` event. */
  readonly end:
    | { readonly seq: number; readonly time: number; readonly reasonKind: TurnEndReasonKind }
    | undefined;
  /** Step of the LAST `assistant/message` — the final answer row, never collapsed. */
  readonly finalStep: number | undefined;
  /** Deduped, first-seen tool call ids of this turn (for row classification). */
  readonly toolCallIds: readonly string[];
  /** Steps that streamed at least one `reasoning-delta` chunk. */
  readonly thinkingSteps: readonly number[];
  /**
   * Deduped `llm/retry` retry ids of this turn (for hiding the correlated
   * `model-retry` rows — the retry notice rendered inside the activity
   * region — when the turn is collapsed). A retry's key is its random
   * `retryId`, which carries no turn/step information, so the summary must
   * publish the ids for the projector to match rows back to this turn.
   */
  readonly retryIds: readonly string[];
  /**
   * Seq of the LAST non-final activity event; kept for the event-count/volume
   * invariants and the pre-freeze fallback only — the summary NO LONGER
   * anchors here.
   *
   * `step/end` and `llm/retry` do NOT advance this — they happen after the
   * step's `assistant/message` finalize (or replace the in-flight step
   * entirely) and would otherwise push the summary past the final answer.
   * Those events still bump `eventCount` so the turn's activity volume is
   * preserved.
   *
   * NOTE: `tool/call` / `tool/result` DO advance it, and in DSH's real event
   * order they arrive AFTER the `assistant/message` that declared them.
   */
  readonly lastActivitySeq: number;
  /**
   * Seq of the FIRST activity event of this turn that produces a visible
   * chat row (`assistant/chunk`, `assistant/message`, `tool/call`,
   * `tool/result` or `llm/retry` — deliberately NOT `step/start`).
   *
   * `step/start` is excluded because it renders no row of its own AND, in
   * DSH's real event order, the loop's pre-step `step/start(step=0)` lands
   * BEFORE the turn's `user/message` (dsh-session: the queued input's
   * `user/message` "records the messages entering the step" — verified in a
   * live session: turn 5's first visible row was `assistant-step5:1` and its
   * summary anchored above the user row). Including it pulled the summary
   * anchor above the user message, rendering the fold control at the END of
   * the previous turn.
   *
   * The summary row anchors just before this seq (`firstActivitySeq - 0.5`),
   * which puts the fold control at the TOP of the turn: after the
   * user/context messages (every visible-activity event follows the
   * `user/message` that entered the step) and before the first activity row.
   * `undefined` only for a turn that never streamed any visible activity —
   * such a turn never materializes a summary anyway.
   */
  readonly firstActivitySeq: number | undefined;
  /**
   * Seq of the most recent `assistant/message` event in this turn; `undefined`
   * while no assistant message has landed yet (a tool-only or empty turn,
   * which never summarizes anyway).
   */
  readonly lastFinalizeSeq: number | undefined;
  /**
   * Seq of the most recent `tool/call` / `tool/result` event. Compared
   * against `lastFinalizeSeq` at materialization time to decide whether the
   * last message is a real final answer or an intermediate "I'm calling a
   * tool" step (trailing tool activity means the turn never produced a final
   * answer, so nothing is exempted from collapsing).
   */
  readonly lastToolSeq: number | undefined;
  /**
   * Frozen summary anchor, captured exactly once when `turn/end` lands with
   * a final message: `firstActivitySeq - 0.5` — the top of the turn, right
   * after the user/context rows and before the first activity row. Late
   * events that re-materialize the summary afterwards (e.g. tool rows
   * landing after `turn/end`) refresh membership facts but never move the
   * anchor, so the summary row's position is stable across streaming,
   * reloads and replays. `undefined` until the turn settles.
   */
  readonly anchorSeq: number | undefined;
  /**
   * Frozen final-step decision captured at the same moment as `anchorSeq`:
   * the step of the last `assistant/message`, unless tool activity landed
   * AFTER that message — then the message is an intermediate "I'm calling a
   * tool" step, not a final answer, and `undefined` lets the projector hide
   * every activity row when collapsed.
   */
  readonly finalStepFrozen: number | undefined;
  readonly hasFinalMessage: boolean;
  readonly eventCount: number;
}

/** Immutable value published on the turn location and shipped in the view node. */
export interface TurnActivitySummary {
  readonly turn: number;
  readonly startSeq: number;
  readonly endSeq: number;
  readonly durationMs: number;
  readonly toolCount: number;
  readonly thinkingSteps: number;
  readonly hasFinalMessage: boolean;
  readonly reasonKind: TurnEndReasonKind;
  /** Frozen anchor of the summary row: the TOP of the turn
   *  (`firstActivitySeq - 0.5`), after the user/context rows and before the
   *  first activity row — the fold control stays put when toggling. */
  readonly anchorSeq: number;
  readonly finalStep: number | undefined;
  readonly toolCallIds: readonly string[];
  /** Correlated `llm/retry` ids; the projector hides the matching
   *  `model-retry` rows when the turn is collapsed. */
  readonly retryIds: readonly string[];
}

export const TURN_ACTIVITY_KIND = 'turn-activity';

/** Stable per-turn identity for the definition; role `start` only on turn/start. */
export function matchTurnActivity(
  event: SessionEvent,
): { id: string; role: 'start' | 'update' } | null {
  switch (event.type) {
    case 'turn/start':
      return { id: String(event.data.turn), role: 'start' };
    case 'turn/end':
    case 'step/start':
    case 'step/end':
    case 'assistant/chunk':
    case 'assistant/message':
    case 'tool/call':
    case 'tool/result':
    case 'llm/retry':
      return { id: String(event.data.turn), role: 'update' };
    default:
      return null;
  }
}

export function initialTurnActivityState(
  turn: number,
  seq: number,
  time: number,
): TurnActivityState {
  return {
    turn,
    startSeq: seq,
    startTime: time,
    end: undefined,
    finalStep: undefined,
    toolCallIds: [],
    thinkingSteps: [],
    retryIds: [],
    lastActivitySeq: seq,
    firstActivitySeq: undefined,
    lastFinalizeSeq: undefined,
    lastToolSeq: undefined,
    anchorSeq: undefined,
    finalStepFrozen: undefined,
    hasFinalMessage: false,
    eventCount: 0,
  };
}

function pushUnique<T>(list: readonly T[], value: T): readonly T[] {
  return list.includes(value) ? list : [...list, value];
}

/** Apply one post-start event; caller guarantees matchTurnActivity accepted it. */
export function updateTurnActivityState(
  state: TurnActivityState,
  event: SessionEvent,
): TurnActivityState {
  switch (event.type) {
    case 'turn/end': {
      const end = {
        seq: event.seq,
        time: event.time,
        reasonKind: event.data.reason.kind,
      };
      // Freeze the anchor exactly once, at the settle moment. The frozen
      // anchor is the TOP of the turn (`firstActivitySeq - 0.5`): the fold
      // control renders right after the user/context rows and before the
      // first activity row, so expanding/collapsing never moves the control
      // and never requires viewport compensation. Events that arrive after
      // `turn/end` re-materialize the summary for fresh membership facts but
      // must not move the anchor.
      const frozen = state.anchorSeq === undefined;
      const trailingTools =
        state.lastToolSeq !== undefined &&
        state.lastFinalizeSeq !== undefined &&
        state.lastToolSeq > state.lastFinalizeSeq;
      return {
        ...state,
        end,
        eventCount: state.eventCount + 1,
        ...(frozen
          ? {
              anchorSeq:
                state.firstActivitySeq !== undefined
                  ? state.firstActivitySeq - 0.5
                  : state.lastActivitySeq,
              finalStepFrozen: trailingTools ? undefined : state.finalStep,
            }
          : {}),
      };
    }
    case 'assistant/message':
      return {
        ...state,
        firstActivitySeq: state.firstActivitySeq ?? event.seq,
        finalStep: event.data.step,
        hasFinalMessage: true,
        // Record the finalize seq; a late `step/end` or `llm/retry` (which do
        // NOT advance `lastActivitySeq`) can never push the summary past the
        // final answer.
        lastFinalizeSeq: event.seq,
        eventCount: state.eventCount + 1,
      };
    case 'assistant/chunk':
      return {
        ...state,
        firstActivitySeq: state.firstActivitySeq ?? event.seq,
        thinkingSteps:
          event.data.chunk.type === 'reasoning-delta'
            ? pushUnique(state.thinkingSteps, event.data.step)
            : state.thinkingSteps,
        lastActivitySeq: event.seq,
        eventCount: state.eventCount + 1,
      };
    case 'tool/call':
      return {
        ...state,
        firstActivitySeq: state.firstActivitySeq ?? event.seq,
        toolCallIds: pushUnique(state.toolCallIds, String(event.data.callId)),
        lastActivitySeq: event.seq,
        lastToolSeq: event.seq,
        eventCount: state.eventCount + 1,
      };
    case 'tool/result':
      return {
        ...state,
        firstActivitySeq: state.firstActivitySeq ?? event.seq,
        lastActivitySeq: event.seq,
        lastToolSeq: event.seq,
        eventCount: state.eventCount + 1,
      };
    case 'step/start':
      // NOT recorded in `firstActivitySeq`: `step/start` renders no row, and
      // the loop's pre-step `step/start(step=0)` lands BEFORE the turn's
      // `user/message` — including it anchored the summary above the user
      // row (see the field docs). It only advances the volume counters.
      return {
        ...state,
        lastActivitySeq: event.seq,
        eventCount: state.eventCount + 1,
      };
    case 'step/end':
      // `step/end` closes a step AFTER its `assistant/message` finalize.
      // Advancing `lastActivitySeq` here would push the summary anchor past
      // the final answer; we only count the event so the turn's activity
      // volume stays accurate.
      return {
        ...state,
        eventCount: state.eventCount + 1,
      };
    case 'llm/retry': {
      // Same anchor rule as `step/end` (a retry may rewrite the in-flight
      // step before it finalizes). Record the retry id so the summary can
      // publish it and the projector can hide the correlated `model-retry`
      // row (its own key carries only the random retryId) when the turn is
      // collapsed.
      const retryId = event.data.retryId;
      return {
        ...state,
        firstActivitySeq: state.firstActivitySeq ?? event.seq,
        retryIds:
          typeof retryId === 'string' && retryId !== ''
            ? pushUnique(state.retryIds, retryId)
            : state.retryIds,
        eventCount: state.eventCount + 1,
      };
    }
    default:
      return state;
  }
}

/**
 * Derive the published summary. Returns null until the turn has ended AND a
 * final message exists — a tool-only or empty turn stays untouched.
 *
 * The anchor and final-step decision are the frozen values captured at
 * `turn/end` (`anchorSeq` / `finalStepFrozen`); the fallbacks cover the
 * theoretical "message lands after turn/end" ordering where nothing was
 * frozen yet. The anchor is the TOP of the turn (`firstActivitySeq - 0.5`),
 * so the fold control renders after the user/context rows and before the
 * first activity row.
 */
export function summarizeActivity(state: TurnActivityState): TurnActivitySummary | null {
  if (state.end === undefined || !state.hasFinalMessage) return null;
  return {
    turn: state.turn,
    startSeq: state.startSeq,
    endSeq: state.end.seq,
    durationMs: Math.max(0, state.end.time - state.startTime),
    toolCount: state.toolCallIds.length,
    thinkingSteps: state.thinkingSteps.length,
    hasFinalMessage: true,
    reasonKind: state.end.reasonKind,
    anchorSeq:
      state.anchorSeq ??
      (state.firstActivitySeq !== undefined
        ? state.firstActivitySeq - 0.5
        : state.lastActivitySeq),
    // `anchorSeq` being set is the "frozen" marker: `finalStepFrozen` may be
    // intentionally `undefined` (turn ended with tool activity after the
    // last message — no final answer). Only before any freeze (theoretical
    // "message lands after turn/end" ordering) do we fall back to the live
    // `finalStep`.
    finalStep: state.anchorSeq !== undefined ? state.finalStepFrozen : state.finalStep,
    toolCallIds: state.toolCallIds,
    retryIds: state.retryIds,
  };
}

/**
 * The ONLY auto-collapse rule: a normally completed turn. Everything else
 * (user stop, blocking, failure, token ceiling, crash-orphan) stays expanded.
 */
export function shouldAutoCollapse(summary: TurnActivitySummary): boolean {
  return summary.reasonKind === 'completed';
}
