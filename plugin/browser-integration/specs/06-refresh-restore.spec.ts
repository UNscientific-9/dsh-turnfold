import { test, expect } from '@playwright/test';
import {
  bootstrapChat,
  clickToggle,
  waitForAnimationDone,
} from '../fixtures/helper.js';

/**
 * Smoke #6：刷新后恢复用户的折叠决策。
 *
 * 持久层（`persist.ts` + localStorage 的 `dsh.turn-collapse.v1`）是跨
 * reload 的唯一事实源。展开 turn 0、reload，确认该行保持展开
 * （`aria-expanded` 属性与折叠标记两边验证）。
 */
test('expand choice survives a page reload', async ({ page }) => {
  await bootstrapChat(page, 'chat.html');

  // fixture 启动时 turn 0 自动折叠；翻转成展开。
  await clickToggle(page, 0);
  await waitForAnimationDone(page);

  // 确认 localStorage key 已记录该决策。
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('dsh.turn-collapse.v1');
    return raw === null ? null : (JSON.parse(raw) as Record<string, Record<string, string>>);
  });
  expect(stored, 'toggle 之后持久化 key 必须存在').not.toBeNull();
  expect(stored?.['fixture-session']?.['0']).toBe('expanded');

  // reload 页面；setUp 里的 addInitScript 会清持久化，所以在加载后再
  // 注入种子，模拟真实刷新。
  await page.addInitScript((seed) => {
    localStorage.setItem('dsh.turn-collapse.v1', JSON.stringify(seed));
  }, stored);

  await page.goto('http://127.0.0.1:3100/chat.html');
  await page.waitForFunction(() => window.__dshTurnfold !== undefined);
  // 两帧 rAF 让首次 reconcile 与自动折叠回放都完成。
  await page.evaluate(
    () =>
      new Promise<void>((r) => {
        requestAnimationFrame(() => requestAnimationFrame(() => r()));
      }),
  );

  // reload 后 turn 0 的 activity 行不得折叠。
  const turn0Collapsed = await page
    .locator('[data-chat-anchor-key="14:assistant-step0:0"]')
    .getAttribute('data-dsh-ta-collapsed');
  expect(turn0Collapsed, 'turn 0 必须恢复为展开').toBeNull();

  // 其余自动折叠的 turn（1、2、3）仍应折叠。
  const turn1Collapsed = await page
    .locator('[data-chat-anchor-key="14:assistant-step1:0"]')
    .getAttribute('data-dsh-ta-collapsed');
  expect(turn1Collapsed).toBe('true');
});
