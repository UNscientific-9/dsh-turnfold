/**
 * Synthesized turn summaries for turns whose engine context never existed.
 *
 * DSH installs only the most recent ~50 events when a session opens and
 * prepends one earlier page per "load older" click — the page boundary does
 * NOT follow turn boundaries. A turn whose `turn/start` falls outside the
 * window never assembles an engine context, so no real summary row is ever
 * materialized for it, and the projector's row classification (which trusts
 * engine-published membership facts) leaves every one of its rows visible
 * forever.
 *
 * The DOM alone carries enough facts to offer a fold control for those
 * turns:
 * - `assistant-step` keys carry `<turn>:<step>` — the authoritative turn
 *   number (verified in a live session: a window-cut turn rendered
 *   `assistant-step5:1…` with no turn/start in the window).
 * - `tool-call` keys carry only the random callId — ownership is inferred
 *   from flow order (see the pending-tools queue below).
 * - `turn-tail` keys carry the turn number and mark a FINISHED turn — a
 *   running turn has no tail row, which keeps the default-collapse away
 *   from the turn currently streaming.
 * - `model-retry` keys carry only a random retryId — NOT attributable, so
 *   synthesized summaries publish an empty retry list and those rows stay
 *   visible (same trade-off as the engine-side 2-c gap).
 *
 * A synthesized summary is a *fallback*: it fills only turns whose real
 * summary row is absent from the DOM. As soon as the engine materializes
 * the real row (the user loads the page containing `turn/start`), the real
 * facts win and the synthesized bar is removed by the projector.
 */
import { parseChatRowKey } from './row-keys.ts';

/** A flow row bound to its live element (subset of projector's RowWithElement). */
export interface SynthSourceRow {
  /** `data-chat-anchor-key` value. */
  readonly key: string;
  /** `data-chat-flow-kind` value. */
  readonly kind: string | undefined;
  readonly element: HTMLElement;
}

/** A fallback summary produced from DOM row order alone. */
export interface SynthesizedSummary {
  readonly turn: number;
  /** The largest step seen for this turn, unless a cached real summary
   *  supplies the accurate one — a conservative stand-in for the final
   *  answer (worst case, the last message row stays visible). */
  readonly finalStep: number;
  readonly toolCallIds: readonly string[];
  /** Empty unless a cached real summary supplied retry ids: retry rows are
   *  not attributable from the DOM alone. */
  readonly retryIds: readonly string[];
  readonly sessionId: string | null;
  /** Distinct step rows seen for this turn. */
  readonly stepCount: number;
  /** First visible activity row of the turn — the synthesized bar's
   *  insertion anchor (the bar must sit above every activity row). */
  readonly anchorRow: HTMLElement;
  /** True when accurate membership facts came from the membership cache. */
  readonly fromCache: boolean;
}

const ASSISTANT_ID = /^(\d+):(\d+)$/;
const TAIL_ID = /^\d+$/;

/**
 * Pure classification pass over the flow rows. `domTurns` are the turns
 * whose REAL summary row is currently in the document (they get no bar);
 * `cached` supplies accurate membership facts when the real row is merely
 * outside the document but the turn was seen before (membership cache).
 */
