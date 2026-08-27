import { test, expect } from '@playwright/test';
import { bootstrapChat, waitForAnimationDone } from '../fixtures/helper.js';

/**
 * Smoke #12: with prefers-reduced-motion: reduce, a fold applies
 * synchronously and never enters the animation class.
 *
 * `prefersReducedMotion` in `animate.ts` short-circuits
 * `beginAnimatedTransition` to the no-animation path
 * (architecture.md decision #6: "prefers-reduced-motion skips
 * animation"). The collapsed marker is written immediately and no
 * `dsh-ta-animating` class is ever set.
 */
test('prefers-reduced-motion skips the animation', async ({ page }) => {
  await bootstrapChat(page, 'chat.html', { reducedMotion: 'reduce' });

  // Initially no animating rows.
  expect(
    await page.locator('.dsh-ta-animating').count(),
    'no animating rows before toggle',
  ).toBe(0);

  // Toggle turn 1 (currently auto-collapsed -> expanding).
  await page.locator('.dsh-ta-root[data-dsh-ta-turn="1"] .dsh-ta-toggle').click();

  // Within 50ms, the marker should already be cleared. The animation
  // path would take ~220ms.
  const t0 = await page.evaluate(() => performance.now());
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-chat-anchor-key="14:assistant-step1:0"]')
        ?.getAttribute('data-dsh-ta-collapsed') === null,
    undefined,
    { timeout: 100 },
  );
  const elapsed = await page.evaluate((start) => performance.now() - start, t0);
  expect(elapsed, `reduced-motion expand must be < 50ms, was ${elapsed}`).toBeLessThan(50);

  // No row ever entered the animating class.
  expect(
    await page.locator('.dsh-ta-animating').count(),
    'reduced-motion must not use the animation class',
  ).toBe(0);

  await waitForAnimationDone(page);
});
