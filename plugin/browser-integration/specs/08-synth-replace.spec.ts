import { test, expect } from '@playwright/test';
import {
  bootstrapChat,
  waitForAnimationDone,
} from '../fixtures/helper.js';

/**
 * Smoke #8: a turn without an engine-published summary row gets a
 * synthetic fold bar so its activity rows stay foldable.
 *
 * `synth.ts:computeSyntheticSummaries` infers turns from assistant-step
 * row keys. The fixture `no-summary.html` renders turn 0 with no
 * `data-dsh-ta-turn` summary root, so the projector must insert a
 * synthetic bar carrying `data-dsh-ta-synth-turn="0"`.
 */
test('synthetic fold bar appears for a turn without a summary row', async ({ page }) => {
  await bootstrapChat(page, 'no-summary.html');

  // The projector should have inserted a synth bar for turn 0.
  const synthBar = page.locator('[data-dsh-ta-synth-turn="0"]');
  await expect(synthBar).toHaveCount(1);

  // Click the synthetic bar's toggle to collapse; the activity rows
  // should then be marked collapsed.
  const toggle = synthBar.locator('button, .dsh-ta-toggle').first();
  // The synth bar renders its own button class; locate by attribute.
  const synthToggle = page
    .locator('[data-dsh-ta-synth-turn="0"] [data-dsh-ta-toggle], [data-dsh-ta-synth-turn="0"] button')
    .first();
  await expect(synthToggle).toBeVisible();
  await synthToggle.click();
  await waitForAnimationDone(page);

  // Activity rows must now be marked collapsed.
  const stepCollapsed = await page
    .locator('[data-chat-anchor-key="14:assistant-step0:0"]')
    .getAttribute('data-dsh-ta-collapsed');
  expect(stepCollapsed).toBe('true');

  const toolCollapsed = await page
    .locator('[data-chat-anchor-key="9:tool-callc0"]')
    .getAttribute('data-dsh-ta-collapsed');
  expect(toolCollapsed).toBe('true');
});
