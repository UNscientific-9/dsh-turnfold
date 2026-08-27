import { test, expect } from '@playwright/test';
import { bootstrapChat } from '../fixtures/helper.js';

/**
 * Smoke #11: the projector's fold behaviour is independent of the
 * host's color-scheme (DSH ships light + dark themes; the plugin must
 * work in both).
 *
 * The 5-turn chat fixture is loaded twice in this test, once in each
 * color scheme. The collapsed-row count must be identical between the
 * two runs (10 rows in turns 0..3; turn 4 stays open).
 */
test('auto-fold works in both light and dark color schemes', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await bootstrapChat(page, 'chat.html', { colorScheme: scheme });
    const collapsed = await page
      .locator('[data-dsh-ta-collapsed="true"]')
      .count();
    expect(collapsed, `color-scheme=${scheme} collapsed count`).toBe(10);
  }
});
