/**
 * 行归属事实：从渲染出的 summary 行（DOM）读取成员事实（finalStep /
 * toolCallIds / retryIds / sessionId），并维护成员事实快照缓存。
 *
 * 缓存的意义：在分页/虚拟化对话中 summary 行可能不在文档里（loadOlder
 * 时尚未 flush，或未来的虚拟化布局丢弃屏外行），activity 行却已经渲染；
 * 每次 React 视图渲染 summary 都会重新记录事实，`mergeCached` 因此能在
 * summary 行暂时（或永久）缺失时继续折叠那些 turn。值按 turn 稳定，缓存
 * 只会回退到 DOM 本应提供的同一套事实。
 */
import { parseChatRowKey } from './row-keys.ts';
import { readMembershipMap, recordMembershipForPersist } from './membership-persist.ts';
import {
  DATA_FINAL_STEP,
  DATA_RETRIES,
  DATA_SESSION,
  DATA_TOOLS,
  DATA_TURN,
} from './constants.ts';
import type { RowWithElement, SummaryRef } from './types.ts';

// 共享类型定义在 types.ts（零依赖，type-only 引用，不形成模块环）；
// 此处 re-export 维持旧导入路径（外部统一经 projector.ts facade）。
export type { RowDescriptor, RowWithElement, SummaryRef } from './types.ts';

/** Read membership facts off the rendered summary rows. */
export function collectSummaries(column: ParentNode): ReadonlyMap<number, SummaryRef> {
  const map = new Map<number, SummaryRef>();
  for (const el of column.querySelectorAll<HTMLElement>(`[${DATA_TURN}]`)) {
    const turnText = el.getAttribute(DATA_TURN);
    if (turnText === null || !/^\d+$/.test(turnText)) continue;
    const turn = Number.parseInt(turnText, 10);
    const finalStepText = el.getAttribute(DATA_FINAL_STEP);
    const toolsText = el.getAttribute(DATA_TOOLS) ?? '';
    const retriesText = el.getAttribute(DATA_RETRIES) ?? '';
    const sessionId = el.getAttribute(DATA_SESSION);
    map.set(turn, {
      turn,
      finalStep:
        finalStepText === null || finalStepText === '' || !/^\d+$/.test(finalStepText)
          ? undefined
          : Number.parseInt(finalStepText, 10),
      toolCallIds: toolsText === '' ? [] : toolsText.split(','),
      retryIds: retriesText === '' ? [] : retriesText.split(','),
      sessionId: sessionId === null || sessionId === '' ? undefined : sessionId,
    });
  }
  return map;
}

/**
 * Membership-fact snapshot cache, keyed by session id then turn.
 *
 * The summary row is the DOM source of the membership facts
 * (`data-dsh-ta-*`), but in a paged/windowed conversation the row can be
 * absent from the document while its activity rows are rendered — e.g. the
 * host loads older history pages (`loadOlder`) and the summary row has not
 * been flushed yet, or a future virtualized layout drops off-screen rows.
 * Every time the React view renders a summary it re-records the facts here,
 * so `mergeCached` can keep folding those turns even while their summary row
 * is temporarily (or permanently) missing. Values are stable per turn, so
 * the cache only ever falls back to the same facts the DOM would provide.
 */
const membershipCache = new Map<string, Map<number, SummaryRef>>();
const MEMBERSHIP_CACHE_MAX_PER_SESSION = 512;

/** Record one turn's membership facts (called by the summary view). */
export function rememberMembership(sessionId: string, ref: SummaryRef): void {
  let byTurn = membershipCache.get(sessionId);
  if (byTurn === undefined) {
    byTurn = new Map();
    membershipCache.set(sessionId, byTurn);
  }
  byTurn.set(ref.turn, ref);
  if (byTurn.size > MEMBERSHIP_CACHE_MAX_PER_SESSION) {
    // Map iteration order is insertion order; drop the oldest entry.
    const oldest = byTurn.keys().next().value as number | undefined;
    if (oldest !== undefined) byTurn.delete(oldest);
  }
  // Survive the page: debounce-write the snapshot so a refresh outside the
  // 50-event window can still fold previously-seen turns with accurate
  // facts (membership-persist.ts). No-op under Node tests / private mode.
  recordMembershipForPersist(
    typeof localStorage !== 'undefined' ? localStorage : undefined,
    sessionId,
    ref,
  );
}

/**
 * Restore persisted membership snapshots into the in-memory cache (once,
 * at plugin mount). Existing entries win — a live render is fresher than
 * the persisted record.
 */
export function hydrateMembership(storage: Storage | undefined): void {
  for (const [sessionId, byTurn] of readMembershipMap(storage)) {
    let target = membershipCache.get(sessionId);
    if (target === undefined) {
      target = new Map();
      membershipCache.set(sessionId, target);
    }
    for (const [turn, ref] of byTurn) {
      if (!target.has(turn)) target.set(turn, ref);
    }
  }
}

/**
 * Merge the DOM-collected summaries with the cached membership facts for the
 * column's owner session. DOM facts win (they are the freshest render);
 * cached facts fill in turns whose summary row is not in the document.
 */
export function mergeCached(
  summaries: ReadonlyMap<number, SummaryRef>,
  sessionId: string | null,
): Map<number, SummaryRef> {
  const merged = new Map(summaries);
  if (sessionId === null) return merged;
  const cached = membershipCache.get(sessionId);
  if (cached === undefined) return merged;
  for (const [turn, ref] of cached) {
    if (!merged.has(turn)) merged.set(turn, ref);
  }
  return merged;
}

/** Pick the rendered summary row that owns a turn number. Each session numbers
 *  its turns independently, so several chat-flow columns can render the same
 *  turn number at the same time; prefer the row whose `data-dsh-ta-session`
 *  matches the caller's session, falling back to the first row when no row
 *  matches (a legacy row without the attribute, or a stale caller session) —
 *  which reproduces the old single-column behavior. */
export function pickSummaryRowBySession(
  rows: readonly HTMLElement[],
  session: string | null,
): HTMLElement | null {
  let fallback: HTMLElement | null = null;
  for (const row of rows) {
    if (fallback === null) fallback = row;
    if (session !== null && row.getAttribute(DATA_SESSION) === session) return row;
  }
  return fallback;
}

/** True for rows the projector intentionally leaves alone: every kind the
 *  row-key grammar recognises except `assistant-step` and `tool-call` (the
 *  two collapsible activity kinds). Used only by the debug hook to surface
 *  rows that might be missed (e.g. the unresolved `model-retry`). */
export function isUnownedRow(row: RowWithElement): boolean {
  const parsed = parseChatRowKey(row.key);
  if (parsed === null) return false;
  return parsed.kind !== 'assistant-step' && parsed.kind !== 'tool-call';
}
