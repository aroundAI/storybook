import { expect, test } from '@playwright/test';

import { PRODUCTION_SENTENCE } from '../refusals/refusals.po';
import { updateRows } from '../utils/seed';
import { FactsPageObject } from './facts.po';

/**
 * KB-18: verifying and disputing a fact, driven through the Fact Library.
 *
 * Before the fix every review was refused by the table's UPDATE policy, for
 * everyone including the project's owner, and the page said "Failed to verify
 * fact" while the dialog closed and dropped the notes. The rules themselves
 * are tested with real roles in verified-facts-review.test.sql; this is the
 * flow a person follows, and what they read when it is refused.
 *
 * The refusal wording only means something on a production build (⚫️ Test):
 * a dev server passes a thrown message through, so the KB-6 half of the
 * stale-review test cannot fail there.
 */
test.describe('Fact Library — verify and dispute', () => {
  test('the owner verifies one fact, then disputes another, and both persist', async ({
    page,
  }) => {
    const facts = new FactsPageObject(page);
    const {
      team,
      project,
      facts: [a, b],
    } = await facts.seedProjectWithFacts(2);

    await facts.signIn(team);
    await facts.goto(team, project);

    await expect(facts.status(a!)).toHaveText('Unverified');

    // First action: verify A with a note.
    await facts.openReview(a!);
    await facts.notes().fill('Checked against the 1851 harbour board minutes');
    await facts.confirmVerified();

    await expect(facts.successToast('Fact verified')).toBeVisible();
    await expect(facts.dialog()).toBeHidden();
    await expect(facts.status(a!)).toHaveText('Verified');
    await expect(facts.verifyButton(a!)).toHaveCount(0);

    // Second action, same page, no reload: the dialog opens for B, empty —
    // not carrying A's note — and the dispute lands on B alone.
    await facts.openReview(b!);
    await expect(facts.notes()).toHaveValue('');
    await facts.notes().fill('The minutes give 1852, not 1842');
    await facts.markDisputed();

    await expect(facts.successToast('Fact marked as disputed')).toBeVisible();
    await expect(facts.dialog()).toBeHidden();
    await expect(facts.status(b!)).toHaveText('Disputed');
    await expect(facts.status(a!)).toHaveText('Verified');

    // Persisted: a reload reads the stored state.
    await page.reload();
    await expect(facts.status(a!)).toHaveText('Verified');
    await expect(facts.status(b!)).toHaveText('Disputed');

    // And it says who verified it.
    const ownerName = team.email.split('@')[0]!;

    await facts.openDetails(a!);
    await expect(facts.verifiedBy()).toContainText(`Verified by ${ownerName}`);

    const rows = await facts.readFacts([a!, b!]);

    expect(rows.get(a!.id)).toMatchObject({
      verification_status: 'verified',
      verified_by: team.userId,
      verified_by_name: ownerName,
      verification_notes: 'Checked against the 1851 harbour board minutes',
    });
    expect(rows.get(b!.id)).toMatchObject({
      verification_status: 'disputed',
      verified_by: null,
      verified_by_name: null,
      verification_notes: 'The minutes give 1852, not 1842',
    });
  });

  test('a fact disputed in another tab is not verified over, and the note is kept', async ({
    page,
  }) => {
    const facts = new FactsPageObject(page);
    const {
      team,
      project,
      facts: [c],
    } = await facts.seedProjectWithFacts(1);

    await facts.signIn(team);
    await facts.goto(team, project);

    await facts.openReview(c!);
    await facts.notes().fill('Looks right to me');

    // Someone else settles it first.
    await updateRows('verified_facts', `id=eq.${c!.id}`, {
      verification_status: 'disputed',
      verification_notes: 'Disputed by a colleague',
    });

    await facts.confirmVerified();

    const toast = facts.errorToast();

    await expect(toast).toContainText(
      'This fact is already disputed. Reload the page to see its current state.',
    );
    await expect(toast).not.toContainText(PRODUCTION_SENTENCE);

    // The dialog stays open with what the user typed.
    await expect(facts.dialog()).toBeVisible();
    await expect(facts.notes()).toHaveValue('Looks right to me');

    const rows = await facts.readFacts([c!]);

    expect(rows.get(c!.id)).toMatchObject({
      verification_status: 'disputed',
      verified_by: null,
      verification_notes: 'Disputed by a colleague',
    });
  });

  test('a project member is not offered Verify or Delete', async ({ page }) => {
    const facts = new FactsPageObject(page);
    const {
      team,
      project,
      facts: [d],
    } = await facts.seedProjectWithFacts(1);
    const member = await facts.seedProjectMember(team, project);

    await facts.signIn(member);
    await facts.goto(team, project);

    await expect(facts.status(d!)).toHaveText('Unverified');
    await expect(facts.verifyButton(d!)).toHaveCount(0);

    await facts.card(d!).locator('[data-test="fact-actions-menu"]').click();
    await expect(
      page.getByRole('menuitem', { name: 'Copy Claim' }),
    ).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  });
});