export function computeSyntheticSummaries(
  rows: readonly SynthSourceRow[],
  domTurns: ReadonlyMap<number, unknown>,
  cached: ReadonlyMap<
    number,
    { finalStep: number | undefined; toolCallIds: readonly string[]; retryIds: readonly string[] }
  >,
  sessionId: string | null,
): ReadonlyMap<number, SynthesizedSummary> {
  interface Mutable {
    maxStep: number;
    steps: Set<number>;
    toolIds: string[];
    toolSeen: Set<string>;
    anchorRow: HTMLElement | undefined;
  }
  const byTurn = new Map<number, Mutable>();
  const finished = new Set<number>();
  let currentTurn: number | null = null;
  // Tool rows whose turn is not yet known: they appeared after a turn-tail
  // (previous turn closed) but before the next turn's first step row. A
  // tool row's anchor (the tool/call seq) can sort BEFORE the owning step's
  // row, so flow order alone must not attribute it to the previous turn.
  let pendingTools: string[] = [];
  const ensure = (turn: number): Mutable => {
    let entry = byTurn.get(turn);
    if (entry === undefined) {
      entry = { maxStep: 0, steps: new Set(), toolIds: [], toolSeen: new Set(), anchorRow: undefined };
      byTurn.set(turn, entry);
    }
    return entry;
  };
  for (const row of rows) {
    const parsed = parseChatRowKey(row.key);
    if (parsed === null) continue;
    if (parsed.kind === 'assistant-step') {
      const match = ASSISTANT_ID.exec(parsed.id);
      if (match === null) continue;
      const turn = Number(match[1]);
      const step = Number(match[2]);
      currentTurn = turn;
      const entry = ensure(turn);
      entry.maxStep = Math.max(entry.maxStep, step);
      entry.steps.add(step);
      entry.anchorRow ??= row.element;
      if (pendingTools.length > 0) {
        for (const id of pendingTools) {
          if (!entry.toolSeen.has(id)) {
            entry.toolSeen.add(id);
            entry.toolIds.push(id);
          }
        }
        pendingTools = [];
      }
      continue;
    }
    if (parsed.kind === 'tool-call') {
      if (currentTurn !== null) {
        const entry = ensure(currentTurn);
        if (!entry.toolSeen.has(parsed.id)) {
          entry.toolSeen.add(parsed.id);
          entry.toolIds.push(parsed.id);
        }
      } else {
        pendingTools.push(parsed.id);
      }
      continue;
    }
    if (parsed.kind === 'turn-tail') {
      if (TAIL_ID.test(parsed.id)) finished.add(Number(parsed.id));
      currentTurn = null;
      // Tool rows that arrived before this tail belong to the turn that
      // just closed (best effort); the queue restarts for the next turn.
      if (pendingTools.length > 0) {
        const entry = byTurn.get(Number(parsed.id));
        if (entry !== undefined) {
          for (const id of pendingTools) {
            if (!entry.toolSeen.has(id)) {
              entry.toolSeen.add(id);
              entry.toolIds.push(id);
            }
          }
        }
        pendingTools = [];
      }
    }
  }

  const result = new Map<number, SynthesizedSummary>();
  for (const [turn, entry] of byTurn) {
    // A running turn has no tail row yet — never fold it by default.
    if (!finished.has(turn)) continue;
    if (domTurns.has(turn)) continue; // real summary row is in the document
    if (entry.anchorRow === undefined) continue;
    const known = cached.get(turn);
    const finalStep = known?.finalStep ?? entry.maxStep;
    const toolCallIds =
      known !== undefined && known.toolCallIds.length > 0 ? known.toolCallIds : entry.toolIds;
    result.set(turn, {
      turn,
      finalStep,
      toolCallIds,
      retryIds: known?.retryIds ?? [],
      sessionId,
      stepCount: entry.steps.size,
      anchorRow: entry.anchorRow,
      fromCache: known !== undefined,
    });
  }
  return result;
}

const zh = (steps: number, tools: number): string =>
  tools > 0 ? `执行步骤 ${steps} · 工具 ${tools}` : `执行步骤 ${steps}`;
const en = (steps: number, tools: number): string =>
  tools > 0 ? `${steps} steps · ${tools} tools` : `${steps} steps`;

/** Collapsed-bar label for a synthesized turn (bilingual, DOM-side). The
 *  locale is injectable so tests are deterministic; production reads the
 *  browser language. */
export function synthLabel(
  stepCount: number,
  toolCount: number,
  locale: string = typeof navigator !== 'undefined' ? navigator.language : 'zh-CN',
): string {
  return locale.toLowerCase().startsWith('zh')
    ? zh(stepCount, toolCount)
    : en(stepCount, toolCount);
}
