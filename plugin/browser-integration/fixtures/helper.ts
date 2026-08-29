import type { Page, Locator } from '@playwright/test';

/** `lib/fixture.js` 挂在 `window` 上的句柄的最小形状。 */
export interface FixtureHandle {
  getProjector: () => unknown;
  getStore: () => {
    getCollapsed: (sessionId: string, turn: number) => 'collapsed' | 'expanded' | undefined;
  };
  setSession: (sessionId: string | null) => void;
  applyCollapse: (sessionId: string, turn: number, collapsed: boolean) => void;
  setCollapsed: (sessionId: string, turn: number, state: 'collapsed' | 'expanded') => void;
  getCollapsed: (sessionId: string, turn: number) => 'collapsed' | 'expanded' | undefined;
  /** 与生产 summary-view.tsx 渲染时同一入口：记录一条成员事实快照。 */
  rememberMembership: (
    sessionId: string,
    ref: {
      turn: number;
      finalStep?: number;
      toolCallIds: readonly string[];
      retryIds: readonly string[];
      sessionId: string;
    },
  ) => void;
  /** 与生产 index.ts 挂载时同一入口：从 localStorage 回灌快照缓存。 */
  hydrateMembership: () => void;
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
 * 加载 fixture HTML 页并等待 `lib/fixture.js` 启动完 projector
 * （即 `window.__dshTurnfold` 已定义）。等待一个 rAF tick，
 * 保证 projector 的首次 reconcile 在 spec 开始断言前已经发生。
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
  // 每次 spec 都从干净的持久化快照开始，避免此前运行（或 spec 自己的
  // `reload()`）泄漏折叠决策。
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
  // 等一帧 rAF，让 projector 的首次 reconcile 与自动折叠回放都在
  // 断言前完成。
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** 点击指定 turn 的折叠按钮。按钮自身不带 data-dsh-ta-* 属性
 *  （与 summary-view.tsx 一致）；经 summary 根节点的 data-dsh-ta-turn 定位。 */
export function toggleLocator(page: Page, turn: number): Locator {
  return page.locator(`.dsh-ta-root[data-dsh-ta-turn="${turn}"] .dsh-ta-toggle`);
}

/** 点击折叠按钮并返回新的 `aria-expanded` 值。 */
export async function clickToggle(page: Page, turn: number): Promise<boolean> {
  const locator = toggleLocator(page, turn);
  const before = await locator.getAttribute('aria-expanded');
  await locator.click();
  // prefers-reduced-motion 下变化是同步的；否则等动画落定再读属性。
  await waitForAnimationDone(page);
  const after = await clickThenRead(page, turn, before);
  return after === 'true';
}

async function clickThenRead(page: Page, turn: number, before: string | null): Promise<string> {
  // fixture 的点击处理器与 projector 应用状态同帧翻转 aria-expanded。
  // 等一个微任务 + rAF 后重读。
  await page.waitForFunction(
    (args) => {
      const el = document.querySelector(`.dsh-ta-root[data-dsh-ta-turn="${args.turn}"] .dsh-ta-toggle`);
      const after = el?.getAttribute('aria-expanded') ?? null;
      return after !== null && after !== args.before;
    },
    { turn, before },
    { timeout: 2_000 },
  );
  return (
    (await page
      .locator(`.dsh-ta-root[data-dsh-ta-turn="${turn}"] .dsh-ta-toggle`)
      .getAttribute('aria-expanded')) ?? 'false'
  );
}

/** 等到 projector 中不再有带 `dsh-ta-animating` class 的行。 */
export async function waitForAnimationDone(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('.dsh-ta-animating').length === 0,
    undefined,
    { timeout: 3_000 },
  );
}

/** 等到折叠按钮的 `aria-expanded` 等于 `expected`。 */
export async function waitForToggleState(
  page: Page,
  turn: number,
  expected: 'true' | 'false',
): Promise<void> {
  await page.waitForFunction(
    (args) => {
      const el = document.querySelector(`.dsh-ta-root[data-dsh-ta-turn="${args.turn}"] .dsh-ta-toggle`);
      return el?.getAttribute('aria-expanded') === args.expected;
    },
    { turn, expected },
    { timeout: 2_000 },
  );
}
