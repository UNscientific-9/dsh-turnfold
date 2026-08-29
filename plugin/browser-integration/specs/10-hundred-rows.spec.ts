import { test, expect } from '@playwright/test';
import {
  bootstrapChat,
  clickToggle,
  waitForAnimationDone,
} from '../fixtures/helper.js';

/**
 * Smoke #10：折叠含 100 个工具调用的 turn 须在 2 秒内完成。
 *
 * 0.2.7 发布说明点名折叠响应性能（行归属索引 + 批量测量）。这是回归
 * 守护：折叠 100 行的 turn 必须在 2 秒墙钟内完成动画（不残留
 * `dsh-ta-animating` 行）。
 */
test('100-row turn folds within 2 seconds', async ({ page }) => {
  await bootstrapChat(page, 'long-conversation.html');

  // 合理性检查：fixture 确实渲染了 100 行 tool-call。
  const toolCount = await page
    .locator('[data-chat-anchor-key^="9:tool-callc"]')
    .count();
  expect(toolCount).toBe(100);

  // turn 0 初始自动折叠 → 先点击展开；顺带测展开路径的动画。
  const t0 = await page.evaluate(() => performance.now());
  await clickToggle(page, 0);
  await waitForAnimationDone(page);
  const expandMs = await page.evaluate((start) => performance.now() - start, t0);
  expect(expandMs, '展开必须在 2 秒内完成').toBeLessThan(2000);

  // 再折叠；这是本 spec 得名的"折叠"路径。
  const t1 = await page.evaluate(() => performance.now());
  await clickToggle(page, 0);
  await waitForAnimationDone(page);
  const collapseMs = await page.evaluate((start) => performance.now() - start, t1);
  expect(collapseMs, '折叠必须在 2 秒内完成').toBeLessThan(2000);
});
