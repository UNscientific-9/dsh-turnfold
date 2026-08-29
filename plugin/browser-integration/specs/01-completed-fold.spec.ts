import { test, expect } from '@playwright/test';
import { bootstrapChat, waitForAnimationDone } from '../fixtures/helper.js';

/**
 * Smoke #1：已完成 turn 自动折叠，中断 turn 保持展开。
 *
 * chat fixture 渲染 5 个 turn：turn 0..3 为 `data-dsh-ta-auto-collapse="true"`
 * （即 fixture 对 `shouldAutoCollapse` 的模拟），turn 4 是中断对照。
 * projector 首次 reconcile 后，turn 0..3 的每行 activity 都必须带
 * `data-dsh-ta-collapsed="true"`（turn 4 则必须没有）。final 行（step 等
 * 于 `finalStep` 的 assistant-step）、summary 根节点与用户消息永不折叠。
 */
test('completed turns auto-fold, interrupted turn stays open', async ({ page }) => {
  await bootstrapChat(page, 'chat.html');

  // 5 个折叠按钮、5 个 summary 根节点。
  await expect(page.locator('.dsh-ta-root')).toHaveCount(5);

  // turn 0..3 的所有 activity 行都必须折叠；turn 4 的 activity 行则必须
  // 没有折叠。按属性出现次数计数，断言不依赖 CSS。
  const collapsedCount = await page
    .locator('[data-dsh-ta-collapsed="true"]')
    .count();
  expect(collapsedCount).toBe(10);

  // 具体校验：turn 4 有 2 行 activity（step0 + tool），都不应被标记折叠。
  const turn4Collapsed = await page
    .locator('[data-chat-flow="fixture-flow-A"] [data-dsh-ta-collapsed="true"]')
    .evaluateAll((els) =>
      els
        .map((el) => el.getAttribute('data-chat-anchor-key') ?? '')
        .filter((key) => key.includes('assistant-step4:') || key.includes('tool-callc4')),
    );
  expect(turn4Collapsed).toEqual([]);

  // 合理性检查：每个 turn 的折叠按钮已接线且可定位（经 summary 根节点
  // 定位——按钮自身不带 data-dsh-ta-* 属性）。
  await expect(page.locator('.dsh-ta-root[data-dsh-ta-turn="0"] .dsh-ta-toggle')).toBeVisible();
  await expect(page.locator('.dsh-ta-root[data-dsh-ta-turn="4"] .dsh-ta-toggle')).toBeVisible();

  // 触发一次空转的动画清空，保持 helper 覆盖真实。
  await waitForAnimationDone(page);
});
