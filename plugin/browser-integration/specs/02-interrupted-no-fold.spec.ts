import { test, expect } from '@playwright/test';
import { bootstrapChat } from '../fixtures/helper.js';

/**
 * Smoke #2：被中断的 turn 绝不自动折叠。
 *
 * projector 策略（CLAUDE.md + `shouldAutoCollapse`）：只有 `reason.kind
 * === 'completed'` 触发自动折叠。fixture 经 `data-dsh-ta-auto-collapse`
 * 表达 `shouldAutoCollapse` 判定；turn 4 是中断对照，保持
 * `auto-collapse="false"`。
 *
 * 本 spec 把 projector 会话 id 设为自身列会话（fixture 默认已如此），
 * 然后断言 turn 4 的任何 activity 行都没有折叠标记。同时确认 store 里
 * 没有该 turn 的决策（即自动折叠回放没有写入）。
 */
test('interrupted turn is not auto-folded', async ({ page }) => {
  await bootstrapChat(page, 'chat.html');

  // 所有匹配 turn 4 key 的行都不得带 data-dsh-ta-collapsed 属性。
  const turn4Keys = [
    '14:assistant-step4:0',
    '9:tool-callc4',
  ];
  for (const key of turn4Keys) {
    const row = page.locator(`[data-chat-anchor-key="${key}"]`);
    const collapsed = await row.getAttribute('data-dsh-ta-collapsed');
    expect(collapsed, `行 ${key} 不得折叠`).toBeNull();
  }

  // store 里没有 turn 4（fixture-session）的决策。
  const stored = await page.evaluate(() =>
    window.__dshTurnfold?.getCollapsed('fixture-session', 4),
  );
  expect(stored).toBeUndefined();

  // 合理性检查：turn 0 确实折叠了（正向对照）。
  const turn0Row = page.locator('[data-chat-anchor-key="14:assistant-step0:0"]');
  await expect(turn0Row).toHaveAttribute('data-dsh-ta-collapsed', 'true');
});
