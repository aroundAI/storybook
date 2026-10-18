import { type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import { encryptLikeTheApp } from '../utils/crypto';
import {
  type SeededTeam,
  addProjectChannels,
  episodeVideoUrl,
  readRows,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  seedYouTubeConnection,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest, visible } from '../utils/visible';

/**
 * FILM-719, FILM-2209. A release is scheduled on its channel's posting
 * cadence: the long video in the channel's next free slot, and its Shorts
 * at the end of the channel's one Shorts queue, oldest episode first
 * (owner, 2026-10-18). The second episode leaves the first one's Shorts
 * where they were and queues its own after them; a Short an older release
 * held goes back on at the end of the queue.
 *
 * Driven through the Publish screen against the real database, so the
 * planner, the slot index and RLS all apply. Nothing reaches a platform:
 * a scheduled publish is a row until the scheduled job runs.
 */

test.skip(
  !process.env.ENCRYPTION_KEY,
  'Seeds a channel token the server decrypts: needs the server’s ENCRYPTION_KEY',
);

const TZ = 'Asia/Kolkata';
// Tall enough that the Schedule Release card is captured whole
test.use({ timezoneId: TZ, viewport: { width: 1280, height: 2000 } });

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

/** The page, or with `panel` just the Schedule Release card */
async function capture(page: Page, name: string, panel = false) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  // A spinner never finishes: wait for every other animation
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          animation.effect?.getTiming().iterations === Infinity,
      ),
  );
  const path = `${OUT}/cadence-release-${name}.png`;

  if (panel) {
    await byTest(page, 'schedule-release-panel').screenshot({ path });
  } else {
    await page.screenshot({ path });
  }
}

const IN_A_DAY = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString();

const dayOf = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));

async function youtubeChannel(team: SeededTeam) {
  const id = await seedYouTubeConnection(team.accountId, 'Story YT EN', {
    platformAccountId: `yt-cadence-${team.accountId.slice(0, 8)}`,
    accessTokenEncrypted: await encryptLikeTheApp('youtube-token'),
  });

  await updateRows('platform_connections', `id=eq.${id}`, {
    language: 'en',
    token_expires_at: IN_A_DAY(),
    youtube_made_for_kids: false,
    youtube_category_id: '22',
  });

  return id;
}

async function episodeWithShorts(projectId: string, number: number) {
  const episode = await seedEpisodeWithShot(projectId, { number });
  const video = episodeVideoUrl(episode.episodeId, 'en');

  await updateRows('episodes', `id=eq.${episode.episodeId}`, {
    title: `Episode ${number}`,
    localized_videos: { en: video },
    shorts_groups: [1, 2, 3, 4].map((n) => ({
      id: `ep${number}-short-${n}`,
      name: `Short ${n}`,
      title: `Episode ${number}, Short ${n}`,
      description: '',
      tags: [],
      platforms: ['youtube'],
      videos: { en: video },
    })),
  });

  return episode;
}

interface PublishRow {
  id: string;
  episode_id: string;
  content_type: string;
  status: string;
  slot_at: string | null;
  scheduled_at: string | null;
  after_episode_full: boolean;
  metadata: { heldReason?: string; heldBefore?: string; createdVia?: string };
}

function publishesOn(connectionId: string) {
  return readRows<PublishRow>(
    'publishes',
    `platform_connection_id=eq.${connectionId}&select=id,episode_id,content_type,status,slot_at,scheduled_at,after_episode_full,metadata&order=slot_at.nullslast`,
  );
}

async function pickToday(page: Page) {
  await byTest(page, 'release-date').click();
  const today = await page.evaluate(() => {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
  });
  await page.click(`[role="gridcell"][data-day="${today}"] button`);
  await expect(page.locator('[role="gridcell"]').first()).toBeHidden();
}

/** A server action's body that reads the project's channels */
function readsChannels(body: string | null) {
  try {
    const [args] = JSON.parse(body ?? '') as [Record<string, unknown>];
    return Object.keys(args).sort().join() === 'accountId,projectId';
  } catch {
    return false;
  }
}

/** KB-198: the check waits for the project's channels, then runs */
async function checkCalendar(page: Page) {
  const check = byTest(page, 'release-check-calendar');
  await expect(check).toBeEnabled({ timeout: 30_000 });
  await check.click();
}

async function calendarDays(page: Page) {
  const posts = byTest(page, 'release-calendar-post');
  const keys = await posts.evaluateAll((nodes) =>
    nodes.map((node) => ({
      key: node.getAttribute('data-key') ?? '',
      at: node.getAttribute('data-scheduled-at') ?? '',
    })),
  );

  return keys;
}

