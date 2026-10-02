import { type Locator, type Page, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

import { ANALYTICS_PLATFORMS } from '../../../../packages/clickhouse/src/lib/data-provenance';
import {
  type SeededVideo,
  clickHouseDate,
  daysAgo,
  insertClickHouse,
  seedVideoDims,
  seedVideoMetricsBatch,
} from '../utils/clickhouse';
import {
  seedProject,
  seedPublishedEpisode,
  seedSeason,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-1705 — the provenance surfaces, in a browser.
 *
 * The page the spec's §8 asks for: YouTube connected with rows, TikTok
 * connected with none, Instagram not connected, and a page connected on a
 * platform analytics does not support — LinkedIn, since Facebook became an
 * analytics platform (FILM-1720).
 *
 * The guard test holds whether or not the server reads ClickHouse (⚫️ Test
 * runs with it off), so it asserts only what does not depend on an
 * observation, plus the observed states when CLICKHOUSE_EVIDENCE says the
 * server reads it. The evidence test seeds rows and records what every
 * surface says, in both themes.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const OBSERVED = Boolean(process.env.CLICKHOUSE_EVIDENCE);
const SLOW = { timeout: 60_000 };

// The matrix's own sentences (packages/clickhouse/src/lib/data-provenance.ts)
// that the cards must show verbatim. Restated here because a spec is the
// one place a reader should be able to check them without the code.
const NOTES = {
  instagramTraffic: 'Instagram does not report where a post’s views came from.',
  tiktokTraffic:
    'TikTok does report where views came from, through a separate Business integration we have not built yet, so traffic sources cover YouTube only.',
};

/** A day inside the last complete Sunday-to-Saturday week, as Deep Dive windows. */
function lastCompleteWeekDay() {
  const date = daysAgo(0);

  date.setUTCDate(date.getUTCDate() - date.getUTCDay() - 4);

  return date;
}

async function seedPage(
  page: Page,
  { connections, rows }: { connections: boolean; rows: boolean },
) {
  const team = await seedTeamAccount();
  const project = await seedProject(team);

  if (connections) {
    const { seasonId } = await seedSeason(project.id);
    const youtube = await seedYouTubeConnection(team.accountId, 'Seed Studio');

    await seedYouTubeConnection(team.accountId, '@seedstudio', {
      platform: 'tiktok',
    });
    await seedYouTubeConnection(team.accountId, 'Seed Studio Co', {
      platform: 'linkedin',
    });

    const { publishId } = await seedPublishedEpisode(project.id, youtube, {
      seasonId,
      title: 'Covered video',
    });

    if (rows) {
      const video: SeededVideo = {
        videoId: publishId,
        projectId: project.id,
        accountId: team.accountId,
        connectionId: youtube,
        title: 'Covered video',
        publishedAt: daysAgo(12),
      };

      await seedVideoDims([video]);
      await seedVideoMetricsBatch([
        { video, days: [{ ageDays: 2, views: 1_000 }] },
      ]);
      await insertClickHouse('video_traffic_sources', [
        {
          project_id: project.id,
          video_id: publishId,
          platform: 'youtube',
          metric_date: clickHouseDate(lastCompleteWeekDay()),
          source: 'YT_SEARCH',
          views: 400,
          watch_time_minutes: 400,
        },
      ]);
    }
  }

  await signInAs(page, team);
  await page.goto(`/home/${team.slug}/studio/${project.slug}/analytics`);

  return { team, project };
}

const chipOf = (card: Locator) => byTest(card, 'provenance-chip');

/**
 * From the keyboard. Once the page has scrolled to a Deep Dive card, the
 * pointer path to the header's trigger hit-tests onto the median chart's
 * bars in Playwright, so a click waited out the test; focus and Enter
 * reach the same Radix trigger a reader does.
 */
async function openFilter(page: Page) {
  const trigger = byTest(page, 'platform-filter-trigger');

  await trigger.focus();
  await page.keyboard.press('Enter');

  const options = byTest(page, 'platform-filter-options');

  await expect(options).toBeVisible();

  return options;
}

async function toggle(options: Locator, platform: string) {
  await byTest(options, `platform-filter-${platform}`)
    .locator('button[role="checkbox"]')
    .click();
}

/**
 * Every platform starts selected; untick all but Instagram. Read from the
 * shared list, which grows (Facebook with FILM-1720, X with FILM-1727).
 */
async function leaveInstagramAlone(options: Locator) {
  for (const platform of ANALYTICS_PLATFORMS) {
    if (platform !== 'instagram') await toggle(options, platform);
  }
}

test.describe('Provenance surfaces (FILM-1705)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('the strip, the chip, the filter’s third state and a dimmed card, on one seeded page', async ({
    page,
  }) => {
    await seedPage(page, { connections: true, rows: OBSERVED });

    // The strip: one sentence per platform, a LinkedIn page named.
    const strip = byTest(page, 'coverage-strip');

    await expect(byTest(strip, 'coverage-strip-instagram')).toHaveText(
      'Instagram: not connected. Connect a channel in settings to include it.',
      SLOW,
    );
    await expect(byTest(strip, 'coverage-strip-instagram')).toHaveAttribute(
      'data-kind',
      'not_connected',
    );
    await expect(byTest(strip, 'coverage-strip-linkedin')).toHaveText(
      'LinkedIn (Seed Studio Co): connected, but analytics doesn’t support LinkedIn.',
    );

    if (OBSERVED) {
      await expect(byTest(strip, 'coverage-strip-youtube')).toHaveAttribute(
        'data-kind',
        'covered',
      );
      await expect(byTest(strip, 'coverage-strip-tiktok')).toHaveAttribute(
        'data-kind',
        'no_data_in_window',
      );
      await expect(byTest(strip, 'coverage-strip-tiktok')).toContainText(
        'TikTok: connected (@seedstudio), but no data for',
      );
    }

    // The MetricCards: no digits for what nothing measured, a chip on each.
    for (const key of ['watchTime', 'subscribers', 'revenue']) {
      const card = byTest(page, `metric-card-${key}`);

      await expect(byTest(card, 'metric-not-measured')).toHaveText(
        'Not measured',
      );
      await expect(byTest(card, 'metric-value')).toHaveCount(0);
    }
    // YouTube supplies revenue since FILM-1726; it has none in this window.
    await expect(chipOf(byTest(page, 'metric-card-revenue'))).toHaveText(
      'YouTube only',
    );

    // Deep Dive: its own strip, for its own window; the traffic chip.
    await byTest(page, 'analytics-tab-deep-dive').click();

    const deepDiveStrip = byTest(page, 'deep-dive-coverage-strip');

    await expect(deepDiveStrip).toHaveAttribute(
      'data-window',
      'the last 52 complete weeks',
    );
    await expect(byTest(page, 'coverage-strip')).toHaveCount(0);

    const traffic = byTest(page, 'deep-dive-traffic-breakdown');

    await expect(chipOf(traffic)).toHaveText('YouTube only', SLOW);

    // The chip's explanation: the matrix's sentences, verbatim.
    await chipOf(traffic).click();

    const details = byTest(page, 'provenance-chip-details');

    await expect(byTest(details, 'provenance-line-instagram')).toContainText(
      NOTES.instagramTraffic,
    );
    await expect(byTest(details, 'provenance-line-tiktok')).toContainText(
      NOTES.tiktokTraffic,
    );
    await page.keyboard.press('Escape');

    // The filter: Instagram is offered, dimmed, with the strip's reason.
    let options = await openFilter(page);
    const instagram = byTest(options, 'platform-filter-instagram');

    await expect(instagram).toHaveAttribute('data-available', 'false');
    await expect(
      byTest(options, 'platform-filter-instagram-reason'),
    ).toHaveText(
      'Instagram: not connected. Connect a channel in settings to include it.',
    );

    // …and still selectable. Leave Instagram alone selected.
    await leaveInstagramAlone(options);
    await expect(instagram.locator('button[role="checkbox"]')).toHaveAttribute(
      'data-state',
      'checked',
    );
    await page.keyboard.press('Escape');

    // The traffic card cannot cover Instagram: dimmed, never blanked.
    await expect(traffic).toHaveAttribute('data-dimmed', 'true');
    await expect(byTest(traffic, 'card-dimmed-reason')).toContainText(
      NOTES.instagramTraffic,
    );
    await expect(byTest(traffic, 'card-sentence')).toBeVisible();

    // The median card is on a date axis, which no fetch-dated platform
    // reaches (FILM-1707 §2): dimmed too, and it says why.
    const median = byTest(page, 'deep-dive-median');

    await expect(median).toHaveAttribute('data-dimmed', 'true');
    await expect(byTest(median, 'card-dimmed-reason')).toHaveText(
      'Instagram isn’t shown here — it reports running totals, not daily views.',
    );

    // The second state: YouTube selected again, the card is back.
    options = await openFilter(page);
    await toggle(options, 'youtube');
    await page.keyboard.press('Escape');
    await expect(traffic).not.toHaveAttribute('data-dimmed', 'true');
  });

  test('a project with no connections reads as one, not as fifteen errors', async ({
    page,
  }) => {
    await seedPage(page, { connections: false, rows: false });

    await expect(byTest(page, 'coverage-strip-summary')).toHaveText(
      'No channels are connected to this project yet. Connect one in settings and its analytics appear here.',
      SLOW,
    );

    await byTest(page, 'analytics-tab-deep-dive').click();
    await expect(
      chipOf(byTest(page, 'deep-dive-traffic-breakdown')),
    ).toHaveText('Not connected', SLOW);
    await expect(
      byTest(page, 'deep-dive-coverage-strip-summary'),
    ).toBeVisible();
  });
});

