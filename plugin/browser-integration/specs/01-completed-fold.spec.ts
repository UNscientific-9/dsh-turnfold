import { test, expect } from '@playwright/test';
import { bootstrapChat, waitForAnimationDone } from '../fixtures/helper.js';

/**
 * Smoke #1: completed turns auto-fold, the interrupted turn stays open.
 *
 * The chat fixture renders 5 turns: turns 0..3 are `data-dsh-ta-auto-collapse="true"`
 * (i.e. the fixture's `shouldAutoCollapse` analog), turn 4 is the
 * interrupted control. After the projector's first reconcile every activity
 * row in turns 0..3 must carry `data-dsh-ta-collapsed="true"` (and turn 4
 * must not). Final rows (assistant-step at `finalStep`), summary roots, and
 * user messages are never collapsed.
 */
test('completed turns auto-fold, interrupted turn stays open', async ({ page }) => {
  await bootstrapChat(page, 'chat.html');

  // 5 toggles, 5 summary roots.
  await expect(page.locator('.dsh-ta-root')).toHaveCount(5);

  // Every activity row in turns 0..3 must be collapsed; turn 4 activity
  // rows must NOT be collapsed. Counted by attribute presence to keep the
  // assertion independent of CSS.
  const collapsedCount = await page
    .locator('[data-dsh-ta-collapsed="true"]')
    .count();
  expect(collapsedCount).toBe(10);

  // Specifically: turn 4 has 2 activity rows (step0 + tool) and neither
  // should be marked collapsed.
  const turn4Collapsed = await page
    .locator('[data-chat-flow="fixture-flow-A"] [data-dsh-ta-collapsed="true"]')
    .evaluateAll((els) =>
      els
        .map((el) => el.getAttribute('data-chat-anchor-key') ?? '')
        .filter((key) => key.includes('assistant-step4:') || key.includes('tool-callc4')),
    );
  expect(turn4Collapsed).toEqual([]);

  // Sanity: the toggle for each turn is wired and reachable.
  await expect(page.locator('.dsh-ta-toggle[data-dsh-ta-turn="0"]')).toBeVisible();
  await expect(page.locator('.dsh-ta-toggle[data-dsh-ta-turn="4"]')).toBeVisible();

  // Trigger a no-op animation flush to keep helper coverage honest.
  await waitForAnimationDone(page);
});
