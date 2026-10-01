import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

import {
  clickHouseDate,
  clickHouseDateTime,
  daysAgo,
  deleteClickHouse,
  insertClickHouse,
} from '../utils/clickhouse';
import { byTest } from '../utils/visible';
import { LanguageTabFixture, LanguageTabPageObject } from './language-tab.po';

/**
 * The Language tab's format family card (FILM-1716).
 *
 * It was "Shorts vs Long-form": `short` and `teaser` in one column, the rest
 * in the other, every platform pooled. Seeded so each wrong grouping shows a
 * different number:
 *
 * | video          | platform | content_type | asset s | views | family          |
 * |----------------|----------|--------------|---------|-------|-----------------|
 * | 2 × yt short   | youtube  | short        | 45      | 100   | short_vertical  |
 * | yt short ?     | youtube  | short        | unknown | 10    | short_vertical  |
 * | yt short long  | youtube  | short        | 200     | 50    | long_vertical   |
 * | tt full        | tiktok   | full         | unknown | 70    | long_vertical   |
 * | yt full        | youtube  | full         | 1,320   | 400   | long_horizontal |
 * | yt trailer     | youtube  | trailer      | unknown | 30    | trailer         |
 * | x short        | twitter  | short        | unknown | 20    | clip            |
 *
 * By family: short 3 / 210 · long vertical 2 / 120 · long horizontal 1 / 400
 * · trailer 1 / 30 · clip 1 / 20. Four placed by declared type (unknown).
 * The old card: shorts 5 / 280, long-form 3 / 500.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const RELOADED = { timeout: 90_000 };

const FIXTURE: {
  platform: string;
  contentType: string;
  asset: number | null;
  views: number;
}[] = [
  { platform: 'youtube', contentType: 'short', asset: 45, views: 100 },
  { platform: 'youtube', contentType: 'short', asset: 45, views: 100 },
  { platform: 'youtube', contentType: 'short', asset: null, views: 10 },
  { platform: 'youtube', contentType: 'short', asset: 200, views: 50 },
  { platform: 'tiktok', contentType: 'full', asset: null, views: 70 },
  { platform: 'youtube', contentType: 'full', asset: 1320, views: 400 },
  { platform: 'youtube', contentType: 'trailer', asset: null, views: 30 },
  { platform: 'twitter', contentType: 'short', asset: null, views: 20 },
];

async function seedFamilies(fixture: LanguageTabFixture) {
  const dims: object[] = [];
  const metrics: object[] = [];

  FIXTURE.forEach((row, index) => {
    const videoId = crypto.randomUUID();

    dims.push({
      video_id: videoId,
      project_id: fixture.project.id,
      account_id: fixture.team.accountId,
      connection_id: crypto.randomUUID(),
      episode_id: '00000000-0000-0000-0000-000000000000',
      platform: row.platform,
      content_type: row.contentType,
      language: 'en',
      channel_language: 'en',
      title: `${row.platform} ${row.contentType} ${index + 1}`,
      published_at: clickHouseDateTime(daysAgo(20)),
      episode_duration_seconds: 1320,
      asset_duration_seconds: row.asset,
      tags: [],
      updated_at: clickHouseDateTime(new Date()),
    });

    metrics.push({
      project_id: fixture.project.id,
      video_id: videoId,
      platform: row.platform,
      metric_date: clickHouseDate(daysAgo(10)),
      views: row.views,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      watch_time_seconds: row.views * 30,
      revenue_cents: 0,
      subscribers_gained: 0,
      avg_view_duration_seconds: 30,
      avg_view_percentage: 40,
      dislikes: 0,
    });
  });

  await insertClickHouse('video_dim', dims);
  await insertClickHouse('video_metrics', metrics);
}

test.describe('FILM-1716 — figures by format family', () => {
  test.skip(
    !process.env.CLICKHOUSE_EVIDENCE,
    'Set CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  test.describe.configure({ timeout: 180_000 });

  test('one row per family; trailers and X clips are not folded into shorts or long-form', async ({
    page,
  }) => {
    const tab = new LanguageTabPageObject(page);
    const fixture = await tab.setup();

    await seedFamilies(fixture);

    try {
      await tab.open(fixture.team.slug, fixture.project.slug);

      const card = byTest(page, 'format-family-card');
      const rows = card.locator('[data-test^="format-family-row-"]');

      await expect(rows).toHaveCount(5, RELOADED);

      const read = async (family: string) => {
        const row = byTest(card, `format-family-row-${family}`);

        return {
          name: await byTest(row, 'format-family-name').innerText(),
          videos: await byTest(row, 'format-family-videos').innerText(),
          views: await byTest(row, 'format-family-views').innerText(),
        };
      };

      const measured = {
        short_vertical: await read('short_vertical'),
        long_vertical: await read('long_vertical'),
        long_horizontal: await read('long_horizontal'),
        trailer: await read('trailer'),
        clip: await read('clip'),
      };

      expect(measured).toEqual({
        short_vertical: {
          name: 'Short (vertical feed)',
          videos: '3',
          views: '210',
        },
        long_vertical: {
          name: 'Long-form (vertical)',
          videos: '2',
          views: '120',
        },
        long_horizontal: {
          name: 'Long-form (horizontal)',
          videos: '1',
          views: '400',
        },
        trailer: { name: 'Trailer', videos: '1', views: '30' },
        clip: { name: 'Timeline clip', videos: '1', views: '20' },
      });

      // In FORMAT_FAMILIES order, whatever the views.
      await expect(rows.nth(0)).toHaveAttribute(
        'data-test',
        'format-family-row-short_vertical',
      );
      await expect(rows.nth(4)).toHaveAttribute(
        'data-test',
        'format-family-row-clip',
      );

      await expect(
        byTest(card, 'format-family-duration-unknown'),
      ).toContainText('4 placed by their declared type');
      await expect(byTest(card, 'format-family-unclassified')).toHaveCount(0);
      await expect(card).not.toContainText('Shorts vs Long-form');

      // The ROI card names the two families it compares, and reads only them.
      const roi = byTest(page, 'shorts-roi-card');
      await expect(byTest(roi, 'roi-views-per-clip')).toHaveText('70');
      await expect(byTest(roi, 'roi-views-per-source')).toHaveText('400');
      await expect(roi).toContainText('Views per Short (vertical feed)');
      await expect(roi).toContainText('Views per Long-form (horizontal)');

      if (process.env.CAPTURE_EVIDENCE) {
        mkdirSync(OUT, { recursive: true });
        await card.screenshot({ path: `${OUT}/format-family-card.png` });
        await roi.screenshot({ path: `${OUT}/format-family-roi-card.png` });
        writeFileSync(
          `${OUT}/format-family-measured.json`,
          JSON.stringify(measured, null, 2),
        );
      }
    } finally {
      await deleteClickHouse(
        'video_dim',
        `project_id = '${fixture.project.id}'`,
      );
      await deleteClickHouse(
        'video_metrics',
        `project_id = '${fixture.project.id}'`,
      );
    }
  });
});
