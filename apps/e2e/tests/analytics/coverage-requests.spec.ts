import { type Page, type Request, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
 * FILM-1704 — observed coverage is asked for once per window, in the
 * browser.
 *
 * The unit suite proves the provider shares one request among fifteen
 * consumers. This proves the page: every tab visited, Deep Dive's own
 * window, a date range changed and changed back — counted off the wire.
 * A coverage request is told apart from the page's other server actions by
 * its action id.
 */

interface CoverageCall {
  from: string;
  to: string;
  request: Request;
}

/**
 * What a coverage request answers, by sending it again from the page's own
 * signed-in context. Chrome does not reliably keep a streamed server-action
 * body for `response.text()` — it failed with "No data found for resource"
 * or came back empty — so the request is replayed rather than its first
 * response read.
 */
async function answerOf(page: Page, call: CoverageCall) {
  const response = await page.request.post(call.request.url(), {
    headers: await call.request.allHeaders(),
    data: call.request.postData() ?? '',
  });

  return response.text();
}

/**
 * `getCoverageMatrixAction`'s id, from the build the server is serving.
 * Matched on the id rather than the input: the subscriber series action
 * also takes a scope and two calendar days, and was counted as coverage.
 * Counted as requests leave, so a slow server cannot hide one that has not
 * answered yet.
 */
function coverageActionId(): string {
  const manifest = JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../web/.next/server/server-reference-manifest.json',
      ),
      'utf8',
    ),
  ) as { node: Record<string, { exportedName?: string }> };

  const id = Object.entries(manifest.node).find(
    ([, entry]) => entry.exportedName === 'getCoverageMatrixAction',
  )?.[0];

  if (!id) {
    throw new Error('getCoverageMatrixAction is not in the served build');
  }

  return id;
}

function recordCoverage(page: Page) {
  const calls: CoverageCall[] = [];
  const actionId = coverageActionId();

  page.on('request', (request) => {
    if (
      request.method() !== 'POST' ||
      request.headers()['next-action'] !== actionId
    ) {
      return;
    }

    const [input] = JSON.parse(request.postData() ?? '[]') as [
      { from: string; to: string },
    ];

    calls.push({
      from: input.from,
      to: input.to,
      request,
    });
  });

  return calls;
}

const SLOW = { timeout: 60_000 };

async function settled(page: Page) {
  await page.waitForLoadState('networkidle');
}

async function seedAnalyticsProject(page: Page, withChannel: boolean) {
  const team = await seedTeamAccount();
  const project = await seedProject(team);

  if (withChannel) {
    const connectionId = await seedYouTubeConnection(team.accountId);
    const { seasonId } = await seedSeason(project.id);

    await seedPublishedEpisode(project.id, connectionId, {
      title: 'Covered video',
      seasonId,
    });
  }

  await signInAs(page, team);

  return { team, project };
}

const TABS = [
  'overview',
  'content',
  'audience',
  'deep-dive',
  'video-log',
  'language',
] as const;

test.describe('Observed coverage requests (FILM-1704)', () => {
  test('six tabs, every card: one request per window, and a window seen before is not asked again', async ({
    page,
  }) => {
    const coverage = recordCoverage(page);
    const { team, project } = await seedAnalyticsProject(page, true);

    await page.goto(`/home/${team.slug}/studio/${project.slug}/analytics`);
    await expect.poll(() => coverage.length, SLOW).toBe(1);

    const cardsSeen = new Set<string>();

    for (const tab of [...TABS, 'overview', 'deep-dive'] as const) {
      await byTest(page, `analytics-tab-${tab}`).click();
      await expect(byTest(page, `analytics-tab-${tab}`)).toHaveAttribute(
        'data-state',
        'active',
      );
      await settled(page);

      for (const title of await page
        .locator('section[aria-labelledby]:visible h2')
        .allInnerTexts()) {
        cardsSeen.add(`${tab}:${title}`);
      }
    }

    await page.getByRole('tab', { name: 'AI Insights' }).click();
    await settled(page);

    const calls = [...coverage];

    // The header's window, and Deep Dive's own 52 complete weeks. Visiting
    // Deep Dive twice, and every other tab, adds nothing.
    expect(calls).toHaveLength(2);
    expect(cardsSeen.size).toBeGreaterThan(10);

    const [header, deepDive] = calls;
    const spanDays = (call: CoverageCall) =>
      (Date.parse(call.to) - Date.parse(call.from)) / 86_400_000;

    expect(spanDays(header!)).toBe(30);
    expect(spanDays(deepDive!)).toBe(52 * 7 - 1);
    expect(new Date(`${deepDive!.to}T00:00:00Z`).getUTCDay()).toBe(6);

    // A different range asks once; going back to one already seen does not.
    await byTest(page, 'analytics-tab-overview').click();

    const picker = page.locator('button:has(svg.lucide-calendar)');

    const windows = () => coverage.map((call) => `${call.from}..${call.to}`);

    // Each new range is asked about once; the range seen before is not.
    for (const [preset, expected] of [
      ['Last 7 days', 3],
      ['Last 90 days', 4],
      ['Last 7 days', 4],
    ] as const) {
      await picker.click();
      await page.getByRole('button', { name: preset, exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(picker).toContainText(' - ');
      await expect
        .poll(windows, { ...SLOW, message: `after "${preset}"` })
        .toHaveLength(expected);
      await settled(page);
    }

    const afterRanges = [...coverage];

    expect(afterRanges).toHaveLength(4);
    expect(spanDays(afterRanges[2]!)).toBe(6);
    expect(spanDays(afterRanges[3]!)).toBe(89);

    test.info().annotations.push({
      type: 'measured',
      description: `${cardsSeen.size} cards across ${TABS.length} tabs; ${afterRanges.length} coverage requests (2 windows on load, 2 new ranges, 1 revisited range served from cache)`,
    });
  });

  test('a project with no connections reads as not connected, and every tab still renders', async ({
    page,
  }) => {
    const coverage = recordCoverage(page);
    const { team, project } = await seedAnalyticsProject(page, false);

    await page.goto(`/home/${team.slug}/studio/${project.slug}/analytics`);
    await expect.poll(() => coverage.length, SLOW).toBe(1);

    const body = await answerOf(page, coverage[0]!);

    expect(body).toContain('"kind":"not_connected"');
    expect(body).not.toContain('"kind":"covered"');
    expect(body).not.toContain('"kind":"no_data_in_window"');

    for (const tab of TABS) {
      await byTest(page, `analytics-tab-${tab}`).click();
      await expect(byTest(page, `analytics-tab-${tab}`)).toHaveAttribute(
        'data-state',
        'active',
      );
    }

    await byTest(page, 'analytics-tab-deep-dive').click();
    await expect(byTest(page, 'deep-dive-tab')).toBeVisible();
    await expect(page.getByText('Application error')).toHaveCount(0);
  });
});
