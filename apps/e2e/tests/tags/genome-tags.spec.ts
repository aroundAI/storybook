import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * Genome attributes on the tags page (FILM-1717 v1).
 *
 * The genome's observable attributes are tags, recorded here. A yes/no or
 * banded dimension takes only its own values — the table refuses anything
 * else — and the refusal has to reach the person typing, under the field
 * they typed in: the slug it is checked on has no field of its own. The
 * second submission, after the refusal, is where a form that kept a stale
 * error or stale value would show it.
 *
 * Screenshots only with CAPTURE_EVIDENCE=1, into $EVIDENCE_DIR.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const capture = Boolean(process.env.CAPTURE_EVIDENCE);

async function chooseDimension(page: Page, dimension: string) {
  await byTest(page, 'tag-dimension-trigger').click();
  await byTest(page, `tag-dimension-${dimension}`).click();
}

test.describe('Genome tags', () => {
  test('a closed dimension refuses another value, then takes its own; an open one takes any', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'genome-tags' });

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/analytics/tags`);

    const form = byTest(page, 'create-tag-form');
    const label = form.getByPlaceholder('e.g. Process explainer');
    const submit = form.getByRole('button', { name: 'Add tag' });

    // Taxonomy and genome are listed apart.
    await expect(byTest(page, 'tag-group-taxonomy')).toContainText(
      'What the video is',
    );
    await expect(byTest(page, 'tag-group-genome')).toContainText(
      'Creative mechanisms',
    );

    await chooseDimension(page, 'result_first');
    await expect(byTest(page, 'tag-dimension-trigger')).toHaveText(
      'Result first',
    );
    await expect(byTest(page, 'tag-closed-values')).toHaveText(
      'Takes only: yes, no',
    );

    // 1. A value outside the dimension's list is refused, under Label.
    await label.fill('Maybe');
    await submit.click();
    await expect(byTest(page, 'tag-label-error')).toHaveText(
      'This dimension takes only: yes, no',
    );
    await expect(byTest(page, 'tag-section-result_first')).toContainText(
      'No tags yet.',
    );
    if (capture) {
      await form.screenshot({ path: `${OUT}/01-closed-value-refused.png` });
    }

    // 2. The second submission, with an allowed value, saves.
    await label.fill('Yes');
    await submit.click();
    await expect(page.getByText('Added "Yes"')).toBeVisible();
    await expect(byTest(page, 'tag-label-error')).toHaveCount(0);
    await expect(byTest(page, 'tag-section-result_first')).toContainText('Yes');
    await expect(byTest(page, 'tag-dimension-trigger')).toHaveText(
      'Result first',
    );
    await expect(label).toHaveValue('');

    // 3. An open dimension is the account's own vocabulary.
    await chooseDimension(page, 'hook_type');
    await expect(byTest(page, 'tag-closed-values')).toHaveCount(0);
    await label.fill('Cold open');
    await submit.click();
    await expect(page.getByText('Added "Cold open"')).toBeVisible();
    await expect(byTest(page, 'tag-section-hook_type')).toContainText(
      'Cold open',
    );

    // 4. A semantic dimension (v2) takes a level.
    await expect(byTest(page, 'tag-group-semantic')).toContainText(
      'What the creative does',
    );
    await chooseDimension(page, 'identity');
    await expect(byTest(page, 'tag-closed-values')).toHaveText(
      'Takes only: low, medium, high',
    );
    await label.fill('High');
    await submit.click();
    await expect(page.getByText('Added "High"')).toBeVisible();
    await expect(byTest(page, 'tag-section-identity')).toContainText('High');

    if (capture) {
      await byTest(page, 'tag-group-genome').screenshot({
        path: `${OUT}/02-genome-tags-saved.png`,
      });
      await byTest(page, 'tag-group-semantic').screenshot({
        path: `${OUT}/04-semantic-tag-saved.png`,
      });
      await page.screenshot({
        path: `${OUT}/03-tags-page.png`,
        fullPage: true,
      });
    }
  });
});
