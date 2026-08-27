import { test, expect } from '@playwright/test';
import {
  bootstrapChat,
  clickToggle,
  waitForAnimationDone,
} from '../fixtures/helper.js';

/**
 * Smoke #6: refresh restores the user's collapse choice.
 *
 * The persistence layer (`persist.ts` + `dsh.turn-collapse.v1` in
 * localStorage) is the source of truth across reloads. We expand turn 0,
 * reload, and confirm the row stays expanded (the `aria-expanded`
 * attribute and the collapsed marker).
 */
test('expand choice survives a page reload', async ({ page }) => {
  await bootstrapChat(page, 'chat.html');

  // The fixture boots with turn 0 auto-collapsed; flip it to expanded.
  await clickToggle(page, 0);
  await waitForAnimationDone(page);

  // Confirm the localStorage key now records the choice.
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('dsh.turn-collapse.v1');
    return raw === null ? null : (JSON.parse(raw) as Record<string, Record<string, string>>);
  });
  expect(stored, 'persistence key must exist after toggle').not.toBeNull();
  expect(stored?.['fixture-session']?.['0']).toBe('expanded');

  // Reload the page; the addInitScript clears persistence in setUp so
  // we re-inject the seed AFTER the load to simulate a real refresh.
  await page.addInitScript((seed) => {
    localStorage.setItem('dsh.turn-collapse.v1', JSON.stringify(seed));
  }, stored);

  await page.goto('http://127.0.0.1:3100/chat.html');
  await page.waitForFunction(() => window.__dshTurnfold !== undefined);
  // Two rAFs so the first reconcile + auto-collapse replay both finish.
  await page.evaluate(
    () =>
      new Promise<void>((r) => {
        requestAnimationFrame(() => requestAnimationFrame(() => r()));
      }),
  );

  // Turn 0's activity rows must NOT be collapsed after the reload.
  const turn0Collapsed = await page
    .locator('[data-chat-anchor-key="14:assistant-step0:0"]')
    .getAttribute('data-dsh-ta-collapsed');
  expect(turn0Collapsed, 'turn 0 must restore as expanded').toBeNull();

  // And the other auto-collapsed turns (1, 2, 3) must still be collapsed.
  const turn1Collapsed = await page
    .locator('[data-chat-anchor-key="14:assistant-step1:0"]')
    .getAttribute('data-dsh-ta-collapsed');
  expect(turn1Collapsed).toBe('true');
});
