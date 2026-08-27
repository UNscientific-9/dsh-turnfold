import { test, expect } from '@playwright/test';
import {
  bootstrapChat,
  clickToggle,
  waitForAnimationDone,
} from '../fixtures/helper.js';

/**
 * Smoke #3: a user-driven toggle does not move the anchor row.
 *
 * The summary row sits at the TOP of its turn; toggling must keep it put.
 * `applyTurnCollapse(..., { userDriven: true })` short-circuits the scroll
 * compensation path entirely (architecture.md decision #6 / `applyPlan`
 * lines 736-748).
 *
 * The chat fixture has 5 turns. We start with the scroll viewport at a
 * known offset, expand turn 1, and assert the user message above turn 1
 * (`turn-head1`) stays within 2px of its original viewport position.
 */
test('user-driven toggle does not jump the anchor', async ({ page }) => {
  await bootstrapChat(page, 'chat.html');

  // Park the viewport well below the top so the scroll container has room
  // to drift if the projector is buggy.
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-conversation-scroll]');
    if (scroller) scroller.scrollTop = 240;
  });

  // Measure the anchor (turn-head1) before the click.
  const before = await page.evaluate(() => {
    const anchor = document.querySelector<HTMLElement>('[data-chat-anchor-key="9:turn-head1"]');
    return anchor?.getBoundingClientRect().top ?? 0;
  });

  // Expand turn 1 (currently auto-collapsed -> click expands it).
  await clickToggle(page, 1);
  await waitForAnimationDone(page);

  const after = await page.evaluate(() => {
    const anchor = document.querySelector<HTMLElement>('[data-chat-anchor-key="9:turn-head1"]');
    return anchor?.getBoundingClientRect().top ?? 0;
  });

  // Strict 2px tolerance: the architecture promises a zero-jump toggle.
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
});
