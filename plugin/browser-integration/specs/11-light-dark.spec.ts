import { test, expect } from '@playwright/test';
import { bootstrapChat } from '../fixtures/helper.js';

/**
 * Smoke #11：projector 的折叠行为与宿主 color-scheme 无关（DSH 同时
 * 提供明暗两套主题；插件必须在两套下都正常）。
 *
 * 本测试把 5-turn 的 chat fixture 加载两次，各用一种配色。两次运行的
 * 折叠行数必须一致（turn 0..3 共 10 行；turn 4 保持展开）。
 */
test('auto-fold works in both light and dark color schemes', async ({ page }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await bootstrapChat(page, 'chat.html', { colorScheme: scheme });
    const collapsed = await page
      .locator('[data-dsh-ta-collapsed="true"]')
      .count();
    expect(collapsed, `color-scheme=${scheme} 折叠行数`).toBe(10);
  }
});
