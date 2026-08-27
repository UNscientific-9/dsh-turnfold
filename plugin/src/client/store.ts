/**
 * Collapse store: the single source of truth for per-session/per-turn
 * collapsed state. React views subscribe via `useSyncExternalStore`; the DOM
 * projector subscribes to re-apply rows on change.
 */
import {
  type CollapsePersistence,
  type PersistedTurnState,
  readPersistedTurn,
  withPersistedTurn,
} from './persist.ts';

export interface CollapseStore {
  /** Recorded decision; undefined means "no decision yet" (fresh turn). */
  getCollapsed(sessionId: string, turn: number): PersistedTurnState | undefined;
  /** Record a user/auto decision and persist it. */
  setCollapsed(sessionId: string, turn: number, state: PersistedTurnState): void;
  /** React / projector subscription; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export function createCollapseStore(persistence: CollapsePersistence): CollapseStore {
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        // A subscriber bug must never break the store, but it must be visible
        // so it doesn't masquerade as a "the collapse stopped working" symptom.
        // eslint-disable-next-line no-console
        console.error('dsh-turnfold: subscriber threw', error);
      }
    }
  };
  return {
    getCollapsed(sessionId, turn) {
      return readPersistedTurn(persistence, sessionId, turn);
    },
    setCollapsed(sessionId, turn, state) {
      persistence.write(withPersistedTurn(persistence, sessionId, turn, state));
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
