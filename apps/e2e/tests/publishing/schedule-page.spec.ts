import { type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import {
  type SeededTeam,
  addProjectChannels,
  insertRow,
  readRows,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  seedYouTubeConnection,
  serviceRoleAuth,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest, visible } from '../utils/visible';

/**
 * FILM-2211. A project's Schedule page, from its left nav: every post,
 * published and scheduled, in the viewer's timezone, filtered by type,
 * platform and status in the URL; a scheduled post cancelled from the
 * table; and a channel's posting rules edited without opening an episode,
 * from the page and from Settings → Platforms.
 *
 * Seeded through the API against the real database, so the calendar read,
 * RLS and the cadence table all apply. Nothing reaches a platform.
 */

const TZ = 'Asia/Kolkata';
test.use({ timezoneId: TZ, viewport: { width: 1440, height: 1200 } });

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const HOUR = 3600 * 1000;

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          animation.effect?.getTiming().iterations === Infinity,
      ),
  );
  await page.screenshot({ path: `${OUT}/schedule-page-${name}.png` });
}

/**
 * How the page writes a time: the viewer's zone, 24-hour. Formatted in the
 * browser, whose ICU punctuates differently from Node's.
 */
const shown = (page: Page, iso: string) =>
  page.evaluate(
    ([value, timeZone]) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value)),
    [iso, TZ] as const,
  );

const at = (hoursFromNow: number) =>
  new Date(
    // On the minute, as a slot is
    Math.floor((Date.now() + hoursFromNow * HOUR) / 60_000) * 60_000,
  ).toISOString();

async function seedSchedule(team: SeededTeam) {
  const yt = await seedYouTubeConnection(team.accountId, 'Story YT', {
    platformAccountId: `yt-schedule-${team.accountId.slice(0, 8)}`,
  });
  const ig = await seedYouTubeConnection(team.accountId, 'Story IG', {
    platform: 'instagram',
    platformAccountId: `ig-schedule-${team.accountId.slice(0, 8)}`,
  });
  const project = await seedProject(team, { name: 'Schedule page' });
  await addProjectChannels(project.id, [yt, ig]);

  const ep1 = await seedEpisodeWithShot(project.id, { number: 1 });
  const ep2 = await seedEpisodeWithShot(project.id, { number: 2 });
  await updateRows('episodes', `id=eq.${ep1.episodeId}`, {
    title: 'The Unicorn Ledger',
  });
  await updateRows('episodes', `id=eq.${ep2.episodeId}`, {
    title: 'Breaking: the vote',
  });

  const publish = (row: Record<string, unknown>) =>
    insertRow<{ id: string }>('publishes', row, serviceRoleAuth());

  const times = {
    published: at(-48),
    failed: at(-24),
    scheduled: at(26),
    breaking: at(72),
  };

  const posts = {
    published: await publish({
      episode_id: ep1.episodeId,
      platform_connection_id: yt,
      platform: 'youtube',
      content_type: 'full',
      status: 'published',
      title: 'The Unicorn Ledger (full)',
      published_at: times.published,
      platform_url: 'https://www.youtube.com/watch?v=sched1',
    }),
    failed: await publish({
      episode_id: ep1.episodeId,
      platform_connection_id: ig,
      platform: 'instagram',
      content_type: 'short',
      status: 'failed',
      title: 'Ledger Reel 1',
      scheduled_at: times.failed,
      metadata: { error: 'Instagram refused the video: longer than 90 s' },
    }),
    scheduled: await publish({
      episode_id: ep1.episodeId,
      platform_connection_id: yt,
      platform: 'youtube',
      content_type: 'short',
      status: 'scheduled',
      title: 'Ledger Short 2',
      scheduled_at: times.scheduled,
      slot_at: times.scheduled,
    }),
    held: await publish({
      episode_id: ep1.episodeId,
      platform_connection_id: ig,
      platform: 'instagram',
      content_type: 'short',
      status: 'draft',
      title: 'Ledger Reel 3',
      metadata: { heldReason: 'The next episode went out first' },
    }),
    breaking: await publish({
      episode_id: ep2.episodeId,
      platform_connection_id: yt,
      platform: 'youtube',
      content_type: 'full',
      status: 'scheduled',
      title: 'Breaking: the vote (full)',
      scheduled_at: times.breaking,
      slot_at: times.breaking,
      release_priority: 'breaking',
    }),
  };

  return { yt, ig, project, ep1, times, posts };
}

const rows = (page: Page) => byTest(page, 'schedule-row');

async function rowIds(page: Page) {
  return rows(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-publish-id')),
  );
}

async function choose(page: Page, filter: string, option: string) {
  await byTest(page, filter).click();
  await visible(page, '[role="option"]')
    .getByText(option, { exact: true })
    .click();
}

