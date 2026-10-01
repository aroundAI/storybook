import { Locator, Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

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
 * KB-146 — the Language tab's two chart tooltips paint a background.
 *
 * Both styled themselves `hsl(var(--popover))` / `hsl(var(--card))`. The
 * tokens are full colours, so that is `hsl(#161616)`: invalid at computed
 * time, and the background fell back to transparent and the border to none,
 * leaving the tooltip text over the chart lines. Only a browser resolves
 * that, so only a browser can check it.
 *
 * Needs figures on the page, so ClickHouse: two languages, three days.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const RELOADED = { timeout: 90_000 };
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

const TOOLTIPS = [
  { card: 'language-trend-chart', token: 'popover', name: 'trend' },
  { card: 'language-comparison-chart', token: 'card', name: 'comparison' },
] as const;

async function seedTwoLanguages(fixture: LanguageTabFixture) {
  const dims: object[] = [];
  const metrics: object[] = [];

  for (const language of ['en', 'es']) {
    for (let index = 0; index < 3; index++) {
      const videoId = crypto.randomUUID();

      dims.push({
        video_id: videoId,
        project_id: fixture.project.id,
        account_id: fixture.team.accountId,
        connection_id: '00000000-0000-0000-0000-000000000000',
        episode_id: '00000000-0000-0000-0000-000000000000',
        platform: 'youtube',
        content_type: 'full',
        language,
        channel_language: language,
        title: `${language} ${index + 1}`,
        published_at: clickHouseDateTime(daysAgo(20)),
        duration_seconds: 600,
        tags: [],
        updated_at: clickHouseDateTime(new Date()),
      });

      for (const day of [10, 9, 8]) {
        metrics.push({
          project_id: fixture.project.id,
          video_id: videoId,
          platform: 'youtube',
          metric_date: clickHouseDate(daysAgo(day)),
          views: language === 'en' ? 120 : 80,
          likes: 0,
          comments: 0,
          shares: 0,
          saves: 0,
          watch_time_seconds: 600,
          revenue_cents: 0,
          subscribers_gained: 0,
          avg_view_duration_seconds: 120,
          avg_view_percentage: 40,
          dislikes: 0,
        });
      }
    }
  }

  await insertClickHouse('video_dim', dims);
  await insertClickHouse('video_metrics', metrics);
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((value) => localStorage.setItem('theme', value), theme);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(
    theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/,
  );
}

/** Hovers the plot until Recharts shows its tooltip, and returns it. */
async function showTooltip(card: Locator) {
  const plot = card.locator('.recharts-wrapper');
  const tooltip = card.locator('.recharts-default-tooltip');

  await plot.scrollIntoViewIfNeeded();
  const box = (await plot.boundingBox())!;

  // Recharts animates its marks in on mount; a screenshot taken mid-way
  // shows a half-drawn chart. Settled is the first mark's shape holding
  // still between two polls.
  const mark = plot.locator('.recharts-area-area, .recharts-rectangle').first();
  let last: string | null = null;

  await expect
    .poll(async () => {
      const shape = await mark.getAttribute('d');
      const settled = shape !== null && shape === last;

      last = shape;
      return settled;
    })
    .toBe(true);

  await expect(async () => {
    await plot.hover({ position: { x: box.width / 2, y: box.height / 3 } });
    await expect(tooltip).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  return tooltip;
}

/** The tooltip's paint, and the token's own value resolved by a probe. */
function paint(tooltip: Locator, token: string) {
  return tooltip.evaluate((element, name) => {
    const probe = document.createElement('div');

    probe.style.backgroundColor = `var(--${name})`;
    probe.style.borderColor = 'var(--border)';
    document.body.appendChild(probe);

    const want = getComputedStyle(probe);
    const got = getComputedStyle(element);
    const result = {
      background: got.backgroundColor,
      borderWidth: got.borderTopWidth,
      borderColor: got.borderTopColor,
      tokenBackground: want.backgroundColor,
      tokenBorder: want.borderTopColor,
    };

    probe.remove();

    return result;
  }, token);
}

test.describe('KB-146 — chart tooltips paint with the theme', () => {
  test.skip(
    !process.env.CLICKHOUSE_EVIDENCE,
    'Set CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  test.describe.configure({ timeout: 180_000 });

  test('the trend and comparison tooltips have a background and a border, light and dark', async ({
    page,
  }) => {
    const tab = new LanguageTabPageObject(page);
    const fixture = await tab.setup();

    await seedTwoLanguages(fixture);

    if (process.env.CAPTURE_EVIDENCE) mkdirSync(OUT, { recursive: true });

    const backgrounds: string[] = [];

    try {
      for (const theme of ['light', 'dark'] as const) {
        await tab.open(fixture.team.slug, fixture.project.slug);
        await setTheme(page, theme);
        await tab.open(fixture.team.slug, fixture.project.slug);

        for (const { card, token, name } of TOOLTIPS) {
          const chart = byTest(page, card);

          await expect(chart).toBeVisible(RELOADED);

          const tooltip = await showTooltip(chart);
          const style = await paint(tooltip, token);

          expect
            .soft(style.background, `${name}, ${theme}`)
            .not.toBe(TRANSPARENT);
          expect
            .soft(style.background, `${name}, ${theme}`)
            .toBe(style.tokenBackground);
          expect.soft(style.borderWidth, `${name}, ${theme}`).toBe('1px');
          expect
            .soft(style.borderColor, `${name}, ${theme}`)
            .toBe(style.tokenBorder);

          if (name === 'trend') backgrounds.push(style.background);

          if (process.env.CAPTURE_EVIDENCE) {
            await chart.screenshot({ path: `${OUT}/${name}-${theme}.png` });
          }
        }
      }

      // Otherwise "equal to the token" could be two themes resolving alike.
      expect(backgrounds[1]).not.toBe(backgrounds[0]);
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
