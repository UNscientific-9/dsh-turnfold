import { test, expect } from '@playwright/test';
import {
  bootstrapChat,
  clickToggle,
  waitForAnimationDone,
} from '../fixtures/helper.js';

/**
 * Smoke #9：折叠 turn 时隐藏其 final 行内的思考块（`data-variant="think"`
 * 元素）。
 *
 * final 行本身保持可见（产品规则），但行内思考属于 activity，必须随
 * turn 一起折叠。起作用的是 `styles.ts` 里的 CSS 规则：
 *
 *   [data-dsh-ta-final-collapsed="true"] [data-variant="think"] { display: none }
 *
 * 标记由 `applyFinalThinkMarkers` 写入（每次 reconcile 都会运行）。
 */
test('final-row thinking block hides with the turn', async ({ page }) => {
  await bootstrapChat(page, 'chat.html');

  // turn 1 初始自动折叠；它的 final 行是 `14:assistant-step1:2`，
  // 内含 `data-variant="think"` 子元素。
  const finalRow = page.locator('[data-chat-anchor-key="14:assistant-step1:2"]');
  const thinkChild = finalRow.locator('[data-variant="think"]');

  // 自动折叠的 turn 也要设置 final-collapsed 标记。
  await expect(finalRow).toHaveAttribute('data-dsh-ta-final-collapsed', 'true');
  // 行内思考块被隐藏。
  const thinkBox = await thinkChild.boundingBox();
  expect(thinkBox, '思考块必须经 display:none 隐藏').toBeNull();

  // 展开 turn 1；final-collapsed 标记清除，思考块重新出现。
  await clickToggle(page, 1);
  await waitForAnimationDone(page);
  await expect(finalRow).not.toHaveAttribute('data-dsh-ta-final-collapsed', 'true');
  const thinkBoxAfter = await thinkChild.boundingBox();
  expect(thinkBoxAfter, '展开后思考块必须可见').not.toBeNull();
});
