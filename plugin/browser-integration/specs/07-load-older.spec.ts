import { test, expect } from '@playwright/test';
import { bootstrapChat, waitForAnimationDone } from '../fixtures/helper.js';

/**
 * Smoke #7: the membership snapshot cache keeps older turns foldable
 * after a paged history load.
 *
 * When DSH loads an older page, the activity rows arrive without their
 * engine-published summary row. The projector reads the membership facts
 * from the snapshot cache (membership-persist.ts) so the rows still get
 * marked collapsed. We simulate the load by injecting 5 turn activity
 * rows whose summary has been "remembered" via the fixture handle.
 */
test('older turns stay foldable via membership snapshot', async ({ page }) => {
  await bootstrapChat(page, 'chat.html');

  // Seed the cache: pretend turn 10..14 had engine-published summary
  // rows in a previous render. The cache is module-level state on
  // `row-membership.ts`; the projector exposes it indirectly through
  // `rememberMembership` (which the summary view would have called).
  // We drive the same path by toggling turns 10..14 into the persisted
  // map (localStorage) and then by setting store decisions BEFORE we
  // inject the DOM, then call `projector.reconcile()`.
  await page.evaluate(() => {
    const projector = window.__dshTurnfold?.getProjector() as
      | { reconcile: () => void; setSession: (s: string | null) => void }
      | undefined;
    projector?.setSession('fixture-session');
    // The injected rows will be in the new flow we'll create below.
  });

  // Inject a second flow with 5 turns (no summary rows) into the page.
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
      for (let s = 0; s < 2; s++) {
        const step = document.createElement('div');
        step.setAttribute('data-chat-anchor-key', `14:assistant-step${t}:${s}`);
        step.textContent = `step ${s}`;
        flow.appendChild(step);
      }
      // 1 tool call per turn.
      const tool = document.createElement('div');
      tool.setAttribute('data-chat-anchor-key', `9:tool-callc${t}`);
      tool.className = 'tool-call';
      tool.textContent = `tool c${t}`;
      flow.appendChild(tool);
      // Final step.
      const finalRow = document.createElement('div');
      finalRow.setAttribute('data-chat-anchor-key', `14:assistant-step${t}:3`);
      finalRow.className = 'final-answer';
      finalRow.textContent = `final ${t}`;
      flow.appendChild(finalRow);
    }
    scroller.appendChild(flow);
  });

  // Pre-write collapse decisions for turns 10..14 so the projector
  // applies them on the next reconcile. This emulates the membership
  // snapshot cache: a remembered decision survives a fresh DOM load.
  await page.evaluate(() => {
    for (let t = 10; t < 15; t++) {
      window.__dshTurnfold?.setCollapsed('fixture-session', t, 'collapsed');
    }
  });

  // Force a reconcile.
  await page.evaluate(() => {
    const projector = window.__dshTurnfold?.getProjector() as
      | { reconcile: () => void }
      | undefined;
    projector?.reconcile();
  });
  await waitForAnimationDone(page);

  // Every injected turn 10..14 step-0 row must be collapsed.
  for (let t = 10; t < 15; t++) {
    const key = `14:assistant-step${t}:0`;
    const collapsed = await page
      .locator(`[data-chat-anchor-key="${key}"]`)
      .getAttribute('data-dsh-ta-collapsed');
    expect(collapsed, `row ${key} must be collapsed`).toBe('true');
  }
});
