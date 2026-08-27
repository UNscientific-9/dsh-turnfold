/**
 * Browser half: the turn-collapse plugin.
 *
 * Registers the turn-activity conversation definition, its chat renderer and
 * dictionaries, and owns the DOM projector lifecycle.
 */
import type { Context } from '@deepseek-ai/cordis';
// Loads the `@deepseek-ai/cordis` Context augmentation that declares `locale`.
import type {} from '@deepseek-ai/dsh-client-locale/client';
import { setAutoLoadSessions, startAutoLoad, type AutoLoadSessions } from './auto-load.ts';
import { TURN_ACTIVITY_KIND } from './activity-state.ts';
import { en, NS, zh } from './locales.ts';
import { hydrateMembership } from './projector.ts';
import { getProjector, setCurrentSessionReader } from './singletons.ts';
import { ensureStyles } from './styles.ts';
import { TurnActivityNodeView } from './summary-view.tsx';
import { createTurnActivityDefinition } from './turn-activity.ts';

/** Hard service dependencies (the client module system resolves these rows first). */
export const inject = ['slots', 'locale', 'conversationEvents'];

/** Bumped with every shipped change: shows up once in the browser console
 *  so a stale bundle (DSH serves the pnpm-installed copy) is obvious. */
export const CLIENT_VERSION = '0.2.8';

export function apply(ctx: Context): void {
  // One-shot load marker: makes "which bundle is the browser running"
  // answerable at a glance during deploys.
  console.info(`[dsh.turn-collapse] v${CLIENT_VERSION} loaded`);
  ensureStyles(document, CLIENT_VERSION);
  // Restore persisted membership snapshots before any render can record
  // fresher facts (existing entries win in hydrateMembership).
  hydrateMembership(typeof localStorage !== 'undefined' ? localStorage : undefined);

  ctx.conversationEvents.register(createTurnActivityDefinition());

  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    'turn-collapse: dictionaries',
  );

  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register(
      { name: 'conversation.chat.node', key: TURN_ACTIVITY_KIND, locale: NS },
      TurnActivityNodeView,
    ),
  );

  // Auto-load-older rides the host sessions service; if it is not mounted
  // yet (boot order), auto-load degrades to off until the next plugin mount.
  // The projector also needs the CURRENT session id when a column renders
  // no real summary row at all (window-cut turns only): the host sessions
  // service exposes its selection snapshot store, and DSH persists that
  // same selection to localStorage as `dsh.sessions.current` — read the
  // persisted record (it updates on every session switch) and then the
  // live snapshot if the service object carries it.
  const readLiveSessionId = (): string | null => {
    try {
      const sessions = ctx.get('sessions') as unknown as {
        selection?: { getSnapshot?: () => { sessionId?: string } };
      };
      const id = sessions.selection?.getSnapshot?.().sessionId;
      return typeof id === 'string' && id !== '' ? id : null;
    } catch {
      return null;
    }
  };
  setCurrentSessionReader(() => {
    try {
      const raw = localStorage.getItem('dsh.sessions.current');
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          typeof (parsed as { sessionId?: unknown }).sessionId === 'string'
        ) {
          const id = (parsed as { sessionId: string }).sessionId;
          if (id !== '') return id;
        }
      }
    } catch {
      // fall through to the live snapshot
    }
    // Third fallback: the membership snapshot persistence is keyed by
    // session id — a session that ever rendered a real summary bar left an
    // entry, and in the single-conversation window that key IS the current
    // session (multi-column layouts still prefer the DOM probe first).
    try {
      const raw = localStorage.getItem('dsh.turn-collapse.membership.v1');
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          const keys = Object.keys(parsed as Record<string, unknown>);
          const live = readLiveSessionId();
          if (live !== null && keys.includes(live)) return live;
          if (keys.length > 0) return keys[0]!;
        }
      }
    } catch {
      // fall through
    }
    return readLiveSessionId();
  });
  try {
    setAutoLoadSessions(ctx.get('sessions') as unknown as AutoLoadSessions);
  } catch {
    setAutoLoadSessions(undefined);
  }

  ctx.effect(
    () => {
      const stopAutoLoad = startAutoLoad(document);
      const projector = getProjector();
      projector.start();
      return () => {
        stopAutoLoad();
        projector.stop();
      };
    },
    'turn-collapse: projector + auto-load',
  );
}
