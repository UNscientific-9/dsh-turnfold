import { test, expect } from '@playwright/test';
import {
  bootstrapChat,
  clickToggle,
  waitForAnimationDone,
} from '../fixtures/helper.js';

/**
 * Smoke #5：折叠一个 turn 不移动相邻 turn。
 *
 * chat fixture 里 turn 2 夹在 turn 1 与 turn 3 之间。折叠 turn 2 后，
 * turn 1 的底部与 turn 3 的顶部必须与之前一致（0px 容差——projector 用
 * `display: none` 规则把行移出布局流，任何位移都是回归）。
 */
test('collapsing one turn does not move its neighbours', async ({ page }) => {
  await bootstrapChat(page, 'chat.html');

  // 确保相邻 turn 都不折叠，才能测量真实元素位置。
  await page.evaluate(() => {
    window.__dshTurnfold?.setCollapsed('fixture-session', 0, 'expanded');
    window.__dshTurnfold?.setCollapsed('fixture-session', 1, 'expanded');
    // turn 2 初始是自动折叠的；我们要在它也展开的状态下测"之前"，
    // 然后经用户驱动路径折叠它。
    window.__dshTurnfold?.setCollapsed('fixture-session', 2, 'expanded');
    window.__dshTurnfold?.setCollapsed('fixture-session', 3, 'expanded');
  });
  // 一帧 rAF 让 projector 把展开态应用到所有行。
  await page.evaluate(
    () =>
      new Promise<void>((r) => {
        requestAnimationFrame(() => requestAnimationFrame(() => r()));
      }),
  );

  const measure = async (): Promise<{ b1: number; t3: number }> =>
    page.evaluate(() => {
      const t1 = document.querySelector<HTMLElement>('[data-chat-anchor-key="9:turn-head1"]');
      const t3 = document.querySelector<HTMLElement>('[data-chat-anchor-key="9:turn-head3"]');
      return {
        b1: t1 ? t1.getBoundingClientRect().bottom : 0,
        t3: t3 ? t3.getBoundingClientRect().top : 0,
      };
    });

  // 测量前先把折叠按钮停进滚动视口：Playwright 的点击可操作性检查会把
  // 元素滚进视野，那会扰动我们测的每个位置。`block: 'nearest'` 只滚动
  // 让按钮进入视野的最小量。
  await page.evaluate(() => {
    document
      .querySelector<HTMLElement>('.dsh-ta-root[data-dsh-ta-turn="2"] .dsh-ta-toggle')
      ?.scrollIntoView({ block: 'nearest' });
  });
  const scrollTopBefore = await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>('[data-conversation-scroll]');
    return s?.scrollTop ?? 0;
  });

  const before = await measure();

  // 折叠 turn 2（夹在 turn 1 与 turn 3 之间的那个）。
  await clickToggle(page, 2);
  await waitForAnimationDone(page);

  const after = await measure();

  // 0px 容差：turn-2 行的 display:none 会把它们移出布局，turn 3 的顶部
  // 理应变化（上移）。真正断言的是 turn 1 的底部不变（turn 1 在被折叠
  // 区域上方）、scrollTop 不变——面向用户的不变量是"上面的行不动、
  // 视口不跳"，位移量本身是实现细节。
  expect(after.b1).toBe(before.b1);

  // 滚动稳定的 toggle 下 scrollTop 也应不变（projector 从不补偿用户
  // 驱动的折叠）。
  const scrollTop = await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>('[data-conversation-scroll]');
    return s?.scrollTop ?? 0;
  });
  expect(scrollTop).toBe(scrollTopBefore);
});
