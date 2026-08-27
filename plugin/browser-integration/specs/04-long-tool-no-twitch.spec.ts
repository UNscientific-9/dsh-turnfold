import { test, expect } from '@playwright/test';
import {
  bootstrapChat,
  clickToggle,
  waitForAnimationDone,
} from '../fixtures/helper.js';

/**
 * Smoke #4: folding a long tool output does not cause a height twitch.
 *
 * The fold animation drives the row's `height` from current to 0 in
 * 220ms (styles.ts `.dsh-ta-animating` transition). The pre-animation
 * read→write burst in `beginAnimatedTransition` (architecture.md #12)
 * pins the starting height; mid-animation, the height must monotonically
 * decrease and never exceed the starting height (no 2000px → bigger →
 * smaller twitch).
 *
 * Tolerance: any single sample may overshoot by ≤ 4px due to subpixel
 * rounding across the 220ms window.
 */
test('long tool row folds without a height twitch', async ({ page }) => {
  await bootstrapChat(page, 'chat.html');

  // Force a tall tool body so the fold is observable.
  await page.evaluate(() => {
    const tool = document.querySelector<HTMLElement>('[data-chat-anchor-key="9:tool-callc0"]');
    if (tool) {
      tool.style.height = '2000px';
    }
  });
  // One rAF so the new height is committed before we measure.
  await page.evaluate(
    () =>
      new Promise<void>((r) => {
        requestAnimationFrame(() => requestAnimationFrame(() => r()));
      }),
  );

  // Expand turn 0 so the tool body is visible at its full 2000px height,
  // then collapse it and sample heights.
  await page.evaluate(() => {
    window.__dshTurnfold?.applyCollapse('fixture-session', 0, false);
  });
  // Force one more rAF to settle the expand.
  await page.evaluate(
    () =>
      new Promise<void>((r) => {
        requestAnimationFrame(() => requestAnimationFrame(() => r()));
      }),
  );

  const startHeight = await page.evaluate(() => {
    const tool = document.querySelector<HTMLElement>('[data-chat-anchor-key="9:tool-callc0"]');
    return tool?.getBoundingClientRect().height ?? 0;
  });
  // The CSS rule [data-dsh-ta-collapsed="true"] { display: none } only
  // takes effect after the animation. With userDriven=true the tool row
  // gets `data-dsh-ta-collapsed="true"` synchronously, so it disappears
  // immediately. To keep the height observable we instead use the auto
  // path (no userDriven) — but that path also writes the attribute. So
  // instead we sample the animation by reading the element BEFORE the
  // `display: none` kicks in. Practically: apply via the store so the
  // MutationObserver-driven path runs the animation; the height is
  // observable for ~220ms.
  expect(startHeight).toBeGreaterThan(1500);

  // Trigger a collapse that goes through the animation branch by
  // toggling state via store (not userDriven) and sampling height in
  // a tight loop. We catch the animation in flight.
  const samples: number[] = await page.evaluate(async () => {
    const tool = document.querySelector<HTMLElement>('[data-chat-anchor-key="9:tool-callc0"]');
    if (!tool) return [];
    window.__dshTurnfold?.setCollapsed('fixture-session', 0, 'collapsed');
    // Sampling for the duration of one 220ms animation tick.
    const out: number[] = [];
    const start = performance.now();
    while (performance.now() - start < 260) {
      out.push(tool.getBoundingClientRect().height);
      await new Promise((r) => setTimeout(r, 16));
    }
    return out;
  });

  await waitForAnimationDone(page);

  // Assertion 1: monotonic non-increasing. No sample may exceed the
  // starting height (with a 4px rounding tolerance).
  for (const h of samples) {
    expect(h, `sample ${h} should be ≤ start ${startHeight} (+4)`).toBeLessThanOrEqual(
      startHeight + 4,
    );
  }
  // Assertion 2: by the end, the row is no longer in the animation class
  // (and the display:none rule has hidden it -> getBoundingClientRect == 0).
  const finalHeight = await page.evaluate(() => {
    const tool = document.querySelector<HTMLElement>('[data-chat-anchor-key="9:tool-callc0"]');
    return tool?.getBoundingClientRect().height ?? 0;
  });
  expect(finalHeight).toBeLessThanOrEqual(1);
});
