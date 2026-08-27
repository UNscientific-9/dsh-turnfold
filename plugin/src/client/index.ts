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
import { ensureBulkControls } from './bulk-controls.ts';
import { TURN_ACTIVITY_KIND } from './activity-state.ts';
import { en, NS, zh } from './locales.ts';
import { hydrateMembership } from './projector.ts';
import { getProjector, getStore } from './singletons.ts';
import { ensureStyles } from './styles.ts';
import { TurnActivityNodeView } from './summary-view.tsx';
import { createTurnActivityDefinition } from './turn-activity.ts';

/** Hard service dependencies (the client module system resolves these rows first). */
export const inject = ['slots', 'locale', 'conversationEvents'];

/** Bumped with every shipped change: shows up once in the browser console
 *  so a stale bundle (DSH serves the pnpm-installed copy) is obvious. */
export const CLIENT_VERSION = '0.2.0';

export function apply(ctx: Context): void {
  // One-shot load marker: makes "which bundle is the browser running"
  // answerable at a glance during deploys.
  console.info(`[dsh.turn-collapse] v${CLIENT_VERSION} loaded`);
  ensureStyles(document);
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
      // Bulk fold controls: re-evaluated on every store change so they
      // appear only while at least one fold bar exists.
      const refreshBulk = (): void =>
        ensureBulkControls(
          document,
          () =>
            document.querySelector('[data-dsh-ta-turn], [data-dsh-ta-synth-turn]') !== null,
          () => projector.bulkCollapse(true),
          () => projector.bulkCollapse(false),
        );
      refreshBulk();
      const unsubscribeBulk = getStore().subscribe(refreshBulk);
      return () => {
        unsubscribeBulk();
        stopAutoLoad();
        projector.stop();
      };
    },
    'turn-collapse: projector + auto-load',
  );
}
