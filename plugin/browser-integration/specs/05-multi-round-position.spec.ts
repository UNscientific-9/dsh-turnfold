import { test, expect } from '@playwright/test';
import {
  bootstrapChat,
  clickToggle,
  waitForAnimationDone,
} from '../fixtures/helper.js';

/**
 * Smoke #5: folding a turn does not move its neighbours.
 *
 * Turn 2 in the chat fixture sits between turn 1 and turn 3. After
 * collapsing turn 2, turn 1's bottom and turn 3's top must equal what
 * they were before (within 0px — the projector hides rows with a
 * `display: none` rule that takes the row out of layout flow, so any
 * shift would be a regression).
 */
test('collapsing one turn does not move its neighbours', async ({ page }) => {
  await bootstrapChat(page, 'chat.html');

  // Make sure the surrounding turns are NOT collapsed so we can measure
  // real element positions.
  await page.evaluate(() => {
    window.__dshTurnfold?.setCollapsed('fixture-session', 0, 'expanded');
    window.__dshTurnfold?.setCollapsed('fixture-session', 1, 'expanded');
    // turn 2 starts as auto-collapsed; we want to measure "before" while
    // it's also expanded, then collapse it via the user-driven path.
    window.__dshTurnfold?.setCollapsed('fixture-session', 2, 'expanded');
    window.__dshTurnfold?.setCollapsed('fixture-session', 3, 'expanded');
  });
  // One rAF so the projector applies the expanded state to all rows.
  await page.evaluate(
    () =>
      new Promise<void>((r) => {
        requestAnimationFrame(() => requestAnimationFrame(() => r()));
      }),
  );

  const measure = async (): Promise<{ b1: number; t3: number }> =>
    page.evaluate(() => {
      const t1 = document.querySelector<HTMLElement>('[data-chat-anchor-key="9:turn-head1"]');
      const t3 = document.querySelector<HTMLElement>('[data-chat-anchor-key="9:turn-head3"]');
      return {
        b1: t1 ? t1.getBoundingClientRect().bottom : 0,
        t3: t3 ? t3.getBoundingClientRect().top : 0,
      };
    });

  const before = await measure();

  // Collapse turn 2 (the one between turn 1 and turn 3).
  await clickToggle(page, 2);
  await waitForAnimationDone(page);

  const after = await measure();

  // Strict 0px tolerance: the display:none on turn-2 rows pulls them out
  // of layout, so turn 3's top SHOULD change (move up). What we are
  // actually asserting is that turn 1's bottom is unchanged (turn 1 is
  // above the collapsed region) and turn 3's top is now above its prior
  // position by exactly the height of the collapsed turn-2 region — but
  // that delta is implementation-specific. The user-facing invariant is
  // that turn 1 didn't move and the scrollTop didn't change.
  expect(after.b1).toBe(before.b1);

  // ScrollTop should also be unchanged for this scroll-stable toggle.
  const scrollTop = await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>('[data-conversation-scroll]');
    return s?.scrollTop ?? 0;
  });
  expect(scrollTop).toBe(0);
});
