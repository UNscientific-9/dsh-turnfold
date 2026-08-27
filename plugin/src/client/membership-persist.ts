/**
 * Persisted membership snapshots (localStorage-backed, injectable storage).
 *
 * The in-memory membership cache (row-membership.ts) dies with the page; after
 * a refresh the 50-event window only replays the newest turns, so turns seen
 * before the refresh but outside the window would lose their accurate
 * facts (final step, tool/retry ids) and fall back to synthesized guesses.
 * Persisting the snapshots closes that gap: on mount the plugin rehydrates
 * the in-memory cache, and `mergeCached` then folds those turns with
 * engine-accurate facts until their real summary rows re-materialize.
 *
 * Layout: `dsh.turn-collapse.membership.v1` ->
 * `{ [sessionId]: { [turn]: { finalStep, tools, retries } } }`. Per-session
 * entries are capped (lowest turn evicted) so a very long conversation
 * cannot grow the record without bound. Writes are debounced — the React
 * view re-renders summaries frequently and each render re-records facts.
 */
// type-only：运行时 row-membership 依赖本模块（readMembershipMap /
// recordMembershipForPersist），类型从零依赖的 types.ts 引入，不形成环。
import type { SummaryRef } from './types.ts';

export const MEMBERSHIP_STORAGE_KEY = 'dsh.turn-collapse.membership.v1';

export const MEMBERSHIP_MAX_TURNS_PER_SESSION = 256;
const FLUSH_DELAY_MS = 500;

interface StoredTurn {
  readonly finalStep: number | undefined;
  readonly tools: readonly string[];
  readonly retries: readonly string[];
}

type StoredShape = Record<string, Record<string, StoredTurn>>;

const latest = new Map<string, Map<number, SummaryRef>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Read persisted snapshots back into a per-session/per-turn map. */
export function readMembershipMap(storage: Storage | undefined): Map<string, Map<number, SummaryRef>> {
  const result = new Map<string, Map<number, SummaryRef>>();
  if (storage === undefined) return result;
  try {
    const raw = storage.getItem(MEMBERSHIP_STORAGE_KEY);
    if (raw === null) return result;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return result;
    for (const [sessionId, turns] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof turns !== 'object' || turns === null) continue;
      const byTurn = new Map<number, SummaryRef>();
      for (const [turnKey, value] of Object.entries(turns as Record<string, unknown>)) {
        if (!/^\d+$/.test(turnKey) || typeof value !== 'object' || value === null) continue;
        const record = value as Partial<StoredTurn>;
        if (!Array.isArray(record.tools) || !Array.isArray(record.retries)) continue;
        if (record.tools.some((id) => typeof id !== 'string')) continue;
        if (record.retries.some((id) => typeof id !== 'string')) continue;
        const turn = Number(turnKey);
        byTurn.set(turn, {
          turn,
          finalStep:
            typeof record.finalStep === 'number' && Number.isInteger(record.finalStep)
              ? record.finalStep
              : undefined,
          toolCallIds: [...record.tools],
          retryIds: [...record.retries],
          sessionId,
        });
      }
      if (byTurn.size > 0) result.set(sessionId, byTurn);
    }
  } catch {
    // Corrupt or unreadable record: start empty (the in-memory cache and
    // the synthesized fallback keep folding working for this page).
  }
  return result;
}

function storedShape(): StoredShape {
  const shape: StoredShape = {};
  for (const [sessionId, byTurn] of latest) {
    const turns: Record<string, StoredTurn> = {};
    // Cap per session: evict the LOWEST turns (oldest of an increasing
    // sequence) when over budget.
    const overflow = Math.max(0, byTurn.size - MEMBERSHIP_MAX_TURNS_PER_SESSION);
    let evicted = 0;
    for (const turn of [...byTurn.keys()].sort((a, b) => a - b)) {
      if (evicted < overflow) {
        evicted += 1;
        continue;
      }
      const ref = byTurn.get(turn);
      if (ref === undefined) continue;
      turns[String(turn)] = {
        finalStep: ref.finalStep,
        tools: ref.toolCallIds,
        retries: ref.retryIds,
      };
    }
    shape[sessionId] = turns;
  }
  return shape;
}

function flush(storage: Storage | undefined): void {
  flushTimer = null;
  if (storage === undefined) return;
  try {
    storage.setItem(MEMBERSHIP_STORAGE_KEY, JSON.stringify(storedShape()));
  } catch {
    // Quota exceeded / private mode: folding still works from memory.
  }
}

/**
 * Record one render's facts into the persistable snapshot and schedule a
 * debounced write. Safe under Node tests (no localStorage) and private
 * modes (write failures degrade to no-ops).
 */
export function recordMembershipForPersist(
  storage: Storage | undefined,
  sessionId: string,
  ref: SummaryRef,
): void {
  if (storage === undefined) return;
  let byTurn = latest.get(sessionId);
  if (byTurn === undefined) {
    byTurn = new Map();
    latest.set(sessionId, byTurn);
  }
  byTurn.set(ref.turn, ref);
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => flush(storage), FLUSH_DELAY_MS);
}

/** Drop the pending timer (used by tests). */
export function cancelMembershipFlushForTest(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}
