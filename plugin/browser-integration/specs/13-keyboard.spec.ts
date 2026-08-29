import { test, expect } from '@playwright/test';
import {
  bootstrapChat,
  waitForToggleState,
} from '../fixtures/helper.js';

/**
 * Smoke #13：聚焦折叠按钮后按 Enter 与 Space，走与点击相同的折叠/
 * 展开路径。fixture 的 `wireToggle` 监听 `Enter` / `' '` 的 `keydown`，
 * 路由到与点击处理器相同的 `applyTurnCollapse` 调用。
 */
test('Enter and Space on a focused toggle drive the fold path', async ({ page }) => {
  await bootstrapChat(page, 'chat.html');

  const toggle = page.locator('.dsh-ta-root[data-dsh-ta-turn="2"] .dsh-ta-toggle');

  // turn 2 初始自动折叠（aria-expanded="false"）。聚焦按钮按 Enter
  // 应展开它。
  await toggle.focus();
  await page.keyboard.press('Enter');
  await waitForToggleState(page, 2, 'true');

  // 再按 Space；应重新折叠。
  await toggle.focus();
  await page.keyboard.press('Space');
  await waitForToggleState(page, 2, 'false');
});
