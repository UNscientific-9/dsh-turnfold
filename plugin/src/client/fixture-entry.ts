/**
 * Browser-integration fixture entry.
 *
 * Loaded by `lib/fixture.js` (built by build.ps1) into the static DSH-mock
 * page under `browser-integration/fixtures/`. Boots the projector the same
 * way `src/client/index.ts` would, but without React / cordis — those
 * runtimes are not part of the projector's contract, so the static mock
 * page only needs the projector + store + membership cache, all of which
 * are DOM/localStorage operations.
 *
 * Summary rows in the fixture page are bare DOM (not React-rendered) but
 * carry the exact `data-dsh-ta-*` attributes the projector reads. This
 * entry emulates the React view's two effects:
 *   1. On first mount of a completed turn, call store.setCollapsed
 *      + projector.applyTurnCollapse so the auto-collapse rule fires.
 *   2. On a toggle click or Enter/Space keypress, swap the decision and
 *      re-apply (userDriven).
 *
 * The auto-collapse decision is driven by a `data-dsh-ta-auto-collapse`
 * attribute on the summary row (the fixture cannot read the engine's
 * TurnActivitySummary node data, so each test sets this attribute per
 * turn to express its `shouldAutoCollapse` verdict).
 */
import { getProjector, getStore, setCurrentSessionReader } from './singletons.ts';

const projector = getProjector();
const store = getStore();

interface WindowWithFixture extends Window {
  __dshTurnfold?: {
    getProjector: typeof getProjector;
    getStore: typeof getStore;
    setSession: (sessionId: string | null) => void;
    applyCollapse: (sessionId: string, turn: number, collapsed: boolean) => void;
    setCollapsed: (sessionId: string, turn: number, state: 'collapsed' | 'expanded') => void;
    getCollapsed: (sessionId: string, turn: number) => 'collapsed' | 'expanded' | undefined;
  };
}

declare const window: WindowWithFixture;

function readSessionIdFromElement(el: Element): string {
  return el.getAttribute('data-dsh-ta-session') ?? 'fixture-session';
}

function readTurnFromElement(el: Element): number | null {
  const text = el.getAttribute('data-dsh-ta-turn');
  if (text === null) return null;
  const turn = Number(text);
  return Number.isFinite(turn) ? turn : null;
}

/** Replay the summary-view's first-mount auto-collapse effect. */
function replayAutoCollapse(): void {
  for (const el of document.querySelectorAll('[data-dsh-ta-turn]')) {
    const sessionId = readSessionIdFromElement(el);
    const turn = readTurnFromElement(el);
    if (turn === null) continue;
    if (store.getCollapsed(sessionId, turn) === undefined) {
      const autoCollapse = el.getAttribute('data-dsh-ta-auto-collapse') === 'true';
      if (autoCollapse) {
        store.setCollapsed(sessionId, turn, 'collapsed');
      }
    }
  }
}

function applyFromButton(btn: HTMLButtonElement, collapsed: boolean): void {
  const sessionId = btn.getAttribute('data-dsh-ta-session') ?? 'fixture-session';
  const turnText = btn.getAttribute('data-dsh-ta-turn');
  if (turnText === null) return;
  const turn = Number(turnText);
  if (!Number.isFinite(turn)) return;
  const state = collapsed ? 'collapsed' : 'expanded';
  store.setCollapsed(sessionId, turn, state);
  projector.applyTurnCollapse(sessionId, turn, collapsed, { userDriven: true });
}

function wireToggle(btn: HTMLButtonElement): void {
  btn.addEventListener('click', () => {
    const currentlyCollapsed = btn.getAttribute('aria-expanded') === 'false';
    applyFromButton(btn, !currentlyCollapsed);
  });
  btn.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const currentlyCollapsed = btn.getAttribute('aria-expanded') === 'false';
      applyFromButton(btn, !currentlyCollapsed);
    }
  });
}

// Default the projector session reader to a stable fixture id so
// single-column fixture pages resolve without extra DOM probing.
setCurrentSessionReader(() => 'fixture-session');

replayAutoCollapse();
projector.start();

for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('.dsh-ta-toggle'))) {
  wireToggle(btn);
}

window.__dshTurnfold = {
  getProjector,
  getStore,
  setSession: (sessionId) => projector.setSession(sessionId),
  applyCollapse: (sessionId, turn, collapsed) => {
    store.setCollapsed(sessionId, turn, collapsed ? 'collapsed' : 'expanded');
    projector.applyTurnCollapse(sessionId, turn, collapsed, { userDriven: true });
  },
  setCollapsed: (sessionId, turn, state) => {
    store.setCollapsed(sessionId, turn, state);
  },
  getCollapsed: (sessionId, turn) => store.getCollapsed(sessionId, turn),
};
