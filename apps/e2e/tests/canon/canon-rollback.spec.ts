import { expect, test } from '@playwright/test';

import { insertRow, readRows, serviceRoleAuth } from '../utils/seed';
import { byTest } from '../utils/visible';
import { type CanonFixture, openStoryCanon, seedCanon } from './canon-fixture';

/**
 * FILM-1005: a character's state history in the canon panel carries a
 * Rollback on the newest change. Character states are append-only, so the
 * rollback appends a state restoring the earlier one; it does not delete.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const evidence = Boolean(process.env.CAPTURE_EVIDENCE);

let canon: CanonFixture;
let stale: CanonFixture;

test.beforeAll(async () => {
  canon = await seedCanon('canon-rollback');
  stale = await seedCanon('canon-rollback-stale');
});

test.describe('Canon rollback (FILM-1005)', () => {
  test.describe.configure({ mode: 'serial' });

  test('a change is rolled back after confirming, and the history shows it', async ({
    page,
  }) => {
    await openStoryCanon(page, canon);
    await byTest(page, 'canon-characters-tab').click();

    await byTest(page, 'canon-character-state-edit').first().click();
    await byTest(page, 'canon-character-state-value').fill('grieving');
    await byTest(page, 'canon-character-state-trigger').fill('Ilya is found');
    await byTest(page, 'canon-character-state-submit').click();
    await expect(
      page.getByText('Character state recorded').first(),
    ).toBeVisible();

    await byTest(page, 'canon-character-history-toggle').click();
    await expect(byTest(page, 'canon-character-delta')).toHaveCount(1);

    if (evidence) {
      await page.screenshot({
        path: `${OUT}/rollback-01-history.png`,
        animations: 'disabled',
      });
    }

    // Cancelling changes nothing.
    await byTest(page, 'canon-character-rollback').click();

    if (evidence) {
      await expect(
        byTest(page, 'canon-character-rollback-confirm'),
      ).toBeVisible();
      await page.screenshot({
        path: `${OUT}/rollback-02-confirm.png`,
        animations: 'disabled',
      });
    }

    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(await characterStates()).toEqual(['calm', 'grieving']);

    await byTest(page, 'canon-character-rollback').click();
    await byTest(page, 'canon-character-rollback-confirm').click();

    await expect(
      page.getByText('Character state rolled back').first(),
    ).toBeVisible();

    // Appended, not deleted: the grieving state stays in the record.
    expect(await characterStates()).toEqual(['calm', 'grieving', 'calm']);

    // The state after the action: the history lists the rollback too, and
    // offers to roll that back in turn.
    await expect(byTest(page, 'canon-character-delta')).toHaveCount(2);
    await expect(byTest(page, 'canon-character-delta').first()).toContainText(
      'Rollback of state change',
    );
    await expect(byTest(page, 'canon-character-rollback')).toHaveCount(1);

    if (evidence) {
      await page.screenshot({
        path: `${OUT}/rollback-03-after.png`,
        animations: 'disabled',
      });
    }
  });

  test('a change already followed by another is refused, in words', async ({
    page,
  }) => {
    await openStoryCanon(page, stale);
    await byTest(page, 'canon-characters-tab').click();

    await byTest(page, 'canon-character-state-edit').first().click();
    await byTest(page, 'canon-character-state-value').fill('grieving');
    await byTest(page, 'canon-character-state-trigger').fill('Ilya is found');
    await byTest(page, 'canon-character-state-submit').click();
    await expect(
      page.getByText('Character state recorded').first(),
    ).toBeVisible();

    await byTest(page, 'canon-character-history-toggle').click();
    await expect(byTest(page, 'canon-character-delta')).toHaveCount(1);

    await insertRow(
      'character_states',
      {
        character_id: stale.characterId,
        episode_id: stale.episodeId,
        state_type: 'emotional',
        state_value: { state: 'resolute' },
        trigger_event: 'recorded elsewhere',
        created_by: stale.team.userId,
      },
      serviceRoleAuth(),
    );

    await byTest(page, 'canon-character-rollback').click();
    await byTest(page, 'canon-character-rollback-confirm').click();

    await expect(byTest(page, 'canon-character-rollback-error')).toContainText(
      'Roll back the later change first',
    );
    expect(await characterStates(stale)).toEqual([
      'calm',
      'grieving',
      'resolute',
    ]);

    if (evidence) {
      await page.screenshot({
        path: `${OUT}/rollback-04-refused.png`,
        animations: 'disabled',
      });
    }
  });
});

async function characterStates(fixture: CanonFixture = canon) {
  const rows = await readRows<{ state_value: { state: string } }>(
    'character_states',
    `character_id=eq.${fixture.characterId}&select=state_value&order=created_at`,
  );
  return rows.map((row) => row.state_value.state);
}
