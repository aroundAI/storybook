import { Page, expect, test } from '@playwright/test';

import {
  SCENARIO_TODAY,
  SNAPSHOTS_ONLY_COUNTS,
  SUBSCRIBER_SCENARIOS,
} from '../../../../packages/clickhouse/src/testing/subscriber-scenarios';
import {
  seedEpisodeWithShot,
  seedProject,
  seedPublishedEpisode,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { DeepDivePageObject } from './deep-dive.po';

/**
 * Screenshots and DOM text for FILM-1617, with real subscriber data for every
 * channel state.
 *
 * Seeds the twelve scenarios the unit matrices use
 * (`@kit/clickhouse/testing`) into one project, so what a reviewer sees is
 * the same set of states the tests assert — never a hand-picked happy path.
 * Not a guard: `deep-dive.spec.ts`, `read-failures.spec.ts` and the scenario
 * matrices hold those, with ClickHouse off. This needs what CI lacks:
 *
 * - a ClickHouse the server reads (`CLICKHOUSE_ENABLED=true` on the server),
 * - the same instance reachable from here, via `CLICKHOUSE_HOST`,
 *   `CLICKHOUSE_USER` and `CLICKHOUSE_PASSWORD`.
 *
 * Skipped unless both CAPTURE_EVIDENCE and CLICKHOUSE_EVIDENCE are set.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

/**
 * The fixtures are dated around SCENARIO_TODAY; shifting every date by the
 * gap to the real today keeps the states the same on any day this runs.
 */
const SHIFT_DAYS = Math.round(
  (Date.parse(new Date().toISOString().slice(0, 10)) -
    Date.parse(SCENARIO_TODAY)) /
    86_400_000,
);

function shift(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + SHIFT_DAYS);
  return d.toISOString().slice(0, 10);
}

