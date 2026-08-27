import { test, expect } from '@playwright/test';
import { bootstrapChat } from '../fixtures/helper.js';

/**
 * Smoke #2: an interrupted turn MUST NOT auto-fold.
 *
 * Projector policy (CLAUDE.md + `shouldAutoCollapse`): only `reason.kind
 * === 'completed'` triggers auto-collapse. The fixture expresses
 * `shouldAutoCollapse` verdicts via `data-dsh-ta-auto-collapse`; turn 4 is
 * the interrupted control and stays `auto-collapse="false"`.
 *
 * This spec sets the projector's session id to its own column session
 * (the default fixture already does this), then asserts that NO activity
 * row belonging to turn 4 has the collapsed marker. We also confirm the
 * store has no decision for that turn (i.e. the auto-collapse replay did
 * not write one).
 */
test('interrupted turn is not auto-folded', async ({ page }) => {
  await bootstrapChat(page, 'chat.html');

  // No data-dsh-ta-collapsed attribute on anything matching turn 4 keys.
  const turn4Keys = [
    '14:assistant-step4:0',
    '9:tool-callc4',
  ];
  for (const key of turn4Keys) {
    const row = page.locator(`[data-chat-anchor-key="${key}"]`);
    const collapsed = await row.getAttribute('data-dsh-ta-collapsed');
    expect(collapsed, `row ${key} must not be collapsed`).toBeNull();
  }

  // The store has no decision for turn 4 (fixture-session).
  const stored = await page.evaluate(() =>
    window.__dshTurnfold?.getCollapsed('fixture-session', 4),
  );
  expect(stored).toBeUndefined();

  // Sanity: turn 0 IS collapsed (positive control).
  const turn0Row = page.locator('[data-chat-anchor-key="14:assistant-step0:0"]');
  await expect(turn0Row).toHaveAttribute('data-dsh-ta-collapsed', 'true');
});
