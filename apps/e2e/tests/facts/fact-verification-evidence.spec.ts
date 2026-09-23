import { expect, test } from '@playwright/test';

import { updateRows } from '../utils/seed';
import { FactsPageObject } from './facts.po';

/**
 * Screenshots of the Fact Library review flow for the KB-18 PR. Not a guard —
 * fact-verification.spec.ts holds those, and this asserts only enough to
 * know each picture shows the state it is named for. Skipped unless
 * CAPTURE_EVIDENCE is set.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('Fact Library — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test('verify, dispute, reload, details, and a stale review', async ({
    page,
  }) => {
    const facts = new FactsPageObject(page);
    const {
      team,
      project,
      facts: [a, b, c],
    } = await facts.seedProjectWithFacts(3);

    await facts.signIn(team);
    await facts.goto(team, project);
    await page.screenshot({
      path: `${OUT}/kb18-01-library-before.png`,
      fullPage: true,
    });

    await facts.openReview(a!);
    await facts.notes().fill('Checked against the 1851 harbour board minutes');
    await facts
      .dialog()
      .screenshot({ path: `${OUT}/kb18-02-verify-dialog.png` });
    await facts.confirmVerified();
    await expect(facts.status(a!)).toHaveText('Verified');
    await page.screenshot({
      path: `${OUT}/kb18-03-after-verify.png`,
      fullPage: true,
    });

    await facts.openReview(b!);
    await expect(facts.notes()).toHaveValue('');
    await facts.notes().fill('The minutes give 1852, not 1842');
    await facts
      .dialog()
      .screenshot({ path: `${OUT}/kb18-04-second-dialog-dispute.png` });
    await facts.markDisputed();
    await expect(facts.status(b!)).toHaveText('Disputed');
    await page.screenshot({
      path: `${OUT}/kb18-05-after-dispute.png`,
      fullPage: true,
    });

    await page.reload();
    await expect(facts.status(a!)).toHaveText('Verified');
    await expect(facts.status(b!)).toHaveText('Disputed');
    await page.screenshot({
      path: `${OUT}/kb18-06-after-reload.png`,
      fullPage: true,
    });

    await facts.openReview(c!);
    await facts.notes().fill('Looks right to me');
    await updateRows('verified_facts', `id=eq.${c!.id}`, {
      verification_status: 'disputed',
      verification_notes: 'Disputed by a colleague',
    });
    await facts.confirmVerified();
    await expect(facts.errorToast()).toContainText('already disputed');
    await expect(facts.notes()).toHaveValue('Looks right to me');
    await page.screenshot({ path: `${OUT}/kb18-07-stale-review-refused.png` });

    await page.keyboard.press('Escape');
    await facts.openDetails(a!);
    await expect(facts.verifiedBy()).toContainText('Verified by');
    await page.screenshot({
      path: `${OUT}/kb18-08-details-verified-by.png`,
      fullPage: true,
    });
  });

  test('a project member sees no Verify or Delete', async ({ page }) => {
    const facts = new FactsPageObject(page);
    const {
      team,
      project,
      facts: [d],
    } = await facts.seedProjectWithFacts(1);
    const member = await facts.seedProjectMember(team, project);

    await facts.signIn(member);
    await facts.goto(team, project);
    await facts.card(d!).locator('[data-test="fact-actions-menu"]').click();
    await expect(
      page.getByRole('menuitem', { name: 'Copy Claim' }),
    ).toBeVisible();
    await page.screenshot({
      path: `${OUT}/kb18-09-member-view.png`,
      fullPage: true,
    });
  });
});
