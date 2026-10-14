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
 * FILM-719. A release is scheduled on its channel's posting cadence (owner,
 * 2026-10-15): the long video in the channel's next free slot, its Shorts
 * one slot at a time after it, and only until the next episode's long
 * video. The second episode's long video holds back the first episode's
 * Shorts still scheduled after it, and the owner re-queues them.
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
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== 'running'),
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
  metadata: { heldReason?: string; createdVia?: string };
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
  test('one Short a day after the long video, held back by the next episode, re-queued', async ({
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
    await byTest(page, 'release-check-calendar').click();
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

    // --- Two Shorts a day: the posting rules, saved
    await byTest(page, 'release-calendar-edit-channel').click();
    const dialog = visible(page, '[data-test="channel-cadence-dialog"]');
    await expect(byTest(dialog, 'cadence-slot-time')).toHaveCount(1);
    await byTest(dialog, 'cadence-slot-add').click();
    await byTest(dialog, 'cadence-slot-time').nth(1).fill('10:00');
    await capture(page, '02-posting-rules');
    await byTest(dialog, 'cadence-save').click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(
        async () =>
          (
            await readRows<{ slot_times: string[] }>(
              'channel_posting_cadences',
              `platform_connection_id=eq.${yt}&content_type=eq.short&select=slot_times`,
            )
          )[0]?.slot_times,
      )
      .toEqual(['10:00', '18:00']);

    await byTest(page, 'release-check-calendar').click();
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
      .toBe(2);
    await capture(page, '03-two-a-day', true);

    // --- The second save: back to one a day. The dialog opens on what was
    //     saved, not on the defaults.
    await byTest(page, 'release-calendar-edit-channel').click();
    await expect(byTest(dialog, 'cadence-slot-time')).toHaveCount(2);
    await expect(byTest(dialog, 'cadence-slot-time').first()).toHaveValue(
      '10:00',
    );
    await byTest(dialog, 'cadence-slot-remove').first().click();
    await byTest(dialog, 'cadence-save').click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(
        async () =>
          (
            await readRows<{ slot_times: string[] }>(
              'channel_posting_cadences',
              `platform_connection_id=eq.${yt}&content_type=eq.short&select=slot_times`,
            )
          )[0]?.slot_times,
      )
      .toEqual(['18:00']);

    await byTest(page, 'release-check-calendar').click();
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

    // --- Episode 2: its long video holds back episode 1's later Shorts
    await openPublish(page, team, `${project.slug}/episodes/${ep2.slug}`);
    await pickToday(page);
    await byTest(page, 'release-check-calendar').click();
    await expect(byTest(page, 'release-calendar-displaced')).toBeVisible({
      timeout: 30_000,
    });
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
    const heldEp1 = afterEp2.filter(
      (r) => r.episode_id === ep1.episodeId && r.status === 'draft',
    );
    const liveShorts = afterEp2.filter(
      (r) => r.content_type === 'short' && r.status === 'scheduled',
    );

    // Episode 1's Shorts after episode 2's long video are held, not lost
    expect(heldEp1.length).toBeGreaterThan(0);
    expect(heldEp1.every((r) => r.metadata.heldReason === 'next-episode')).toBe(
      true,
    );
    expect(heldEp1.every((r) => r.slot_at === null)).toBe(true);
    for (const short of liveShorts) {
      if (short.episode_id === ep1.episodeId) {
        expect(short.slot_at! < ep2Full.slot_at!).toBe(true);
      } else {
        expect(short.slot_at! > ep2Full.slot_at!).toBe(true);
      }
    }
    // Never two Shorts on one day, whichever episode
    expect(
      Math.max(...perDay(liveShorts.map((r) => r.slot_at!)).values()),
    ).toBe(1);

    // --- On episode 1's page the held Shorts say why, and are re-queued
    await openPublish(page, team, `${project.slug}/episodes/${ep1.slug}`);
    await expect(byTest(page, 'published-content-held')).toHaveCount(
      heldEp1.length,
      { timeout: 30_000 },
    );
    await byTest(page, 'published-content-held')
      .first()
      .scrollIntoViewIfNeeded();
    await capture(page, '06-held-on-episode-1');

    await (
      heldEp1.length > 1
        ? byTest(page, 'held-requeue-all')
        : byTest(page, 'held-requeue').first()
    ).click();

    await expect
      .poll(
        async () =>
          (await publishesOn(yt)).filter((r) => r.status === 'draft').length,
        { timeout: 30_000 },
      )
      .toBe(0);

    const requeued = (await publishesOn(yt)).filter((r) =>
      heldEp1.some((h) => h.id === r.id),
    );
    const lastEp2Short = afterEp2
      .filter(
        (r) => r.episode_id === ep2.episodeId && r.content_type === 'short',
      )
      .map((r) => r.slot_at!)
      .sort()
      .at(-1)!;

    expect(requeued.every((r) => r.status === 'scheduled')).toBe(true);
    expect(requeued.every((r) => r.slot_at! > lastEp2Short)).toBe(true);
    expect(requeued.every((r) => !r.metadata.heldReason)).toBe(true);
    await expect(byTest(page, 'published-content-held')).toHaveCount(0);
    await capture(page, '07-requeued');
  });
});