/** Saves the open posting-rules form and waits for the dialog to close */
async function saveRules(page: Page) {
  const save = byTest(page, 'cadence-save');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(byTest(page, 'channel-cadence-dialog')).toBeHidden({
    timeout: 15_000,
  });
}

function summaryOf(page: Page, connectionId: string) {
  return visible(
    page,
    `[data-test="posting-rules-channel"][data-connection-id="${connectionId}"] [data-test="posting-rules-summary"]`,
  );
}

test.describe('The Schedule page', () => {
  test('lists every post in the viewer’s time, filters by type, platform and status, and cancels a scheduled post', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const team = await seedTeamAccount({ emailPrefix: 'schedule' });
    const { project, ep1, times, posts } = await seedSchedule(team);

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/${project.slug}`);

    // --- From the left nav
    await byTest(page, 'studio-nav-schedule').click();
    await page.waitForURL(`**/studio/${project.slug}/schedule`);
    await expect(byTest(page, 'schedule-table')).toBeVisible({
      timeout: 60_000,
    });

    // In time order, the held Short (no time) last
    await expect(rows(page)).toHaveCount(5);
    expect(await rowIds(page)).toEqual([
      posts.published.id,
      posts.failed.id,
      posts.scheduled.id,
      posts.breaking.id,
      posts.held.id,
    ]);

    const row = (id: string) =>
      visible(page, `[data-test="schedule-row"][data-publish-id="${id}"]`);

    // Times in the viewer's zone, which the header names
    // Chromium names Asia/Kolkata by its older alias: ask the browser
    const zone = await page.evaluate(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    await expect(byTest(page, 'schedule-when')).toHaveText(`When (${zone})`);
    await expect(
      row(posts.scheduled.id).locator('[data-test="schedule-row-time"]'),
    ).toHaveText(await shown(page, times.scheduled));
    await expect(
      row(posts.published.id).locator('[data-test="schedule-row-time"]'),
    ).toHaveText(await shown(page, times.published));

    // Each status reads as itself, with its link, reason or badge
    const published = row(posts.published.id);
    await expect(
      published.locator('[data-test="schedule-row-status"]'),
    ).toHaveText('Published');
    await expect(
      published.locator('[data-test="schedule-row-link"]'),
    ).toHaveAttribute('href', 'https://www.youtube.com/watch?v=sched1');
    await expect(
      row(posts.failed.id).locator('[data-test="schedule-row-reason"]'),
    ).toHaveText('Instagram refused the video: longer than 90 s');
    await expect(
      row(posts.held.id).locator('[data-test="schedule-row-status"]'),
    ).toHaveText('Held');
    await expect(
      row(posts.held.id).locator('[data-test="schedule-row-reason"]'),
    ).toHaveText('The next episode went out first');
    await expect(
      row(posts.breaking.id).locator('[data-test="schedule-row-breaking"]'),
    ).toBeVisible();
    await expect(
      row(posts.scheduled.id).locator('[data-test="schedule-row-episode"]'),
    ).toHaveAttribute(
      'href',
      `/home/${team.slug}/studio/${project.slug}/episodes/${ep1.slug}/publish`,
    );
    await capture(page, '01-all-posts');

    // --- Shorts only
    await byTest(page, 'schedule-type-short').click();
    await page.waitForURL(/[?&]type=short/);
    await expect(rows(page)).toHaveCount(3);
    expect(await rowIds(page)).toEqual([
      posts.failed.id,
      posts.scheduled.id,
      posts.held.id,
    ]);

    // --- Shorts on Instagram
    await choose(page, 'schedule-filter-platform', 'Instagram');
    await page.waitForURL(/[?&]platform=instagram/);
    await expect(rows(page)).toHaveCount(2);
    expect(await rowIds(page)).toEqual([posts.failed.id, posts.held.id]);
    await capture(page, '02-shorts-on-instagram');

    // --- Failed, on any platform, any type
    await choose(page, 'schedule-filter-platform', 'All platforms');
    await byTest(page, 'schedule-type-all').click();
    await choose(page, 'schedule-filter-status', 'Failed');
    await page.waitForURL(/[?&]status=failed/);
    await expect(rows(page)).toHaveCount(1);
    expect(await rowIds(page)).toEqual([posts.failed.id]);
    expect(new URL(page.url()).searchParams.get('type')).toBeNull();
    expect(new URL(page.url()).searchParams.get('platform')).toBeNull();

    // --- Nothing matches: an empty state, not an empty table
    await choose(page, 'schedule-filter-status', 'Publishing');
    await expect(byTest(page, 'schedule-empty')).toBeVisible();

    // --- Cancel the scheduled Short
    await choose(page, 'schedule-filter-status', 'All statuses');
    await expect(rows(page)).toHaveCount(5);
    await row(posts.scheduled.id)
      .locator('[data-test="schedule-row-cancel"]')
      .click();
    await expect(byTest(page, 'schedule-confirm')).toBeVisible();
    await capture(page, '03-cancel-confirm');
    const confirm = byTest(page, 'schedule-confirm-action');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(row(posts.scheduled.id)).toHaveCount(0, { timeout: 15_000 });
    await expect(rows(page)).toHaveCount(4);
    expect(
      await readRows('publishes', `id=eq.${posts.scheduled.id}&select=id`),
    ).toEqual([]);

    // --- Discard the held Short
    await row(posts.held.id)
      .locator('[data-test="schedule-row-discard"]')
      .click();
    const discard = byTest(page, 'schedule-confirm-action');
    await expect(discard).toBeEnabled();
    await discard.click();
    await expect(row(posts.held.id)).toHaveCount(0, { timeout: 15_000 });
    expect(
      await readRows('publishes', `id=eq.${posts.held.id}&select=id`),
    ).toEqual([]);
    await capture(page, '04-after-cancel-and-discard');
  });

  test('edits a channel’s posting rules from the Schedule page and from Settings → Platforms, without opening an episode', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const team = await seedTeamAccount({ emailPrefix: 'schedule-rules' });
    const { yt, ig, project } = await seedSchedule(team);

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/${project.slug}/schedule`);
    await expect(byTest(page, 'posting-rules-section')).toBeVisible({
      timeout: 60_000,
    });

    // Both channels, on the defaults
    await expect(byTest(page, 'posting-rules-channel')).toHaveCount(2);
    await expect(summaryOf(page, yt)).toHaveText(
      'Long 17:00 every 3 days (default) · Shorts 18:00 daily, from 2 h after (default)',
    );

    // --- From the Schedule page: YouTube's Shorts at 11:00 and 17:00
    await visible(
      page,
      `[data-test="posting-rules-channel"][data-connection-id="${yt}"] [data-test="posting-rules-edit"]`,
    ).click();
    await expect(byTest(page, 'channel-cadence-dialog')).toBeVisible();
    await expect(byTest(page, 'channel-cadence-scope')).toContainText(
      'every project and episode that posts to Story YT',
    );
    const times = byTest(page, 'cadence-slot-time');
    await times.first().fill('11:00');
    await byTest(page, 'cadence-slot-add').click();
    await times.nth(1).fill('17:00');
    await byTest(page, 'cadence-timezone').fill(TZ);
    await capture(page, '05-rules-dialog-from-schedule');
    await saveRules(page);

    await expect(summaryOf(page, yt)).toHaveText(
      `Long 17:00 every 3 days (default) · Shorts 11:00, 17:00 daily, from 2 h after (${TZ})`,
    );
    await capture(page, '06-rules-after-save');

    // --- From Settings → Platforms: Instagram's long videos at 20:00, every 2 days
    await page.goto(`/home/${team.slug}/settings/platforms`);
    const igRow = visible(
      page,
      `[data-test="connection-row"][data-connection-id="${ig}"]`,
    );
    const open = igRow.locator('[data-test="connection-posting-rules"]');
    await expect(open).toBeEnabled({ timeout: 60_000 });
    await igRow.scrollIntoViewIfNeeded();
    await capture(page, '07-settings-platforms-posting-rules-button');
    await open.click();
    await expect(byTest(page, 'channel-cadence-dialog')).toBeVisible();
    await expect(byTest(page, 'channel-cadence-scope')).toContainText(
      'every project and episode that posts to Story IG',
    );
    await byTest(page, 'cadence-tab-full').click();
    await expect(
      visible(
        page,
        '[data-test="channel-cadence-form"][data-content-type="full"]',
      ),
    ).toBeVisible();
    await byTest(page, 'cadence-slot-time').first().fill('20:00');
    await byTest(page, 'cadence-min-days-between').fill('2');
    await byTest(page, 'cadence-timezone').fill(TZ);
    await capture(page, '08-rules-dialog-from-settings');
    await saveRules(page);

    const [saved] = await readRows<{
      slot_times: string[];
      min_days_between: number;
    }>(
      'channel_posting_cadences',
      `platform_connection_id=eq.${ig}&content_type=eq.full&select=slot_times,min_days_between`,
    );
    expect(saved).toEqual({ slot_times: ['20:00'], min_days_between: 2 });

    // The Schedule page reads the same rules
    await page.goto(`/home/${team.slug}/studio/${project.slug}/schedule`);
    await expect(summaryOf(page, ig)).toHaveText(
      `Long 20:00 every 2 days (${TZ}) · Shorts 18:00 daily, from 2 h after (default)`,
      { timeout: 60_000 },
    );
    await capture(page, '09-schedule-after-settings-save');
  });
});
