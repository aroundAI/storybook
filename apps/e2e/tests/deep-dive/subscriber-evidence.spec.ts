import { Page, expect, test } from '@playwright/test';

import {
  seedEpisodeWithShot,
  seedPublishedEpisode,
  seedYouTubeConnection,
} from '../utils/seed';
import { DeepDivePageObject } from './deep-dive.po';

/**
 * Screenshots and DOM measurements for FILM-1617, with real subscriber data.
 *
 * Not a guard: `deep-dive.spec.ts` and `read-failures.spec.ts` hold those,
 * and run with ClickHouse off, where every channel has no level. This spec
 * is the only place the curve, the total and the rounded-seed disclosure are
 * drawn from data, so it needs what CI does not have:
 *
 * - a ClickHouse the server reads (`CLICKHOUSE_ENABLED=true` on the server),
 * - the same instance reachable from here, via `CLICKHOUSE_HOST`,
 *   `CLICKHOUSE_USER` and `CLICKHOUSE_PASSWORD`.
 *
 * Skipped unless both CAPTURE_EVIDENCE and CLICKHOUSE_EVIDENCE are set.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

function daysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function insertClickHouse(
  table: string,
  rows: Array<Record<string, unknown>>,
) {
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
    throw new Error(`ClickHouse insert into ${table} failed: ${await response.text()}`);
  }
}

/**
 * A weekly anchor plus daily movement from `firstAnchorDaysAgo` to today.
 * Movement starts on the first anchor, so the curve cannot reach earlier than
 * it — which is what makes the total's start date visible.
 */
async function seedSubscriberHistory(
  connectionId: string,
  options: {
    firstAnchorDaysAgo: number;
    startLevel: number;
    dailyGain: number;
    roundingStep: number;
  },
) {
  const anchors: Array<Record<string, unknown>> = [];
  const movement: Array<Record<string, unknown>> = [];

  let level = options.startLevel;

  for (let day = options.firstAnchorDaysAgo; day >= 1; day--) {
    const date = daysAgo(day);

    if (day !== options.firstAnchorDaysAgo) {
      // A little noise, so the line is a measurement rather than a ruler.
      const gained = options.dailyGain + ((day * 7) % 5);
      const lost = (day * 3) % 4;

      level += gained - lost;
      movement.push({
        connection_id: connectionId,
        metric_date: date,
        views: 0,
        watch_time_seconds: 0,
        impressions: 0,
        engaged_views: 0,
        subscribers_gained: gained,
        subscribers_lost: lost,
      });
    }

    if ((options.firstAnchorDaysAgo - day) % 7 === 0) {
      const step = options.roundingStep;

      anchors.push({
        connection_id: connectionId,
        snapshot_date: date,
        // YouTube rounds down, so the reported figure is the band floor.
        subscriber_count: step > 0 ? Math.floor(level / step) * step : level,
        rounding_step: step,
      });
    }
  }

  await insertClickHouse('channel_subscribers', anchors);
  await insertClickHouse('channel_daily', movement);
}

function cardAround(page: Page, dataTest: string) {
  return page
    .locator(`[data-test="${dataTest}"]:visible`)
    .locator('xpath=ancestor::div[contains(@class, "rounded-2xl")][1]');
}

