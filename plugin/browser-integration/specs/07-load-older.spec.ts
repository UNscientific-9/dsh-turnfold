import { test, expect } from '@playwright/test';
import { bootstrapChat, waitForAnimationDone } from '../fixtures/helper.js';

/**
 * Smoke #7：membership 快照缓存让翻页加载的旧行保持可折叠。
 *
 * 真实链路（本 spec 全程走这一条，不绕行）：
 *   localStorage 快照 → readMembershipMap → hydrateMembership（生产
 *   index.ts 挂载时调用）→ row-membership 内存缓存 → mergeCached 补齐
 *   DOM 缺失的 turn → computeSyntheticSummaries 消费缓存 facts（known）
 *   → applyPlan 折叠。
 *
 * 三处断言只能在「缓存 facts 生效」时通过，合成兜底一律失败——
 * 这保证缓存链路整体回归（rememberMembership/hydrateMembership/
 * mergeCached 任一环断掉）时本 spec 必挂：
 *   1. finalStep=1（来自快照）：step3 是普通 activity 行应被折叠；
 *      合成兜底会退回 maxStep=3，step3 变成 final 行、保持可见。
 *   2. retryIds 来自快照：`real-*` 重试行应被折叠；合成兜底的
 *      retryIds 恒为空，重试行永远可见。
 *   3. toolCallIds 来自快照：DOM 上的 `dom-c*` 工具行不在快照列表
 *      里、应保持可见；合成兜底改用 DOM 扫描出的 toolIds，该行会被折叠。
 */
test('older turns stay foldable via membership snapshot', async ({ page }) => {
  await bootstrapChat(page, 'chat.html');

  // 第 1 步：直写 localStorage 快照，模拟「上一页渲染时 summary 行的
  // rememberMembership 已经落盘」。finalStep=1 刻意与 DOM 最大 step(3)
  // 不一致，见文件头断言 1。
  await page.evaluate(() => {
    const turns: Record<string, { finalStep: number; tools: string[]; retries: string[] }> = {};
    for (let t = 10; t < 15; t++) {
      turns[String(t)] = { finalStep: 1, tools: [`real-c${t}`], retries: [`real-${t}`] };
    }
    localStorage.setItem(
      'dsh.turn-collapse.membership.v1',
      JSON.stringify({ 'fixture-session': turns }),
    );
  });

  // 第 2 步：经句柄调用生产挂载路径 hydrateMembership()，把快照回灌进
  // 内存缓存（helper 每次导航都会清 localStorage，因此不能靠 reload）。
  await page.evaluate(() => {
    window.__dshTurnfold?.hydrateMembership();
    window.__dshTurnfold?.setSession('fixture-session');
  });

  // 第 3 步：注入第二列旧行（turns 10..14，无任何 summary 行）。
  // 每行 DOM 事实与快照刻意错开：工具行 id 用 dom-c*（快照记 real-c*）、
  // 重试行补一条 dom-*（不在任何 summary 里，作控制组）。
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-conversation-scroll]');
    if (!scroller) return;
    const flow = document.createElement('div');
    flow.setAttribute('data-chat-flow', 'older-flow-B');
    for (let t = 10; t < 15; t++) {
      const head = document.createElement('div');
      head.setAttribute('data-chat-anchor-key', `9:turn-head${t}`);
      head.className = 'user-msg';
      head.textContent = `older turn ${t}`;
      flow.appendChild(head);
      for (const s of [0, 1, 3]) {
        const step = document.createElement('div');
        step.setAttribute('data-chat-anchor-key', `14:assistant-step${t}:${s}`);
        step.textContent = `step ${s}`;
        flow.appendChild(step);
      }
      // 工具行：id 与快照里的 real-c* 不同（断言 3）。
      const tool = document.createElement('div');
      tool.setAttribute('data-chat-anchor-key', `9:tool-calldom-c${t}`);
      tool.className = 'tool-call';
      tool.textContent = `tool dom-c${t}`;
      flow.appendChild(tool);
      // 重试行：real-* 在快照里（断言 2），dom-* 不在（控制组）。
      for (const retryId of [`real-${t}`, `dom-${t}`]) {
        const retry = document.createElement('div');
        retry.setAttribute('data-chat-anchor-key', `11:model-retry${retryId}`);
        retry.textContent = `retry ${retryId}`;
        flow.appendChild(retry);
      }
      // turn-tail 使 turn 判定为 FINISHED（运行中的 turn 永不默认折叠）。
      const tail = document.createElement('div');
      tail.setAttribute('data-chat-anchor-key', `9:turn-tail${t}`);
      tail.className = 'turn-tail';
      flow.appendChild(tail);
    }
    scroller.appendChild(flow);
  });

  // 第 4 步：强制 reconcile 并等动画队列清空。
  await page.evaluate(() => {
    const projector = window.__dshTurnfold?.getProjector() as
      | { reconcile: () => void }
      | undefined;
    projector?.reconcile();
  });
  await waitForAnimationDone(page);

  // 第 5 步：逐 turn 断言（行 key 前缀 = kind 长度：assistant-step 14、
  // tool-call 9、model-retry 11）。
  for (let t = 10; t < 15; t++) {
    const state = async (key: string): Promise<string | null> =>
      page.locator(`[data-chat-anchor-key="${key}"]`).getAttribute('data-dsh-ta-collapsed');

    // 思考行 step0：activity 行，折叠。
    expect(await state(`14:assistant-step${t}:0`), `step0 of turn ${t} 必须折叠`).toBe('true');
    // 断言 1：step3 必须折叠——finalStep=1 来自快照；合成兜底退回
    // maxStep=3 时 step3 变 final 行、属性不存在，本断言即挂。
    expect(
      await state(`14:assistant-step${t}:3`),
      `turn ${t} 的 step3 必须折叠（finalStep=1 应来自 membership 快照）`,
    ).toBe('true');
    // 断言 2：快照里的重试行必须折叠；合成兜底 retryIds 恒空时挂。
    expect(
      await state(`11:model-retryreal-${t}`),
      `turn ${t} 的 real 重试行必须折叠（retryIds 应来自 membership 快照）`,
    ).toBe('true');
    // 断言 3：DOM 工具行不在快照 toolCallIds 里，必须保持可见；
    // 合成兜底改用 DOM 扫描的 toolIds 时该行被折叠，本断言即挂。
    expect(
      await state(`9:tool-calldom-c${t}`),
      `turn ${t} 的 dom 工具行必须保持可见（toolCallIds 应来自 membership 快照）`,
    ).toBeNull();
  }

  // 补充断言（turn 10）：step1 是快照 finalStep 指定的 final 行，永不折叠；
  // dom 重试行不在任何 summary 里，控制组保持可见。
  expect(
    await page
      .locator('[data-chat-anchor-key="14:assistant-step10:1"]')
      .getAttribute('data-dsh-ta-collapsed'),
    'step1 是 final 行（finalStep=1），必须保持可见',
  ).toBeNull();
  expect(
    await page
      .locator('[data-chat-anchor-key="11:model-retrydom-10"]')
      .getAttribute('data-dsh-ta-collapsed'),
    'dom 重试行不属于任何 summary，控制组必须保持可见',
  ).toBeNull();
});
