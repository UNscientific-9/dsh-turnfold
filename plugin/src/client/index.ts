/**
 * Browser half: the dsh-turnfold plugin — an enhancement layer over the
 * official DSH 0.1.2 turn-process fold bar.
 *
 * Registers the turn-activity conversation definition (augment data only)
 * and a shadow renderer that takes over the official `turn-process` slot,
 * plus dictionaries and the auto-load-older loop.
 */
import type { Context } from '@deepseek-ai/cordis';
// Loads the `@deepseek-ai/cordis` Context augmentation that declares `locale`.
import type {} from '@deepseek-ai/dsh-client-locale/client';
// Loads the SlotRegistry service merge（`ctx.slots`）——`import type {}` 的
// augmentation 在 d.ts emit 时会被抹掉，必须由插件显式导入才能进入编译。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
// Loads the Context augmentation that declares `uiConversation`。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
// Loads the SlotMap merge for `conversation.chat.node`（keyed slot 声明）。
import type {} from '@deepseek-ai/dsh-client-ui-chat/client';
import { setAutoLoadSessionReader, setAutoLoadSessions, startAutoLoad, type AutoLoadSessions } from './auto-load.ts';
import { FoldBarView } from './fold-bar-view.tsx';
import { en, NS, zh } from './locales.ts';
import { ensureStyles } from './styles.ts';
import { createTurnActivityDefinition } from './turn-activity.ts';

/**
 * Hard service dependencies (the client module system resolves these rows first).
 */
export const inject = ['slots', 'locale', 'uiConversation'];

/** Bumped with every shipped change: shows up once in the browser console
 *  so a stale bundle (DSH serves the pnpm-installed copy) is obvious. */
export const CLIENT_VERSION = '0.3.0';

export function apply(ctx: Context): void {
  // One-shot load marker: makes "which bundle is the browser running"
  // answerable at a glance during deploys.
  console.info(`[dsh.turnfold] v${CLIENT_VERSION} loaded`);
  ensureStyles(document, CLIENT_VERSION);

  ctx.uiConversation.events.register(createTurnActivityDefinition());

  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    'dsh-turnfold: dictionaries',
  );

  // Shadow the official `turn-process` renderer: same key at a LOWER priority
  // (lowest renders; same key + same priority would throw). The slot's
  // hookContext gives our view `useTurnData`, and the session scope delivers
  // `sessionId`.
  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register(
      { name: 'conversation.chat.node', key: 'turn-process', priority: -1, locale: NS },
      FoldBarView,
    ),
  );

  // Auto-load-older rides the host sessions service; if it is not mounted
  // yet (boot order), auto-load degrades to off until the next plugin mount.
  // Session identity comes from the host selection snapshot first, then the
  // persisted record DSH keeps in localStorage (`dsh.sessions.current`, which
  // updates on every session switch).
  try {
    setAutoLoadSessions(ctx.get('sessions') as unknown as AutoLoadSessions);
  } catch {
    setAutoLoadSessions(undefined);
  }
  setAutoLoadSessionReader(() => {
    try {
      const sessions = ctx.get('sessions') as unknown as {
        selection?: { getSnapshot?: () => { sessionId?: string } };
      };
      const id = sessions.selection?.getSnapshot?.().sessionId;
      if (typeof id === 'string' && id !== '') return id;
    } catch {
      // fall through to the persisted record
    }
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
      // no persisted record — auto-load idles this tick
    }
    return null;
  });

  ctx.effect(
    () => startAutoLoad(document),
    'dsh-turnfold: auto-load',
  );
}