test.describe('FILM-1617 — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE || !process.env.CLICKHOUSE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 and CLICKHOUSE_EVIDENCE=1 against a ClickHouse-enabled server.',
  );

  test('captures the subscriber curve, the total and the YPP count', async ({
    page,
  }) => {
    // Seeding three channels' history and a cold compile of the tab.
    test.setTimeout(300_000);

    const deepDive = new DeepDivePageObject(page);
    const fixture = await deepDive.setup();

    const secondChannelId = await seedYouTubeConnection(
      fixture.team.accountId,
      'Second Channel',
    );

    await seedPublishedEpisode(fixture.project.id, secondChannelId, {
      number: 3,
    });

    // Rounded, like any YouTube channel above 1,000.
    await seedSubscriberHistory(fixture.activeChannelId, {
      firstAnchorDaysAgo: 200,
      startLevel: 40_150,
      dailyGain: 12,
      roundingStep: 100,
    });

    // Below 1,000, so exact — and connected much later.
    await seedSubscriberHistory(secondChannelId, {
      firstAnchorDaysAgo: 90,
      startLevel: 610,
      dailyGain: 3,
      roundingStep: 0,
    });

    // The disconnected channel, connected in between.
    await seedSubscriberHistory(fixture.inactiveChannelId, {
      firstAnchorDaysAgo: 150,
      startLevel: 2_300,
      dailyGain: 1,
      roundingStep: 10,
    });

    await page.reload();
    await page.locator('[data-test="analytics-tab-deep-dive"]').click();

    const series = page.locator('[data-test="subscriber-series"]:visible');
    const card = cardAround(page, 'subscriber-series');

    await expect(series).toBeVisible();
    await card.scrollIntoViewIfNeeded();

    // A hover tooltip left over from the click would cover the axis.
    const clearHover = () => page.mouse.move(0, 0);

    await clearHover();

    // 1. Per channel, the default.
    await card.screenshot({ path: `${OUT}/10-subscribers-per-channel.png` });

    const perChannelDisclosure = await page
      .locator('[data-test="subscriber-seed-disclosure"]:visible')
      .textContent();

    // 2. The total, starting where every channel has a level.
    await page.locator('[data-test="subscriber-series-total"]').click();

    const totalNote = page.locator(
      '[data-test="subscriber-series-total-note"]:visible',
    );

    await expect(totalNote).toContainText('The total begins');
    await clearHover();
    await card.screenshot({ path: `${OUT}/11-subscribers-total.png` });

    const totalNoteText = await totalNote.textContent();
    // Summed: every channel's shortfall at once, not the largest one.
    const totalDisclosure = await page
      .locator('[data-test="subscriber-seed-disclosure"]:visible')
      .textContent();

    // 3. One channel selected: its line alone.
    await deepDive.chooseChannel(secondChannelId);
    await expect(
      page.locator('[data-test="subscriber-series-total"]'),
    ).toHaveCount(0);
    await clearHover();
    await card.screenshot({ path: `${OUT}/12-subscribers-one-channel.png` });

    // 4. The YPP card: the count, and net movement labelled as movement.
    await deepDive.chooseChannel('all');

    const ypp = deepDive
      .yppCards()
      .filter({ hasText: 'Active Channel' })
      .first();

    await expect(ypp.locator('[data-test="ypp-subscribers-value"]')).not.toHaveText(
      'Unavailable',
    );
    await ypp.scrollIntoViewIfNeeded();
    await cardAround(page, 'ypp-progress-list').screenshot({
      path: `${OUT}/13-ypp-subscribers.png`,
    });

    // 5. The publish screen's channel chips. Active Channel has a dated
    //    level; this one has only the count stored when it was connected —
    //    how every Instagram connection reaches the page today.
    await seedYouTubeConnection(fixture.team.accountId, 'Stored Count Channel', {
      metadata: { followers_count: 1_250 },
    });

    const episode = await seedEpisodeWithShot(fixture.project.id, {
      number: 4,
    });

    await page.goto(
      `/home/${fixture.team.slug}/studio/${fixture.project.slug}/episodes/${episode.slug}/publish`,
    );

    const followerCounts = page.locator(
      '[data-test="channel-follower-count"]:visible',
    );

    await expect(followerCounts.first()).toBeVisible();

    const chips = followerCounts.locator('xpath=ancestor::div[contains(@class, "rounded-full")][1]');
    const chipList = chips.first().locator('xpath=..');

    await chipList.scrollIntoViewIfNeeded();
    await chipList.screenshot({ path: `${OUT}/14-publish-follower-counts.png` });

    // The stored one's tooltip, which says it is not live.
    await chips.filter({ hasText: 'Stored Count Channel' }).hover();

    const storedTooltip = page.getByRole('tooltip');

    await expect(storedTooltip).toContainText('not live');

    // Read now: once another chip is hovered, this locator finds its tooltip.
    const storedTooltipText = await storedTooltip.textContent();
    await page.screenshot({
      path: `${OUT}/15-publish-stored-count-tooltip.png`,
      animations: 'disabled',
    });

    // A rounded YouTube count: measured, and said to be rounded.
    await clearHover();
    await chips.filter({ hasText: 'Active Channel' }).hover();

    // The previous tooltip can still be closing, so pick this chip's.
    const roundedTooltip = page
      .getByRole('tooltip')
      .filter({ hasText: 'Active Channel' })
      .first();

    await expect(roundedTooltip).toContainText('Active Channel');

    const roundedTooltipText = await roundedTooltip.textContent();

    await page.screenshot({
      path: `${OUT}/17-publish-rounded-count-tooltip.png`,
      animations: 'disabled',
    });

    const publishChips = await chips.evaluateAll((els) =>
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
          totalNote: totalNoteText,
          perChannelDisclosure,
          totalDisclosure,
          publishChips,
          storedTooltipText,
          roundedTooltipText,
          yppCards: await deepDive.yppCards().evaluateAll((cards) =>
            cards.map((c) => ({
              channel: c.querySelector('span')?.textContent,
              subscribers: c.querySelector('[data-test="ypp-subscribers-value"]')
                ?.textContent,
              subscribersNote: c.querySelector('[data-test="ypp-subscribers"] p')
                ?.textContent,
              netRow: [...c.querySelectorAll('span')]
                .find((s) => s.textContent?.startsWith('Net subscriber'))
                ?.parentElement?.textContent,
            })),
          ),
        },
        null,
        2,
      ),
    );
  });
});
