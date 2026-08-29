import { test, expect } from '@playwright/test';
import {
  bootstrapChat,
  clickToggle,
  waitForAnimationDone,
} from '../fixtures/helper.js';

/**
 * Smoke #3：用户驱动的 toggle 不移动锚点行。
 *
 * summary 行位于 turn 顶部；toggle 必须让它原地不动。
 * `applyTurnCollapse(..., { userDriven: true })` 完全短路滚动补偿路径
 * （architecture.md 决策 #6）。
 *
 * chat fixture 有 5 个 turn。先把滚动视口停在一个已知偏移，展开 turn 1，
 * 断言 turn 1 上方的用户消息（`turn-head1`）与原视口位置偏差 ≤ 2px。
 */
test('user-driven toggle does not jump the anchor', async ({ page }) => {
  await bootstrapChat(page, 'chat.html');

  // 把视口停在离顶部较远处，这样即使 projector 有 bug、滚动容器有漂移
  // 也有可观测空间。
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-conversation-scroll]');
    if (scroller) scroller.scrollTop = 240;
  });

  // 点击前测锚点（turn-head1）。
  const before = await page.evaluate(() => {
    const anchor = document.querySelector<HTMLElement>('[data-chat-anchor-key="9:turn-head1"]');
    return anchor?.getBoundingClientRect().top ?? 0;
  });

  // 展开 turn 1（当前自动折叠 → 点击即展开）。
  await clickToggle(page, 1);
  await waitForAnimationDone(page);

  const after = await page.evaluate(() => {
    const anchor = document.querySelector<HTMLElement>('[data-chat-anchor-key="9:turn-head1"]');
    return anchor?.getBoundingClientRect().top ?? 0;
  });

  // 严格 2px 容差：架构承诺 toggle 零跳动。
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
});