function perDay(dates: string[]) {
  const counts = new Map<string, number>();
  for (const date of dates) {
    counts.set(dayOf(date), (counts.get(dayOf(date)) ?? 0) + 1);
  }
  return counts;
}

async function openPublish(page: Page, team: SeededTeam, path: string) {
  await page.goto(`/home/${team.slug}/studio/${path}/publish`);
  await expect(byTest(page, 'release-mode-cadence')).toBeVisible({
    timeout: 60_000,
  });
}

test.describe('A release follows its channel’s posting cadence', () => {
  test('Shorts every N days after the long video, the next episode’s queued after them, a held one re-queued to the end of the queue', async ({
    page,
  }) => {
    test.setTimeout(240_000);

    const team = await seedTeamAccount({ emailPrefix: 'cadence' });
    const yt = await youtubeChannel(team);
    const project = await seedProject(team, { name: 'Cadence release' });
    await addProjectChannels(project.id, [yt]);
    const ep1 = await episodeWithShorts(project.id, 1);
    const ep2 = await episodeWithShorts(project.id, 2);

    await signInAs(page, team);
    await openPublish(page, team, `${project.slug}/episodes/${ep1.slug}`);

    // --- Following the channel's cadence is the default
    await expect(byTest(page, 'release-mode-cadence')).toHaveAttribute(
      'data-state',
      'active',
    );

    await pickToday(page);
    await checkCalendar(page);
    await expect(byTest(page, 'release-calendar-post')).toHaveCount(5, {
      timeout: 30_000,
    });

    // The defaults: one Short a day, every one after the long video
    let posts = await calendarDays(page);
    const full = posts.find((p) => p.key.startsWith('full-'))!;
    const shorts = posts.filter((p) => p.key.startsWith('group-'));
    expect(shorts).toHaveLength(4);
    expect([...perDay(shorts.map((s) => s.at)).values()]).toEqual([1, 1, 1, 1]);
    for (const short of shorts) expect(short.at > full.at).toBe(true);
    await capture(page, '01-default-cadence', true);

    // --- Two Shorts a day, every 2 days: the posting rules, saved
    await byTest(page, 'release-calendar-edit-channel').click();
    const dialog = visible(page, '[data-test="channel-cadence-dialog"]');
    await expect(byTest(dialog, 'cadence-slot-time')).toHaveCount(1);
    await expect(byTest(dialog, 'cadence-every-n-days')).toHaveValue('1');
    await expect(byTest(dialog, 'cadence-per-day')).toHaveText(
      '1 Short a day, at these times.',
    );
    await byTest(dialog, 'cadence-slot-add').click();
    await byTest(dialog, 'cadence-slot-time').nth(1).fill('10:00');
    await byTest(dialog, 'cadence-every-n-days').fill('2');
    await expect(byTest(dialog, 'cadence-per-day')).toHaveText(
      '2 Shorts a day, at these times.',
    );
    await capture(page, '02-posting-rules');
    await byTest(dialog, 'cadence-save').click();
    await expect(dialog).toBeHidden();

    const shortRules = async () =>
      (
        await readRows<{ slot_times: string[]; every_n_days: number }>(
          'channel_posting_cadences',
          `platform_connection_id=eq.${yt}&content_type=eq.short&select=slot_times,every_n_days`,
        )
      )[0];

    await expect
      .poll(shortRules)
      .toEqual({ slot_times: ['10:00', '18:00'], every_n_days: 2 });

    await checkCalendar(page);
    const shortDays = async () =>
      perDay(
        (await calendarDays(page))
          .filter((p) => p.key.startsWith('group-'))
          .map((p) => p.at),
      );
    await expect
      .poll(async () => [...(await shortDays()).values()])
      .toEqual([2, 2]);
    const [firstDay, secondDay] = [...(await shortDays()).keys()];
    expect((Date.parse(secondDay!) - Date.parse(firstDay!)) / 86_400_000).toBe(
      2,
    );
    await capture(page, '03-two-a-day-every-2-days', true);

    // --- The second save: back to one a day, every day. The dialog opens
    //     on what was saved, not on the defaults.
    await byTest(page, 'release-calendar-edit-channel').click();
    await expect(byTest(dialog, 'cadence-slot-time')).toHaveCount(2);
    await expect(byTest(dialog, 'cadence-slot-time').first()).toHaveValue(
      '10:00',
    );
    await expect(byTest(dialog, 'cadence-every-n-days')).toHaveValue('2');
    await capture(page, '03b-posting-rules-after-save');
    await byTest(dialog, 'cadence-slot-remove').first().click();
    await byTest(dialog, 'cadence-every-n-days').fill('1');
    await byTest(dialog, 'cadence-save').click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(shortRules)
      .toEqual({ slot_times: ['18:00'], every_n_days: 1 });

    await checkCalendar(page);
    await expect
      .poll(async () =>
        Math.max(
          ...perDay(
            (await calendarDays(page))
              .filter((p) => p.key.startsWith('group-'))
              .map((p) => p.at),
          ).values(),
        ),
      )
      .toBe(1);

    // --- Episode 1 is scheduled where the calendar said
    await byTest(page, 'release-schedule').click();
    await expect
      .poll(async () => (await publishesOn(yt)).length, { timeout: 30_000 })
      .toBe(5);

    const ep1Rows = await publishesOn(yt);
    const ep1Full = ep1Rows.find((r) => r.content_type === 'full')!;
    const ep1Shorts = ep1Rows.filter((r) => r.content_type === 'short');

    expect(ep1Rows.every((r) => r.status === 'scheduled')).toBe(true);
    expect(ep1Rows.every((r) => r.slot_at)).toBe(true);
    expect(ep1Rows.every((r) => r.metadata.createdVia === 'cadence')).toBe(
      true,
    );
    expect(ep1Shorts.every((r) => r.after_episode_full)).toBe(true);
    expect(ep1Shorts.every((r) => r.slot_at! > ep1Full.slot_at!)).toBe(true);
    expect([...perDay(ep1Shorts.map((r) => r.slot_at!)).values()]).toEqual([
      1, 1, 1, 1,
    ]);
    await capture(page, '04-episode-1-scheduled');

    // --- Episode 2: its Shorts queue after episode 1's, which stay put
    await openPublish(page, team, `${project.slug}/episodes/${ep2.slug}`);
    await pickToday(page);
    await checkCalendar(page);
    const queue = byTest(page, 'release-calendar-shorts-queue');
    await expect(queue).toBeVisible({ timeout: 30_000 });
    await expect(queue).toHaveAttribute('data-queued', '8');
    await expect(byTest(page, 'release-calendar-displaced')).toHaveCount(0);
    posts = await calendarDays(page);
    const ep2PlannedFull = posts.find((p) => p.key.startsWith('full-'))!;

    // Three days after episode 1's, at the earliest
    expect(
      new Date(ep2PlannedFull.at).getTime() -
        new Date(ep1Full.slot_at!).getTime(),
    ).toBeGreaterThanOrEqual(3 * 86_400_000 - 20 * 60_000);
    await capture(page, '05-episode-2-preview', true);

    await byTest(page, 'release-schedule').click();
    await expect
      .poll(
        async () =>
          (await publishesOn(yt)).filter((r) => r.episode_id === ep2.episodeId)
            .length,
        { timeout: 30_000 },
      )
      .toBe(5);

    const afterEp2 = await publishesOn(yt);
    const ep2Full = afterEp2.find(
      (r) => r.episode_id === ep2.episodeId && r.content_type === 'full',
    )!;
    const ep2Shorts = afterEp2.filter(
      (r) => r.episode_id === ep2.episodeId && r.content_type === 'short',
    );
    const ep1ShortsAfter = afterEp2.filter(
      (r) => r.episode_id === ep1.episodeId && r.content_type === 'short',
    );
    const lastEp1Short = ep1Shorts
      .map((r) => r.slot_at!)
      .sort()
      .at(-1)!;

    // Nothing is held, and episode 1's Shorts are where they were
    expect(afterEp2.filter((r) => r.status === 'draft')).toEqual([]);
    expect(
      ep1ShortsAfter.map((r) => [r.id, r.status, r.slot_at]).sort(),
    ).toEqual(ep1Shorts.map((r) => [r.id, r.status, r.slot_at]).sort());

    // Episode 2's Shorts go after its long video and after episode 1's
    for (const short of ep2Shorts) {
      expect(short.slot_at! > ep2Full.slot_at!).toBe(true);
      expect(short.slot_at! > lastEp1Short).toBe(true);
    }
    // Never two Shorts on one day, whichever episode
    expect(
      Math.max(
        ...perDay(
          afterEp2
            .filter((r) => r.content_type === 'short')
            .map((r) => r.slot_at!),
        ).values(),
      ),
    ).toBe(1);
    await capture(page, '06-episode-2-scheduled');

    // --- A Short an older release held (FILM-719) goes back on at the end
    //     of the queue, not into the day it left
    const held = [...ep1Shorts].sort((a, b) =>
      a.slot_at!.localeCompare(b.slot_at!),
    )[1]!;
    await updateRows('publishes', `id=eq.${held.id}`, {
      status: 'draft',
      slot_at: null,
      scheduled_at: null,
      metadata: {
        ...held.metadata,
        heldReason: 'next-episode',
        heldBefore: ep2Full.slot_at,
      },
    });

    await openPublish(page, team, `${project.slug}/episodes/${ep1.slug}`);
    await expect(byTest(page, 'published-content-held')).toHaveCount(1, {
      timeout: 30_000,
    });
    await byTest(page, 'published-content-held').scrollIntoViewIfNeeded();
    await capture(page, '07-legacy-held-on-episode-1');

    await byTest(page, 'held-requeue').click();
    await expect
      .poll(
        async () =>
          (await publishesOn(yt)).filter((r) => r.status === 'draft').length,
        { timeout: 30_000 },
      )
      .toBe(0);

    const requeued = (await publishesOn(yt)).find((r) => r.id === held.id)!;
    const lastEp2Short = ep2Shorts
      .map((r) => r.slot_at!)
      .sort()
      .at(-1)!;

    expect(requeued.status).toBe('scheduled');
    expect(requeued.slot_at! > lastEp2Short).toBe(true);
    expect(requeued.metadata.heldReason).toBeUndefined();
    await expect(byTest(page, 'published-content-held')).toHaveCount(0);
    await capture(page, '08-requeued');
  });

  test('the calendar check and the breaking preview wait for the project’s channels (KB-198)', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const team = await seedTeamAccount({ emailPrefix: 'cadwait' });
    const yt = await youtubeChannel(team);
    const project = await seedProject(team, { name: 'Cadence wait' });
    await addProjectChannels(project.id, [yt]);
    const ep = await episodeWithShorts(project.id, 1);

    await signInAs(page, team);

    // The project's channels are read by a server action called with
    // exactly { accountId, projectId }: hold it until the buttons have been
    // seen waiting for it
    let releaseChannels = () => {};
    const channelsHeld = new Promise<void>((resolve) => {
      releaseChannels = resolve;
    });
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.headers()['next-action'] && readsChannels(request.postData()))
        await channelsHeld;
      await route.fallback();
    });

    await openPublish(page, team, `${project.slug}/episodes/${ep.slug}`);
    await pickToday(page);

    const check = byTest(page, 'release-check-calendar');
    await expect(check).toBeDisabled();
    await expect(check).toHaveAttribute('data-loading', 'true');
    await expect(check).toHaveText('Loading channels…');
    await capture(page, 'kb198-01-check-waits-for-channels', true);

    await byTest(page, 'release-mode-breaking').click();
    const preview = byTest(page, 'breaking-preview');
    await expect(preview).toBeDisabled();
    await expect(preview).toHaveAttribute('data-loading', 'true');
    await capture(page, 'kb198-02-preview-waits-for-channels', true);

    releaseChannels();

    await expect(preview).toBeEnabled({ timeout: 30_000 });
    await expect(preview).not.toHaveAttribute('data-loading');
    await expect(preview).toHaveText('Preview breaking release');
    await capture(page, 'kb198-03-preview-ready', true);

    await byTest(page, 'release-mode-cadence').click();
    await expect(check).toBeEnabled();
    await expect(check).toHaveText('Check channel calendars');
    await capture(page, 'kb198-04-check-ready', true);

    // The first click is answered with the calendar, not "still loading"
    await check.click();
    await expect(byTest(page, 'release-calendar-post')).toHaveCount(5, {
      timeout: 30_000,
    });
    await expect(byTest(page, 'release-calendar-error')).toHaveCount(0);
    await capture(page, 'kb198-05-first-click-answered', true);
  });

  test('says no channel takes the videos, rather than that the calendars could not be read', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const team = await seedTeamAccount({ emailPrefix: 'cadnone' });
    const yt = await youtubeChannel(team);
    // The episode's video is English; the project's one channel is Hindi
    await updateRows('platform_connections', `id=eq.${yt}`, { language: 'hi' });
    const project = await seedProject(team, { name: 'Cadence no channel' });
    await addProjectChannels(project.id, [yt]);
    const ep = await episodeWithShorts(project.id, 1);

    await signInAs(page, team);
    await openPublish(page, team, `${project.slug}/episodes/${ep.slug}`);
    await pickToday(page);
    await checkCalendar(page);

    await expect(byTest(page, 'release-calendar-error')).toHaveText(
      'No matching channels for uploaded videos. Check language settings.',
      { timeout: 30_000 },
    );
    expect(await publishesOn(yt)).toEqual([]);
  });
});
