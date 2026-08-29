import { test, expect } from '@playwright/test';
import { bootstrapChat, waitForAnimationDone } from '../fixtures/helper.js';

/**
 * Smoke #12：prefers-reduced-motion: reduce 时折叠同步生效，
 * 绝不进入动画类。
 *
 * `animate.ts` 的 `prefersReducedMotion` 会把 `beginAnimatedTransition`
 * 短路到无动画路径（architecture.md 决策 #6："减少动态效果时跳过
 * 动画"）。折叠标记立即写入，全程不设 `dsh-ta-animating` class。
 */
test('prefers-reduced-motion skips the animation', async ({ page }) => {
  await bootstrapChat(page, 'chat.html', { reducedMotion: 'reduce' });

  // 初始没有动画中的行。
  expect(
    await page.locator('.dsh-ta-animating').count(),
    'toggle 前不得有动画中的行',
  ).toBe(0);

  // toggle turn 1（当前自动折叠 → 展开）。
  await page.locator('.dsh-ta-root[data-dsh-ta-turn="1"] .dsh-ta-toggle').click();

  // 50ms 内标记就应已清除。动画路径需要约 220ms。
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
  expect(elapsed, `减少动态效果下的展开必须 < 50ms，实测 ${elapsed}`).toBeLessThan(50);

  // 没有任何行进入过动画类。
  expect(
    await page.locator('.dsh-ta-animating').count(),
    '减少动态效果下不得使用动画类',
  ).toBe(0);

  await waitForAnimationDone(page);
});
