import { test, expect } from '@playwright/test';
import {
  bootstrapChat,
  waitForToggleState,
} from '../fixtures/helper.js';

/**
 * Smoke #13: keyboard Enter and Space on a focused toggle drive the
 * same fold/unfold path as a click. The fixture's `wireToggle` listens
 * to `keydown` for `Enter` / `' '` and routes to the same
 * `applyTurnCollapse` call as the click handler.
 */
test('Enter and Space on a focused toggle drive the fold path', async ({ page }) => {
  await bootstrapChat(page, 'chat.html');

  const toggle = page.locator('.dsh-ta-root[data-dsh-ta-turn="2"] .dsh-ta-toggle');

  // Turn 2 starts auto-collapsed (aria-expanded="false"). Pressing
  // Enter on a focused button should expand it.
  await toggle.focus();
  await page.keyboard.press('Enter');
  await waitForToggleState(page, 2, 'true');

  // Now press Space; it should collapse again.
  await toggle.focus();
  await page.keyboard.press('Space');
  await waitForToggleState(page, 2, 'false');
});
