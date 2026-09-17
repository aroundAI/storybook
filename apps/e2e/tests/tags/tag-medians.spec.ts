import { expect, test } from '@playwright/test';

import { seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * Tag medians on the tags page (FILM-1611).
 *
 * The card was exported and rendered nowhere. ClickHouse is off in e2e, so
 * it shows its gate or empty state; what a browser can prove is that the
 * switcher changes which kind of segment the card describes, and changes it
 * back — the second switch is where a stale-state bug would show.
 */
test.describe('Tag medians', () => {
  test('switches between tag dimensions and Language, and back', async ({
    page,
  }) => {
    const team = await seedTeamAccount();

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/analytics/tags`);

    const card = page.locator('[data-test="tag-medians-card"]:visible');
    const trigger = card.locator('[data-test="tag-medians-dimension-trigger"]');

    await expect(trigger).toHaveText('Topic');

    // A new account has no tagged videos, so a tag dimension shows the gate.
    await expect(card).toContainText('Tag-level medians unlock once');

    await trigger.click();
    await page.locator('[data-test="tag-medians-dimension-language"]').click();

    await expect(trigger).toHaveText('Language');

    // Language is not a tag, and has no tagging gate: the card must not
    // describe it as one.
    await expect(card.locator('[data-test="tag-medians-empty"]')).toHaveText(
      'No language has enough videos yet for a reliable median.',
    );
    await expect(card).not.toContainText('Tag-level medians unlock once');

    await trigger.click();
    await page.locator('[data-test="tag-medians-dimension-format"]').click();

    await expect(trigger).toHaveText('Format');
    await expect(card).toContainText('Tag-level medians unlock once');
    await expect(card.locator('[data-test="tag-medians-empty"]')).toHaveCount(
      0,
    );
  });
});
