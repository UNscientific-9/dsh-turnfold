import type { Page, Locator } from '@playwright/test';

/** Minimal shape of the handle `lib/fixture.js` mounts on `window`. */
export interface FixtureHandle {
  getProjector: () => unknown;
  getStore: () => {
    getCollapsed: (sessionId: string, turn: number) => 'collapsed' | 'expanded' | undefined;
  };
  setSession: (sessionId: string | null) => void;
  applyCollapse: (sessionId: string, turn: number, collapsed: boolean) => void;
  setCollapsed: (sessionId: string, turn: number, state: 'collapsed' | 'expanded') => void;
  getCollapsed: (sessionId: string, turn: number) => 'collapsed' | 'expanded' | undefined;
}

declare global {
  interface Window {
    __dshTurnfold?: FixtureHandle;
  }
}

export interface BootstrapOptions {
  reducedMotion?: 'reduce' | 'no-preference';
  colorScheme?: 'light' | 'dark';
}

/**
 * Load a fixture HTML page and wait until `lib/fixture.js` has booted the
 * projector (i.e. `window.__dshTurnfold` is defined). One rAF tick is
 * awaited so the projector's first reconcile has already happened before
 * the spec starts asserting.
 */
export async function bootstrapChat(
  page: Page,
  fixture: string,
  opts: BootstrapOptions = {},
): Promise<void> {
  if (opts.reducedMotion) {
    await page.emulateMedia({ reducedMotion: opts.reducedMotion });
  }
  if (opts.colorScheme) {
    await page.emulateMedia({ colorScheme: opts.colorScheme });
  }
  // Always start each spec from a clean persistence snapshot so prior runs
  // (or the spec's own `reload()`) cannot leak collapse decisions.
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('dsh.turn-collapse.v1');
      localStorage.removeItem('dsh.turn-collapse.membership.v1');
    } catch {
      // ignore (private mode etc.)
    }
  });
  await page.goto(fixture.startsWith('http') ? fixture : `http://127.0.0.1:3100/${fixture}`);
  await page.waitForFunction(() => window.__dshTurnfold !== undefined);
  // One rAF tick so the projector's first reconcile + auto-collapse replay
  // have happened before we assert.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Click the toggle button for a given turn. */
export function toggleLocator(page: Page, turn: number): Locator {
  return page.locator(`.dsh-ta-toggle[data-dsh-ta-turn="${turn}"]`);
}

/** Click the toggle and return the new `aria-expanded` value. */
export async function clickToggle(page: Page, turn: number): Promise<boolean> {
  const locator = toggleLocator(page, turn);
  const before = await locator.getAttribute('aria-expanded');
  await locator.click();
  // For prefers-reduced-motion the change is synchronous; otherwise we
  // wait for the animation to settle before reading the attribute again.
  await waitForAnimationDone(page);
  const after = await clickThenRead(page, locator, before);
  return after === 'true';
}

async function clickThenRead(page: Page, locator: Locator, before: string | null): Promise<string> {
  // The fixture's click handler flips aria-expanded in the same frame the
  // projector applies its state. Re-read after a microtask + rAF.
  await page.waitForFunction(
    (args) => {
      const el = document.querySelector(`.dsh-ta-toggle[data-dsh-ta-turn="${args.turn}"]`);
      const after = el?.getAttribute('aria-expanded') ?? null;
      return after !== null && after !== args.before;
    },
    { turn: Number(await locator.getAttribute('data-dsh-ta-turn')), before },
    { timeout: 2_000 },
  );
  return (await locator.getAttribute('aria-expanded')) ?? 'false';
}

/** Wait until the projector has no row in the `dsh-ta-animating` class. */
export async function waitForAnimationDone(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.dsh-ta-animating').length === 0,
    undefined,
    { timeout: 3_000 },
  );
}

/** Wait until the toggle's `aria-expanded` matches `expected`. */
export async function waitForToggleState(
  page: Page,
  turn: number,
  expected: 'true' | 'false',
): Promise<void> {
  await page.waitForFunction(
    (args) => {
      const el = document.querySelector(`.dsh-ta-toggle[data-dsh-ta-turn="${args.turn}"]`);
      return el?.getAttribute('aria-expanded') === args.expected;
    },
    { turn, expected },
    { timeout: 2_000 },
  );
}
