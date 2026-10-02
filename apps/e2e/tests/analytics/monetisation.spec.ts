import { expect, test } from '@playwright/test';

import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import {
  MONETISATION_EXPECTED,
  seedUnmeasuredTeam,
} from './monetisation.fixture';

/**
 * FILM-1726. Revenue nobody measured says so, and says why, instead of
 * showing $0. Holds with ClickHouse on or off: the unmeasured team has no
 * revenue row either way, and the reasons come from Postgres.
 */
const { figure, reasons } = MONETISATION_EXPECTED.unmeasured;

test.describe('FILM-1726 revenue not measured', () => {
  test.describe.configure({ timeout: 120_000 });

  test('the project card says Not measured, with one sentence per reason', async ({
    page,
  }) => {
    const fixture = await seedUnmeasuredTeam();

    await signInAs(page, fixture.team);
    await page.goto(
      `/home/${fixture.team.slug}/studio/${fixture.projectSlug}/analytics`,
    );

    const card = byTest(page, 'metric-card-revenue');

    await expect(byTest(card, 'metric-unmeasured')).toHaveText(figure);
    await expect(byTest(page, 'metric-not-measured-reason')).toHaveCount(
      reasons.length,
    );
    expect(
      [
        ...(await byTest(page, 'metric-not-measured-reason').allTextContents()),
      ].sort(),
    ).toEqual([...reasons].sort());
  });

  test('the episode page and the experiment deltas say Not measured', async ({
    page,
  }) => {
    const fixture = await seedUnmeasuredTeam();

    await signInAs(page, fixture.team);
    await page.goto(
      `/home/${fixture.team.slug}/studio/${fixture.projectSlug}/episodes/${fixture.episodeSlug}/analytics`,
    );

    await expect(byTest(page, 'episode-revenue')).toHaveText(figure);
    await expect(
      byTest(byTest(page, 'metric-card-revenue'), 'metric-unmeasured'),
    ).toHaveText(figure);

    await page.goto(`/home/${fixture.team.slug}/studio/analytics/experiments`);
    await byTest(page, `experiment-row-${fixture.experimentId}`).click();

    await expect(byTest(page, 'experiment-delta-revenueCents')).toContainText(
      figure,
    );
  });
});
