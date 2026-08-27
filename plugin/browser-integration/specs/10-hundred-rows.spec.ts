import { test, expect } from '@playwright/test';
import {
  bootstrapChat,
  clickToggle,
  waitForAnimationDone,
} from '../fixtures/helper.js';

/**
 * Smoke #10: folding a turn with 100 tool calls completes within 2s.
 *
 * The 0.2.7 release notes call out fold-response performance
 * (row-attribution index + batched measurement). This is the regression
 * guard: collapsing a 100-row turn must finish the animation (no
 * `dsh-ta-animating` rows left) within 2 seconds wall-clock.
 */
test('100-row turn folds within 2 seconds', async ({ page }) => {
  await bootstrapChat(page, 'long-conversation.html');

  // Sanity: the fixture really did render 100 tool-call rows.
  const toolCount = await page
    .locator('[data-chat-anchor-key^="9:tool-callc"]')
    .count();
  expect(toolCount).toBe(100);

  // Turn 0 starts auto-collapsed -> click to EXPAND first; this also
  // measures the expand path's animation.
  const t0 = await page.evaluate(() => performance.now());
  await clickToggle(page, 0);
  await waitForAnimationDone(page);
  const expandMs = await page.evaluate((start) => performance.now() - start, t0);
  expect(expandMs, 'expand must finish under 2s').toBeLessThan(2000);

  // Now collapse again; this is the "fold" path the spec is named for.
  const t1 = await page.evaluate(() => performance.now());
  await clickToggle(page, 0);
  await waitForAnimationDone(page);
  const collapseMs = await page.evaluate((start) => performance.now() - start, t1);
  expect(collapseMs, 'collapse must finish under 2s').toBeLessThan(2000);
});