async function insertClickHouse(
  table: string,
  rows: Array<Record<string, unknown>>,
) {
  if (rows.length === 0) return;

  const host = process.env.CLICKHOUSE_HOST ?? 'http://localhost:8123';
  const auth = Buffer.from(
    `${process.env.CLICKHOUSE_USER ?? 'default'}:${process.env.CLICKHOUSE_PASSWORD ?? ''}`,
  ).toString('base64');

  const response = await fetch(
    `${host}/?query=${encodeURIComponent(`INSERT INTO ${table} FORMAT JSONEachRow`)}`,
    {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}` },
      body: rows.map((row) => JSON.stringify(row)).join('\n'),
    },
  );

  if (!response.ok) {
    throw new Error(
      `ClickHouse insert into ${table} failed: ${await response.text()}`,
    );
  }
}

function cardAround(page: Page, dataTest: string) {
  return page
    .locator(`[data-test="${dataTest}"]:visible`)
    .locator('xpath=ancestor::section[1]');
}

async function texts(page: Page, selector: string): Promise<string[]> {
  return page
    .locator(selector)
    .evaluateAll((els) => els.map((el) => el.textContent?.trim() ?? ''));
}

test.describe('FILM-1617 — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE || !process.env.CLICKHOUSE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 and CLICKHOUSE_EVIDENCE=1 against a ClickHouse-enabled server.',
  );

  test('captures every subscriber scenario on every surface', async ({
    page,
  }) => {
    test.setTimeout(300_000);

    const team = await seedTeamAccount();
    const project = await seedProject(team);

    // One connection, one published episode and the scenario's ClickHouse
    // rows per state. The project lists a channel only once something has
    // been published to it.
    const idByScenario = new Map<string, string>();

    for (const [index, scenario] of SUBSCRIBER_SCENARIOS.entries()) {
      const connectionId = await seedYouTubeConnection(
        team.accountId,
        scenario.name,
        { platform: scenario.platform, isActive: scenario.isActive },
      );

      idByScenario.set(scenario.id, connectionId);

      await seedPublishedEpisode(project.id, connectionId, {
        number: index + 1,
        platform: scenario.platform,
      });

      await insertClickHouse(
        'channel_subscribers',
        scenario.anchors.map((a) => ({
          connection_id: connectionId,
          snapshot_date: shift(a.snapshotDate),
          subscriber_count: a.subscriberCount,
          rounding_step: a.roundingStep,
        })),
      );
      // channel_daily holds measured movement only. A day whose movement
      // was not measured (the TikTok scenario, KB-114) has no row here.
      await insertClickHouse(
        'channel_daily',
        scenario.deltas
          .filter((d) => d.measured !== false)
          .map((d) => ({
            connection_id: connectionId,
            metric_date: shift(d.metricDate),
            views: 0,
            watch_time_seconds: 0,
            engaged_views: 0,
            subscribers_gained: Math.max(0, d.net),
            subscribers_lost: Math.max(0, -d.net),
          })),
      );
    }

    const deepDive = new DeepDivePageObject(page);

    await signInAs(page, team);
    await deepDive.goToDeepDive(team.slug, project.slug);

    const card = cardAround(page, 'subscriber-series');
    const clearHover = () => page.mouse.move(0, 0);

    await expect(
      page.locator('[data-test="subscriber-series"]:visible'),
    ).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await clearHover();

    // 1. Per channel: lines, and every channel without one explained.
    await card.screenshot({ path: `${OUT}/20-scenarios-per-channel.png` });

    const perChannel = {
      lines: await texts(page, '[data-test="subscriber-series-lines"] li'),
      missing: await texts(page, '[data-test="subscriber-series-missing"] li'),
      untracked: await texts(page, '[data-test="subscriber-series-untracked"]'),
      rounding: await texts(page, '[data-test="subscriber-seed-disclosure"]'),
    };

    // 2. Total: one line per platform, and why it has the days it has.
    await page.locator('[data-test="subscriber-series-total"]').click();
    await clearHover();
    await card.screenshot({ path: `${OUT}/21-scenarios-total.png` });

    const total = {
      notes: await texts(page, '[data-test="subscriber-series-total-note"] li'),
      lines: await texts(page, '[data-test="subscriber-series-lines"] li'),
    };

    // 3. One snapshot, yesterday: a single measured day must still show.
    await deepDive.chooseChannel(idByScenario.get('new-one-snapshot')!);
    await clearHover();
    await card.screenshot({ path: `${OUT}/22-scenario-new-channel.png` });

    // 4. The untracked platform, selected on its own.
    await deepDive.chooseChannel(idByScenario.get('untracked-platform')!);
    await expect(deepDive.subscriberEmpty()).toBeVisible();
    const untrackedAlone = await texts(
      page,
      '[data-test="subscriber-series-empty"]:visible',
    );

    // 5. The long-stopped channel, selected on its own.
    await deepDive.chooseChannel(
      idByScenario.get('active-stopped-before-window')!,
    );
    await expect(deepDive.subscriberEmpty()).toContainText('No data since');
    const stoppedAlone = await texts(
      page,
      '[data-test="subscriber-series-empty"]:visible',
    );

    // 6. YPP: every active YouTube channel's count, or why there is none.
    await deepDive.chooseChannel('all');

    const ypp = cardAround(page, 'ypp-progress-list');

    // Eight channel cards are taller than the default window, and an element
    // screenshot inside the app's scroll container is clipped to it.
    await page.setViewportSize({ width: 1280, height: 2600 });
    await ypp.scrollIntoViewIfNeeded();
    await ypp.screenshot({ path: `${OUT}/23-scenarios-ypp.png` });

    const yppRows = await page
      .locator('[data-test="ypp-progress-card"]:visible')
      .evaluateAll((cards) =>
        cards.map((c) => ({
          channel: c.querySelector('span')?.textContent,
          subscribers: c
            .querySelector('[data-test="ypp-subscribers"]')
            ?.textContent?.trim(),
        })),
      );

    // 7. A total mixing a capture gap with a rounded channel — the pair
    //    whose gap round eight found drawn as measured. The gap must be
    //    dashed in the YouTube total.
    const pairProject = await seedProject(team, { name: 'Gap Pair' });

    for (const [index, id] of (
      ['healthy-rounded', 'capture-gap'] as const
    ).entries()) {
      await seedPublishedEpisode(pairProject.id, idByScenario.get(id)!, {
        number: index + 1,
      });
    }

    await page.setViewportSize({ width: 1280, height: 720 });
    await deepDive.goToDeepDive(team.slug, pairProject.slug);
    await expect(
      page.locator('[data-test="subscriber-series"]:visible'),
    ).toBeVisible();
    await page.locator('[data-test="subscriber-series-total"]').click();
    await clearHover();
    await cardAround(page, 'subscriber-series').screenshot({
      path: `${OUT}/25-gap-pair-total.png`,
    });

    const gapPairNote = await texts(
      page,
      '[data-test="subscriber-series-total-note"] li',
    );

    // 8. The publish screen's follower counts.
    const episode = await seedEpisodeWithShot(project.id, {
      number: SUBSCRIBER_SCENARIOS.length + 1,
    });

    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${episode.slug}/publish`,
    );

    const counts = page.locator('[data-test="channel-follower-count"]:visible');

    await expect(counts.first()).toBeVisible();

    const chipList = counts
      .first()
      .locator('xpath=ancestor::div[contains(@class, "rounded-full")][1]/..');

    await chipList.scrollIntoViewIfNeeded();
    await chipList.screenshot({ path: `${OUT}/24-scenarios-publish.png` });

    const chips = await counts
      .locator('xpath=ancestor::div[contains(@class, "rounded-full")][1]')
      .evaluateAll((els) =>
        els.map((el) => ({
          text: el.textContent,
          stale: el
            .querySelector('[data-test="channel-follower-count"]')
            ?.getAttribute('data-stale'),
        })),
      );

    console.log(
      'MEASURED',
      JSON.stringify(
        {
          perChannel,
          total,
          untrackedAlone,
          stoppedAlone,
          yppRows,
          gapPairNote,
          chips,
        },
        null,
        2,
      ),
    );
  });

  /**
   * KB-114, option a (decided 2026-09-25). A TikTok channel reports no daily
   * gains or losses: the curve joins its recorded follower counts with
   * straight lines, marks every count, and calls the days between them
   * reconstructed. Every recorded count on screen is read back and checked
   * against what was seeded; a day between two counts is read off the
   * tooltip and checked against the straight line.
   */
  test('draws a TikTok channel between its recorded follower counts', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const team = await seedTeamAccount();
    const project = await seedProject(team, { name: 'TikTok Followers' });
    const connectionId = await seedYouTubeConnection(
      team.accountId,
      'TikTok Channel',
      { platform: 'tiktok' },
    );

    await seedPublishedEpisode(project.id, connectionId, {
      number: 1,
      platform: 'tiktok',
    });

    const seeded = SNAPSHOTS_ONLY_COUNTS.map(([date, count]) => ({
      date: shift(date),
      count,
    }));

    await insertClickHouse(
      'channel_subscribers',
      seeded.map((s) => ({
        connection_id: connectionId,
        snapshot_date: s.date,
        subscriber_count: s.count,
        rounding_step: 0,
      })),
    );

    const deepDive = new DeepDivePageObject(page);

    await signInAs(page, team);
    await deepDive.goToDeepDive(team.slug, project.slug);

    // The card loads after the page: wait for it, then for its points.
    await expect(
      page.locator('[data-test="subscriber-series"]:visible'),
    ).toBeVisible({ timeout: 60_000 });

    const card = cardAround(page, 'subscriber-series');
    await card.scrollIntoViewIfNeeded();

    const points = page.locator(
      '[data-test="subscriber-snapshot-point"]:visible',
    );
    await expect(points).toHaveCount(seeded.length);

    // Every recorded count, as drawn.
    const drawn = await points.evaluateAll((els) =>
      els.map((el) => ({
        date: el.getAttribute('data-date'),
        count: Number(el.getAttribute('data-count')),
      })),
    );

    // A day between the first two counts, off the tooltip: hover halfway
    // between their points.
    const [first, second] = [
      await points.nth(0).boundingBox(),
      await points.nth(1).boundingBox(),
    ];
    await page.mouse.move(
      (first!.x + second!.x) / 2 + first!.width / 2,
      (first!.y + second!.y) / 2 + first!.height / 2,
    );
    const tooltip = page
      .getByText('reconstructed from follower snapshots', { exact: false })
      .filter({ hasNotText: 'Lighter dotted line' })
      .first();
    await expect(tooltip).toBeVisible();
    const tooltipText = await tooltip
      .locator('xpath=ancestor::div[contains(@class, "shadow-xl")][1]')
      .textContent();

    await card.screenshot({
      path: `${OUT}/30-tiktok-between-snapshots-light.png`,
    });

    const legend = await texts(
      page,
      '[data-test="subscriber-source-legend"] li',
    );

    // The same card in the dark theme.
    await page.mouse.move(0, 0);
    await page
      .context()
      .addCookies([{ name: 'theme', value: 'dark', url: page.url() }]);
    // The tab is client state: a reload lands on Overview, so go back.
    await deepDive.goToDeepDive(team.slug, project.slug);
    await expect(
      page.locator('[data-test="subscriber-series"]:visible'),
    ).toBeVisible({ timeout: 60_000 });
    await expect(points).toHaveCount(seeded.length);
    await cardAround(page, 'subscriber-series').scrollIntoViewIfNeeded();
    await cardAround(page, 'subscriber-series').screenshot({
      path: `${OUT}/31-tiktok-between-snapshots-dark.png`,
    });

    console.log(
      'SNAPSHOT_FIGURES',
      JSON.stringify({ seeded, drawn, tooltipText, legend }, null, 2),
    );

    expect(drawn).toEqual(seeded);
    expect(tooltipText).toContain('reconstructed from follower snapshots');
    expect(legend.join(' ')).toContain('A follower count recorded that day');
  });
});
