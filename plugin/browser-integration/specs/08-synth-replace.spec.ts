import { test, expect } from '@playwright/test';
import {
  bootstrapChat,
  waitForAnimationDone,
} from '../fixtures/helper.js';

/**
 * Smoke #8：没有引擎发布 summary 行的 turn 会得到合成折叠条，
 * 其 activity 行保持可折叠。
 *
 * `synth.ts:computeSyntheticSummaries` 从 assistant-step 行 key 推断 turn。
 * fixture `no-summary.html` 渲染 turn 0 时不带 `data-dsh-ta-turn` 的
 * summary 根节点，projector 必须插入带 `data-dsh-ta-synth-turn="0"` 的
 * 合成条。
 */
test('synthetic fold bar appears for a turn without a summary row', async ({ page }) => {
  await bootstrapChat(page, 'no-summary.html');

  // projector 应已为 turn 0 插入合成条。
  const synthBar = page.locator('[data-dsh-ta-synth-turn="0"]');
  await expect(synthBar).toHaveCount(1);

  // 点击合成条的折叠按钮折叠；activity 行随后应带折叠标记。合成条默认
  // 折叠（applyAll 中用户已批准的策略），所以先把 store 翻成 expanded——
  // 下一次 reconcile 时 syncSynthBars 会重新同步按钮的 aria-expanded——
  // 然后这次点击驱动一次真实折叠。
  await page.evaluate(() => {
    window.__dshTurnfold?.setCollapsed('fixture-session', 0, 'expanded');
  });
  await page.waitForFunction(() => {
    const btn = document.querySelector<HTMLElement>('[data-dsh-ta-synth-turn="0"] .dsh-ta-toggle');
    return btn?.getAttribute('aria-expanded') === 'true';
  });

  const synthToggle = page
    .locator('[data-dsh-ta-synth-turn="0"] button')
    .first();
  await expect(synthToggle).toBeVisible();
  await synthToggle.click();
  await waitForAnimationDone(page);

  // activity 行此时必须带折叠标记。
  const stepCollapsed = await page
    .locator('[data-chat-anchor-key="14:assistant-step0:0"]')
    .getAttribute('data-dsh-ta-collapsed');
  expect(stepCollapsed).toBe('true');

  const toolCollapsed = await page
    .locator('[data-chat-anchor-key="9:tool-callc0"]')
    .getAttribute('data-dsh-ta-collapsed');
  expect(toolCollapsed).toBe('true');
});
