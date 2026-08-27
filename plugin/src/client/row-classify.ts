/**
 * 行分类：把每行归类到「隐藏 / 保留 / final-think 标记」——纯函数，无 DOM
 * 写入、无 store 访问（只通过注入的 `isCollapsed` 谓词读决策）。
 */
import { parseChatRowKey } from './row-keys.ts';
import type { RowWithElement, SummaryRef } from './row-membership.ts';

const ASSISTANT_ID = /^(\d+):(\d+)$/;

/**
 * Decide the hide target for every row. Pure: no DOM access, no store access
 * beyond the injected `isCollapsed` predicate. Rows outside any summarized
 * turn and rows of unrelated kinds are never touched.
 * @returns a Map from the exact row objects passed in to their hide target.
 */
export function computeRowTargets<Row extends RowWithElement>(
  rows: readonly Row[],
  summaries: ReadonlyMap<number, SummaryRef>,
  isCollapsed: (turn: number) => boolean,
): ReadonlyMap<Row, boolean> {
  // Reverse indexes: `tool-call` / `model-retry` rows carry only a random id,
  // and ownership is decided by scanning every summary's id list. Pre-building
  // id -> turn turns that O(rows × turns × ids) scan into O(rows) lookups —
  // the per-click cost of toggling grows with the conversation, which the
  // user feels as a delayed response. First write wins, mirroring the old
  // "first matching summary" loop order (summaries iterate in insertion
  // order: DOM, then cache, then synth).
  const toolOwner = new Map<string, number>();
  const retryOwner = new Map<string, number>();
  for (const [turn, summary] of summaries) {
    for (const id of summary.toolCallIds) if (!toolOwner.has(id)) toolOwner.set(id, turn);
    for (const id of summary.retryIds) if (!retryOwner.has(id)) retryOwner.set(id, turn);
  }
  const targets = new Map<Row, boolean>();
  for (const row of rows) {
    const parsed = parseChatRowKey(row.key);
    if (parsed === null) {
      targets.set(row, false);
      continue;
    }
    if (parsed.kind === 'assistant-step') {
      const match = ASSISTANT_ID.exec(parsed.id);
      if (match === null) {
        targets.set(row, false);
        continue;
      }
      const turn = Number(match[1]);
      const step = Number(match[2]);
      const summary = summaries.get(turn);
      if (summary === undefined) {
        targets.set(row, false);
        continue;
      }
      // The final answer row is never hidden, even while collapsed.
      const isFinal = summary.finalStep !== undefined && step === summary.finalStep;
      targets.set(row, !isFinal && isCollapsed(turn));
      continue;
    }
    if (parsed.kind === 'tool-call') {
      const turn = toolOwner.get(parsed.id);
      targets.set(row, turn !== undefined && isCollapsed(turn));
      continue;
    }
    if (parsed.kind === 'model-retry') {
      // A retry notice row keyed by its random `retryId` (no turn/step
      // info); ownership comes exclusively from the summary's published
      // retry ids. Without this branch the retry block stays visible in the
      // middle of a collapsed turn — the "missing fold" gap.
      const turn = retryOwner.get(parsed.id);
      targets.set(row, turn !== undefined && isCollapsed(turn));
      continue;
    }
    targets.set(row, false);
  }
  return targets;
}

/**
 * True when a row is the FINAL answer row of a turn that is currently
 * collapsed. The final row itself is never hidden (product rule), but its
 * in-row thinking block must fold with the activity; `applyFinalThinkMarkers`
 * marks exactly these rows so CSS can hide `[data-variant="think"]` inside
 * them. Uses the merged summaries (real + cached + synthesized), so
 * window-cut turns get the same treatment.
 */
export function isFinalThinkRow(
  row: RowWithElement,
  summaries: ReadonlyMap<number, SummaryRef>,
  isCollapsed: (turn: number) => boolean,
): boolean {
  const parsed = parseChatRowKey(row.key);
  if (parsed === null || parsed.kind !== 'assistant-step') return false;
  const match = ASSISTANT_ID.exec(parsed.id);
  if (match === null) return false;
  const turn = Number(match[1]);
  const step = Number(match[2]);
  const summary = summaries.get(turn);
  return summary?.finalStep === step && isCollapsed(turn);
}

/**
 * Apply/clear the final-think marker on every row, idempotent. Called from
 * `applyPlan` BEFORE the fold/unfold branch: the marker must land on every
 * path — including the animated user-toggle branch, which hands the activity
 * rows to `beginAnimatedTransition` and never runs `applyRowTargets`.
 */
export function applyFinalThinkMarkers(
  rows: readonly RowWithElement[],
  summaries: ReadonlyMap<number, SummaryRef>,
  isCollapsed: (turn: number) => boolean,
): void {
  for (const row of rows) {
    const want = isFinalThinkRow(row, summaries, isCollapsed);
    const has = row.element.dataset.dshTaFinalCollapsed === 'true';
    if (want !== has) {
      if (want) row.element.dataset.dshTaFinalCollapsed = 'true';
      else delete row.element.dataset.dshTaFinalCollapsed;
    }
  }
}
