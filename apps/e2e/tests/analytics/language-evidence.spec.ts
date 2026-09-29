import { Page, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

import {
  clickHouseDate,
  clickHouseDateTime,
  daysAgo,
  deleteClickHouse,
  insertClickHouse,
} from '../utils/clickhouse';
import { seedAnalyticsSettings } from '../utils/seed';
import { byTest } from '../utils/visible';
import { LanguageTabFixture, LanguageTabPageObject } from './language-tab.po';

/**
 * The Language tab with figures in it (FILM-1702).
 *
 * Seeds `video_dim` with both languages and reads the breakdown off the
 * page, under each setting of the dimension toggle. The figures are chosen
 * so that every plausible wrong implementation shows a different number:
 *
 * | videos | content | channel | age  | views each |
 * |--------|---------|---------|------|-----------|
 * | 15     | en      | en      | 40 d | 10        | enough to be reportable
 * | 3      | es      | es      | 40 d | 10        |
 * | 2      | es      | en      | 40 d | 35        | routed to the wrong channel
 * | 4      | not set | en      | 40 d | 125       | never labelled
 * | 1      | not set | none    | 40 d | 9         | uploaded outside a channel
 * | 1      | hi      | hi      | 3 d  | 20        | too young for a checkpoint
 *
 * By content language: not set 509 · en 150 · es 100 · hi 20 (total 779).
 * By channel target:   en 720 · es 30 · hi 20 · none 9.
 *
 * What the tab showed before, grouping by channel target and coalescing a
 * missing one to 'en': en 729 · es 30 · hi 20 — English at 94% of views on
 * a project where 19% of views are known to be English.
 *
 * Also the PR's screenshots, which is why every claim is read out of the DOM
 * and written to `measured.json`: a reviewer cannot check an image.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

/**
 * How long a reload of the tab may take. Seven server actions, which a dev
 * server runs one at a time and compiles on first use; the default ten
 * seconds was met by the skeleton on every attempt. Waiting for the figure is
 * the synchronisation — this only says how patient to be about it.
 */
const RELOADED = { timeout: 90_000 };
const NO_CHANNEL = '00000000-0000-0000-0000-000000000000';

interface FixtureGroup {
  count: number;
  language: string;
  channelLanguage: string;
  connectionId: string;
  ageDays: number;
  views: number;
}

function fixtureGroups(): FixtureGroup[] {
  const english = crypto.randomUUID();
  const spanish = crypto.randomUUID();
  const hindi = crypto.randomUUID();

  const group = (
    count: number,
    language: string,
    channelLanguage: string,
    connectionId: string,
    views: number,
    ageDays = 40,
  ) => ({ count, language, channelLanguage, connectionId, ageDays, views });

  return [
    group(15, 'en', 'en', english, 10),
    group(3, 'es', 'es', spanish, 10),
    group(2, 'es', 'en', english, 35),
    group(4, '', 'en', english, 125),
    group(1, '', '', NO_CHANNEL, 9),
    group(1, 'hi', 'hi', hindi, 20, 3),
  ];
}

async function seedLanguages(fixture: LanguageTabFixture) {
  const dims: object[] = [];
  const metrics: object[] = [];

  for (const group of fixtureGroups()) {
    for (let index = 0; index < group.count; index++) {
      const videoId = crypto.randomUUID();
      const publishedAt = daysAgo(group.ageDays);
      // Inside the first 30 days of the video's life *and* inside the
      // page's default 30-day window, so one row feeds both the checkpoint
      // median and the windowed views.
      const metricDay = daysAgo(Math.min(group.ageDays - 1, 25));

      dims.push({
        video_id: videoId,
        project_id: fixture.project.id,
        account_id: fixture.team.accountId,
        connection_id: group.connectionId,
        episode_id: '00000000-0000-0000-0000-000000000000',
        platform: 'youtube',
        content_type: 'full',
        language: group.language,
        channel_language: group.channelLanguage,
        title: `${group.language || 'unset'} on ${group.channelLanguage || 'none'} ${index + 1}`,
        published_at: clickHouseDateTime(publishedAt),
        duration_seconds: 600,
        tags: [],
        updated_at: clickHouseDateTime(new Date()),
      });

      metrics.push({
        project_id: fixture.project.id,
        video_id: videoId,
        platform: 'youtube',
        metric_date: clickHouseDate(metricDay),
        views: group.views,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        watch_time_seconds: group.views * 60,
        revenue_cents: 0,
        subscribers_gained: 0,
        avg_view_duration_seconds: 120,
        avg_view_percentage: 40,
        dislikes: 0,
      });
    }
  }

  await insertClickHouse('video_dim', dims);
  await insertClickHouse('video_metrics', metrics);
}

/**
 * The cards, one image each. The page scrolls inside its own container, so
 * a full-page screenshot stops at the fold — above every figure asserted
 * here.
 */
async function capture(page: Page, setting: 'content' | 'channel') {
  for (const [name, testId] of [
    ['toggle', 'language-dimension'],
    ['performance', 'language-performance-card'],
    ['matrix', 'platform-language-matrix'],
    ['trend', 'language-trend-chart'],
  ]) {
    await page
      .locator(`[data-test="${testId}"]:visible`)
      .screenshot({ path: `${OUT}/${setting}-${name}.png` });
  }
}

test.describe('FILM-1702 — the Language tab with data', () => {
  test.skip(
    !process.env.CLICKHOUSE_EVIDENCE,
    'Set CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  test.describe.configure({ timeout: 180_000 });

  test('separates unset from English, names the dimension, and agrees with the medians panel', async ({
    page,
  }) => {
    const tab = new LanguageTabPageObject(page);
    const fixture = await tab.setup();

    // The medians panel drops a language below the account's minimum
    // sample. One, so it lists every language the tab does.
    await seedAnalyticsSettings(fixture.team.accountId, { tag_min_sample: 1 });
    await seedLanguages(fixture);

    mkdirSync(OUT, { recursive: true });

    try {
      await tab.open(fixture.team.slug, fixture.project.slug);

      // ---------------------------------------------------- content language
      await expect(tab.cardLabel('performance')).toHaveText(
        'By content language',
        RELOADED,
      );
      await expect(tab.rows()).toHaveCount(4);

      const content = {
        notSet: await tab.readRow(null),
        en: await tab.readRow('en'),
        es: await tab.readRow('es'),
        hi: await tab.readRow('hi'),
      };

      // Never set is its own group, named as such — and English holds only
      // what was published as English: 150, not the 729 it used to show.
      expect(content.notSet.name).toBe('Language not set');
      expect(content.notSet.views).toBe('509');
      expect(content.notSet.share).toBe('65.3% of total');
      expect(content.en.name).toBe('English');
      expect(content.en.views).toBe('150');
      expect(content.en.share).toBe('19.3% of total');
      expect(content.es.views).toBe('100');
      expect(content.hi.views).toBe('20');

      // FILM-1606's convention: a thin language is dimmed and carries its n.
      expect(content.en.checkpoint).toBe(
        '10 median at 30 days · 15 of 15 videos',
      );
      expect(content.en.dimmed).toBe(false);
      expect(content.es.checkpoint).toBe(
        '10 median at 30 days · 5 of 5 videos · directional only',
      );
      expect(content.es.dimmed).toBe(true);
      expect(content.notSet.checkpoint).toBe(
        '125 median at 30 days · 5 of 5 videos · directional only',
      );
      expect(content.hi.checkpoint).toBe('1 video, none 30 days old yet');
      expect(content.hi.dimmed).toBe(true);

      // The unlabelled group leads on views and is still not "Top".
      await expect(tab.row(null)).not.toContainText('Top');
      await expect(tab.row('en')).toContainText('Top');

      // Every card grouped by language says which language it means.
      for (const card of ['performance', 'trend', 'matrix', 'comparison']) {
        await expect(tab.cardLabel(card)).toHaveText('By content language');
      }

      await expect(byTest(page, 'matrix-language-__not_set__')).toHaveText(
        'Language not set',
      );
      await expect(byTest(page, 'matrix-language-es')).toContainText('Spanish');

      // The routing diagnostic: 2 of the 21 comparable videos.
      await expect(byTest(page, 'language-divergence-count')).toHaveText('2');
      await expect(byTest(page, 'language-divergence-total')).toHaveText('21');
      await expect(byTest(page, 'language-divergence-pair-es-en')).toHaveText(
        'Spanish on a channel targeting English · 2',
      );
      await expect(byTest(page, 'language-divergence-not-set')).toHaveText(
        'Not compared: 5 with no language set, 1 with no channel target.',
      );

      await capture(page, 'content');

      // ------------------------------------------------ channel target
      await tab.chooseDimension('channel');

      await expect(tab.cardLabel('performance')).toHaveText(
        'By channel target language',
        RELOADED,
      );
      await expect(byTest(tab.row('en'), 'language-row-views')).toHaveText(
        '720',
        RELOADED,
      );

      const channel = {
        en: await tab.readRow('en'),
        es: await tab.readRow('es'),
        hi: await tab.readRow('hi'),
        none: await tab.readRow(null),
      };

      // The same 26 videos, regrouped: the numbers change, and the absent
      // group changes meaning with them.
      expect(channel.en.views).toBe('720');
      expect(channel.es.views).toBe('30');
      expect(channel.hi.views).toBe('20');
      expect(channel.none.name).toBe('No channel target');
      expect(channel.none.views).toBe('9');
      expect(channel.en.checkpoint).toBe(
        '10 median at 30 days · 21 of 21 videos',
      );

      for (const card of ['performance', 'trend', 'matrix', 'comparison']) {
        await expect(tab.cardLabel(card)).toHaveText(
          'By channel target language',
        );
      }

      await capture(page, 'channel');

      // ------------------------------------------- and back, the second time
      await tab.chooseDimension('content');

      await expect(byTest(tab.row('en'), 'language-row-views')).toHaveText(
        '150',
        RELOADED,
      );
      await expect(byTest(tab.row(null), 'language-row-name')).toHaveText(
        'Language not set',
      );

      // ----------------------------- the other surface that groups by language
      //
      // The medians panel runs the same segment query, scoped to the account
      // rather than the project. One project here, so the two must agree.
      await page.goto(`/home/${fixture.team.slug}/studio/analytics/tags`);

      const medians = byTest(page, 'tag-medians-card');

      await medians
        .locator('[data-test="tag-medians-dimension-trigger"]')
        .click();
      await page
        .locator('[data-test="tag-medians-dimension-language"]')
        .click();

      const segments = byTest(medians, 'tag-medians-segment');

      await expect(segments).toHaveCount(3, RELOADED);

      const panel = await medians
        .locator('[data-test="tag-medians-segment"]')
        .locator('xpath=..')
        .allInnerTexts();
      const panelRow = (name: string) =>
        panel.find((text) => text.startsWith(name))?.replace(/\s+/g, ' ');

      expect(panelRow('Language not set')).toBe(
        'Language not set 125 median · 5 of 5 videos',
      );
      expect(panelRow('English')).toBe('English 10 median · 15 of 15 videos');
      expect(panelRow('Spanish')).toBe('Spanish 10 median · 5 of 5 videos');

      await medians.screenshot({ path: `${OUT}/medians-by-language.png` });

      writeFileSync(
        `${OUT}/measured.json`,
        JSON.stringify({ content, channel, panel }, null, 2),
      );
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
