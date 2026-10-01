import { type Page, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import {
  MONETISATION_EXPECTED,
  type MonetisationTeam,
  seedMeasuredTeam,
  seedUnmeasuredTeam,
} from './monetisation.fixture';

/**
 * FILM-1726 — screenshots and DOM readings for every surface whose revenue
 * text changed: the project's metric cards, the episode page, the Shorts
 * ROI card and the experiment deltas. One team's YouTube channel reports
 * earnings; the other's channels cannot, each for its own reason. The
 * answers are worked out by hand in `monetisation.fixture.ts`.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((value) => localStorage.setItem('theme', value), theme);
  await page.reload();
}

async function readSurfaces(
  page: Page,
  fixture: MonetisationTeam,
  label: string,
  theme: 'light' | 'dark',
) {
  const base = `/home/${fixture.team.slug}/studio`;
  const reading: Record<string, unknown> = {};

  // The project's cards.
  await page.goto(`${base}/${fixture.projectSlug}/analytics`);
  await setTheme(page, theme);

  const card = byTest(page, 'metric-card-revenue');

  await expect(byTest(card, 'metric-value')).not.toHaveText('');
  // The reasons arrive on their own query.
  if (label === 'unmeasured') {
    await expect(byTest(page, 'metric-not-measured-reason')).toHaveCount(
      MONETISATION_EXPECTED.unmeasured.reasons.length,
    );
  }
  // The Overview grid below the cards loads on its own reads: let it land.
  await expect(
    byTest(byTest(page, 'overview-views'), 'card-figure'),
  ).toBeVisible({ timeout: 60_000 });
  reading.projectCard = await byTest(card, 'metric-value').textContent();
  reading.projectReasons = await byTest(
    page,
    'metric-not-measured-reason',
  ).allTextContents();
  await page.screenshot({
    path: `${OUT}/film-1726-${label}-project-${theme}.png`,
  });

  // The Shorts ROI card, on the Language tab.
  await byTest(page, 'analytics-tab-language').click();

  const roi = byTest(page, 'roi-revenue-per-view');

  // The Language tab's reads land after the tab: wait for the card.
  await expect(roi).toBeVisible({ timeout: 60_000 });
  reading.roiRevenuePerView = await roi.textContent();
  await byTest(page, 'shorts-roi-card').screenshot({
    path: `${OUT}/film-1726-${label}-shorts-roi-${theme}.png`,
  });

  // The episode page.
  await page.goto(
    `${base}/${fixture.projectSlug}/episodes/${fixture.episodeSlug}/analytics`,
  );
  await expect(byTest(page, 'episode-revenue')).toBeVisible();
  reading.episodeHeader = await byTest(page, 'episode-revenue').textContent();
  reading.episodeCard = await byTest(
    byTest(page, 'metric-card-revenue'),
    'metric-value',
  ).textContent();
  await page.screenshot({
    path: `${OUT}/film-1726-${label}-episode-${theme}.png`,
  });

  // The experiment's deltas.
  await page.goto(`${base}/analytics/experiments`);
  await byTest(page, `experiment-row-${fixture.experimentId}`).click();

  const delta = byTest(page, 'experiment-delta-revenueCents');

  await expect(delta).toBeVisible();
  reading.experimentDelta = await delta.textContent();
  await delta.screenshot({
    path: `${OUT}/film-1726-${label}-experiment-delta-${theme}.png`,
  });

  return reading;
}

test.describe('FILM-1726 monetisation — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE || !process.env.CLICKHOUSE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 and CLICKHOUSE_EVIDENCE=1 with a server reading the local ClickHouse.',
  );

  test.describe.configure({ timeout: 300_000 });
  test.use({ viewport: { width: 1440, height: 1600 } });

  test('measured where authorised, Not measured with its reasons otherwise', async ({
    page,
  }) => {
    mkdirSync(OUT, { recursive: true });

    const teams = {
      measured: await seedMeasuredTeam(),
      unmeasured: await seedUnmeasuredTeam(),
    };
    const measured: Record<string, unknown> = {};

    for (const [label, fixture] of Object.entries(teams)) {
      await page.context().clearCookies();
      await signInAs(page, fixture.team);

      for (const theme of ['light', 'dark'] as const) {
        measured[`${label}-${theme}`] = await readSurfaces(
          page,
          fixture,
          label,
          theme,
        );
      }
    }

    writeFileSync(
      `${OUT}/film-1726-measured.json`,
      JSON.stringify({ expected: MONETISATION_EXPECTED, measured }, null, 2),
    );

    // Read off the page, against the answers worked out by hand.
    const yes = MONETISATION_EXPECTED.measured;
    const no = MONETISATION_EXPECTED.unmeasured;

    for (const theme of ['light', 'dark']) {
      const a = measured[`measured-${theme}`] as Record<string, unknown>;
      const b = measured[`unmeasured-${theme}`] as Record<string, unknown>;

      expect(a.projectCard, theme).toBe(yes.projectCard);
      expect(a.projectReasons, theme).toEqual([]);
      expect(a.episodeHeader, theme).toBe(yes.episodeHeader);
      expect(a.episodeCard, theme).toBe(yes.episodeCard);
      expect(a.roiRevenuePerView, theme).toBe(yes.roiRevenuePerView);
      expect(a.experimentDelta, theme).toContain(yes.experimentDelta);

      expect(b.projectCard, theme).toBe(no.figure);
      expect([...(b.projectReasons as string[])].sort(), theme).toEqual(
        [...no.reasons].sort(),
      );
      expect(b.episodeHeader, theme).toBe(no.figure);
      expect(b.episodeCard, theme).toBe(no.figure);
      expect(b.roiRevenuePerView, theme).toBe(no.figure);
      expect(b.experimentDelta, theme).toContain(no.figure);
    }
  });
});
