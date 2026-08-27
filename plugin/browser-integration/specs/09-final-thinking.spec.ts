import { test, expect } from '@playwright/test';
import {
  bootstrapChat,
  clickToggle,
  waitForAnimationDone,
} from '../fixtures/helper.js';

/**
 * Smoke #9: collapsing a turn hides the thinking block inside its
 * final-answer row (the `data-variant="think"` element).
 *
 * The final row itself stays visible (product rule), but its inner
 * thinking is activity and must fold with the turn. The CSS rule
 *
 *   [data-dsh-ta-final-collapsed="true"] [data-variant="think"] { display: none }
 *
 * in `styles.ts` is what makes this work. The marker is written by
 * `applyFinalThinkMarkers` (projector.ts:374-387), which runs on every
 * reconcile.
 */
test('final-row thinking block hides with the turn', async ({ page }) => {
  await bootstrapChat(page, 'chat.html');

  // Turn 1 starts auto-collapsed; its final step is `14:assistant-step1:2`
  // which contains a `data-variant="think"` child.
  const finalRow = page.locator('[data-chat-anchor-key="14:assistant-step1:2"]');
  const thinkChild = finalRow.locator('[data-variant="think"]');

  // The final-collapsed marker is set even on the auto-collapsed turn.
  await expect(finalRow).toHaveAttribute('data-dsh-ta-final-collapsed', 'true');
  // And the inner think block is hidden.
  const thinkBox = await thinkChild.boundingBox();
  expect(thinkBox, 'think block must be hidden via display:none').toBeNull();

  // Expand turn 1; the final-collapsed marker is cleared, the think
  // block reappears.
  await clickToggle(page, 1);
  await waitForAnimationDone(page);
  await expect(finalRow).not.toHaveAttribute('data-dsh-ta-final-collapsed', 'true');
  const thinkBoxAfter = await thinkChild.boundingBox();
  expect(thinkBoxAfter, 'think block must be visible after expand').not.toBeNull();
});
