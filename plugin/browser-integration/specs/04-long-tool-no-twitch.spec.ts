import { test, expect } from '@playwright/test';
import {
  bootstrapChat,
  waitForAnimationDone,
} from '../fixtures/helper.js';

/**
 * Smoke #4：折叠长工具输出不得产生高度抖动（twitch）。
 *
 * 折叠动画由 `beginAnimatedTransition` 驱动：同一任务内「测起始高 →
 * 写起始态 → 强制 reflow → 写目标态」，随后 220ms CSS transition 把行高
 * 从当前值渐变到 0（styles.ts `.dsh-ta-animating`）。起始高被钉住后，
 * 动画期间高度必须单调不增、且永不超出起始高（不允许 2000px → 更高 →
 * 更小的抖动）。
 *
 * 本 spec 只走真实动画路径：fixture 句柄 `applyCollapse` 内部固定
 * `userDriven: true`，落到 apply-plan.ts 的动画分支。背景 reconcile
 * （store→rAF→applyPlan(focus=null)）没有动画、瞬时 display:none——
 * 对那条路径采样高度只会得到恒真断言，禁止回头。
 *
 * 容差：220ms 窗口内子像素舍入允许单个样本超出 ≤ 4px。
 */
test('long tool row folds without a height twitch', async ({ page }) => {
  await bootstrapChat(page, 'chat.html');

  // 先展开 turn 0（userDriven 动画），等动画完全结束再撑高——动画
  // finish 会清空行上的内联样式（height/margin/opacity，清痕迹是动画
  // 的正常行为），若先撑高再展开，2000px 夹具会被 finish 一并清掉。
  await page.evaluate(() => {
    window.__dshTurnfold?.applyCollapse('fixture-session', 0, false);
  });
  await waitForAnimationDone(page);

  // 展开完成后把工具行撑高到 2000px，让折叠量可观测。
  await page.evaluate(() => {
    const tool = document.querySelector<HTMLElement>('[data-chat-anchor-key="9:tool-callc0"]');
    if (tool) {
      tool.style.height = '2000px';
    }
  });
  // 一帧 rAF 让新高度先提交再测量。
  await page.evaluate(
    () =>
      new Promise<void>((r) => {
        requestAnimationFrame(() => requestAnimationFrame(() => r()));
      }),
  );

  const startHeight = await page.evaluate(() => {
    const tool = document.querySelector<HTMLElement>('[data-chat-anchor-key="9:tool-callc0"]');
    return tool?.getBoundingClientRect().height ?? 0;
  });
  expect(startHeight).toBeGreaterThan(1500);

  // 触发 userDriven 折叠（真实动画路径）并在页面内紧密采样。
  // beginAnimatedTransition 在同一任务里同步写完起始态与目标态，之后
  // 220ms 渐变——采样循环必然落进动画进行中的窗口。
  const samples: number[] = await page.evaluate(async () => {
    const tool = document.querySelector<HTMLElement>('[data-chat-anchor-key="9:tool-callc0"]');
    if (!tool) return [];
    window.__dshTurnfold?.applyCollapse('fixture-session', 0, true);
    // 采样略长于一个 220ms 动画窗，确保覆盖到终态。
    const out: number[] = [];
    const start = performance.now();
    while (performance.now() - start < 300) {
      out.push(tool.getBoundingClientRect().height);
      await new Promise((r) => setTimeout(r, 16));
    }
    return out;
  });

  await waitForAnimationDone(page);

  // 断言 1（动画真实发生）：必须存在渐变中间态样本（0 < h < 起始高-50）。
  // 若折叠被瞬时路径执行（如背景 reconcile），样本只会从起始高直接跳到 0，
  // 本断言即挂——这是对「走了 220ms 动画」的定向守护。
  const midFlight = samples.filter((h) => h > 1 && h < startHeight - 50);
  expect(
    midFlight.length,
    `必须采样到动画中间态（样本：${samples.map((h) => Math.round(h)).join(', ')}）`,
  ).toBeGreaterThan(0);

  // 断言 2：单调不增。任何样本不得超出起始高（+4px 舍入容差）。
  for (const h of samples) {
    expect(h, `样本 ${h} 应 ≤ 起始高 ${startHeight} (+4)`).toBeLessThanOrEqual(
      startHeight + 4,
    );
  }

  // 断言 3：终态行已脱离动画类，display:none 生效（rect 高度为 0）。
  const finalHeight = await page.evaluate(() => {
    const tool = document.querySelector<HTMLElement>('[data-chat-anchor-key="9:tool-callc0"]');
    return tool?.getBoundingClientRect().height ?? 0;
  });
  expect(finalHeight).toBeLessThanOrEqual(1);
});
