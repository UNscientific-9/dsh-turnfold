/**
 * Collapse-state persistence (localStorage-backed, injectable for tests).
 *
 * Layout: `dsh.turn-collapse.v1` -> `{ [sessionId]: { [turn]: 'collapsed'|'expanded' } }`.
 * Both decisions are stored so a refresh restores the user's last choice:
 * an auto-collapsed turn survives reload as collapsed, a manually expanded
 * turn stays expanded even though `shouldAutoCollapse` would still fire for
 * it. Absence means "no decision yet" (first mount of a fresh turn).
 */
export const STORAGE_KEY = 'dsh.turn-collapse.v1';

export type PersistedTurnState = 'collapsed' | 'expanded';

export type PersistedMap = Readonly<
  Record<string, Readonly<Record<string, PersistedTurnState>>>
>;

export interface CollapsePersistence {
  read(): PersistedMap;
  write(map: PersistedMap): void;
}

/** Tolerant storage adapter: quota/privacy-mode errors degrade to a no-op.
 *  A module-lifetime MEMORY layer sits in front of storage: `write` always
 *  lands in memory (so the store behaves identically even when setItem
 *  throws — quota, private mode), and `read` serves the cache once warm.
 *  Without it, a failed write silently lost every decision and the fold
 *  state flipped back to "no decision" on the very next read. */
export function createStoragePersistence(storage: Storage | undefined): CollapsePersistence {
  let cache: PersistedMap | undefined;
  return {
    read(): PersistedMap {
      if (cache !== undefined) return cache;
      if (storage === undefined) return {};
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return {};
        const parsed: unknown = JSON.parse(raw);
        cache = isPersistedMap(parsed) ? parsed : {};
        return cache;
      } catch {
        return {};
      }
    },
    write(map: PersistedMap): void {
      cache = map;
      if (storage === undefined) return;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(map));
      } catch {
        // Quota exceeded / private mode: collapsing still works for this page.
      }
    },
  };
}

function isPersistedMap(value: unknown): value is PersistedMap {
  if (typeof value !== 'object' || value === null) return false;
  for (const [sessionId, turns] of Object.entries(value)) {
    if (typeof sessionId !== 'string') return false;
    if (typeof turns !== 'object' || turns === null) return false;
    for (const [turn, state] of Object.entries(turns)) {
      if (!/^\d+$/.test(turn)) return false;
      if (state !== 'collapsed' && state !== 'expanded') return false;
    }
  }
  return true;
}

/** Undefined = no recorded decision. */
export function readPersistedTurn(
  persistence: CollapsePersistence,
  sessionId: string,
  turn: number,
): PersistedTurnState | undefined {
  if (!isValidTurn(turn)) return undefined;
  return persistence.read()[sessionId]?.[String(turn)];
}

export function withPersistedTurn(
  persistence: CollapsePersistence,
  sessionId: string,
  turn: number,
  state: PersistedTurnState,
): PersistedMap {
  // Refuse to write a key the read path will reject; otherwise the next
  // read returns {} and silently destroys every prior session's decisions.
  if (!isValidTurn(turn)) return persistence.read();
  const map = persistence.read();
  const sessions = { ...map };
  const turns = { ...(sessions[sessionId] ?? {}) };
  turns[String(turn)] = state;
  sessions[sessionId] = turns;
  return sessions;
}

/** A persisted turn key must round-trip as a non-empty `\d+` string. */
function isValidTurn(turn: number): boolean {
  return Number.isInteger(turn) && turn >= 0;
}