test.describe('Provenance surfaces (FILM-1705) — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE || !OBSERVED,
    'Set CAPTURE_EVIDENCE=1 and CLICKHOUSE_EVIDENCE=1 with a server reading the local ClickHouse.',
  );

  test.describe.configure({ timeout: 240_000 });
  test.use({ viewport: { width: 1440, height: 1400 } });

  test('what each surface says for the seeded page, in both themes', async ({
    page,
  }) => {
    mkdirSync(OUT, { recursive: true });

    await seedPage(page, { connections: true, rows: true });

    const url = page.url();
    const measured: Record<string, unknown> = {};
    const consoleErrors: string[] = [];

    page.on('console', (message) => {
      // The LLM socket's URL carries the session token, and its server is
      // not part of this run; nothing about it is evidence here.
      if (message.type() === 'error' && !/WebSocket/.test(message.text())) {
        consoleErrors.push(message.text().slice(0, 300));
      }
    });

    const readStrip = (id: string) =>
      byTest(page, id)
        .locator('[data-kind]')
        .evaluateAll((items) =>
          items.map((item) => ({
            platform: (item as HTMLElement).dataset.test,
            kind: (item as HTMLElement).dataset.kind,
            sentence: item.textContent,
          })),
        );

    const readChips = () =>
      byTest(page, 'provenance-chip').evaluateAll((chips) =>
        chips.map((chip) => ({
          card:
            chip
              .closest(
                'section,[data-test^="metric-card-"],[data-test^="audience-card-"]',
              )
              ?.getAttribute('data-test') ?? null,
          label: chip.textContent,
          coverage: (chip as HTMLElement).dataset.coverage,
          tone: (chip as HTMLElement).dataset.tone,
          muted: (chip as HTMLElement).dataset.muted,
        })),
      );

    for (const theme of ['light', 'dark'] as const) {
      await page.goto(url);
      await page.evaluate(
        (value) => localStorage.setItem('theme', value),
        theme,
      );
      await page.reload();

      await expect(byTest(page, 'coverage-strip-youtube')).toHaveAttribute(
        'data-kind',
        'covered',
        SLOW,
      );
      // The cards, not their skeletons, in the screenshot.
      await expect(
        byTest(byTest(page, 'overview-views'), 'card-figure'),
      ).toHaveText('1,000', SLOW);

      measured[`header-strip-${theme}`] = await readStrip('coverage-strip');
      measured[`overview-chips-${theme}`] = await readChips();
      await page.screenshot({
        path: `${OUT}/film-1705-overview-${theme}.png`,
        animations: 'disabled',
      });

      await byTest(page, 'analytics-tab-deep-dive').click();
      await expect(
        byTest(page, 'deep-dive-coverage-strip').locator(
          '[data-kind="covered"]',
        ),
      ).toHaveCount(1, SLOW);

      measured[`deep-dive-strip-${theme}`] = await readStrip(
        'deep-dive-coverage-strip',
      );
      measured[`deep-dive-chips-${theme}`] = await readChips();
      await page.screenshot({
        path: `${OUT}/film-1705-deep-dive-${theme}.png`,
        animations: 'disabled',
      });

      const traffic = byTest(page, 'deep-dive-traffic-breakdown');

      await chipOf(traffic).click();

      const details = byTest(page, 'provenance-chip-details');

      measured[`traffic-chip-lines-${theme}`] = await details
        .locator('[data-coverage]')
        .evaluateAll((lines) =>
          lines.map((line) => ({
            platform: (line as HTMLElement).dataset.test,
            coverage: (line as HTMLElement).dataset.coverage,
            text: line.textContent,
          })),
        );
      await page.screenshot({
        path: `${OUT}/film-1705-chip-open-${theme}.png`,
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await expect(details).toBeHidden();

      const options = await openFilter(page);

      measured[`filter-${theme}`] = await options
        .locator('[data-available]')
        .evaluateAll((rows) =>
          rows.map((row) => ({
            platform: (row as HTMLElement).dataset.test,
            available: (row as HTMLElement).dataset.available,
            text: row.textContent,
          })),
        );
      await page.screenshot({
        path: `${OUT}/film-1705-filter-${theme}.png`,
        animations: 'disabled',
      });

      // The state after the interaction: Instagram alone selected.
      await leaveInstagramAlone(options);
      await page.keyboard.press('Escape');
      await expect(traffic).toHaveAttribute('data-dimmed', 'true');
      await expect(options).toBeHidden();
      await expect(byTest(traffic, 'card-sentence')).toBeVisible(SLOW);

      measured[`dimmed-${theme}`] = await byTest(
        traffic,
        'card-dimmed-reason',
      ).textContent();
      await page.screenshot({
        path: `${OUT}/film-1705-dimmed-${theme}.png`,
        animations: 'disabled',
      });
    }

    writeFileSync(
      `${OUT}/film-1705-measured.json`,
      JSON.stringify({ ...measured, consoleErrors }, null, 2),
    );
  });
});
