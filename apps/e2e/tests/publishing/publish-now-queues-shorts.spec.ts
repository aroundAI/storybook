import { type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import { encryptLikeTheApp } from '../utils/crypto';
import {
  type SeededTeam,
  addProjectChannels,
  episodeVideoUrl,
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
import { byTest } from '../utils/visible';

/**
 * KB-204. Publish All used to post the long video and every Short of the
 * episode at once, past the channel's posting rules: pressed twice on
 * 2026-10-19 it posted 9 YouTube Shorts, 7 Facebook Reels and 7 Instagram
 * Reels in nine minutes. "Publish video now" posts the long video now and
 * puts each Short in its channel's Shorts queue, as Schedule Release does;
 * the confirm step says which goes now and when each Short goes. A second
 * press posts nothing already on the channel.
 *
 * Nothing reaches a platform here: the long video is seeded as already out
 * (a publish-now upload needs a vendor), and a queued Short is a row until
 * the scheduled job runs.
 */

test.skip(
  !process.env.ENCRYPTION_KEY,
  'Seeds a channel token the server decrypts: needs the server’s ENCRYPTION_KEY',
);

const TZ = 'Asia/Kolkata';
test.use({ timezoneId: TZ });

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const NOTHING_LEFT =
  'Everything in this episode is already published or queued on its channels.';

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await page
    .getByRole('dialog')
    .screenshot({ path: `${OUT}/publish-now-${name}.png` });
}

const dayOf = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));

async function youtubeChannel(team: SeededTeam) {
  const id = await seedYouTubeConnection(team.accountId, 'Story YT EN', {
    platformAccountId: `yt-kb204-${team.accountId.slice(0, 8)}`,
    accessTokenEncrypted: await encryptLikeTheApp('youtube-token'),
  });

  await updateRows('platform_connections', `id=eq.${id}`, {
    language: 'en',
    token_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
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
    shorts_groups: [1, 2, 3].map((n) => ({
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
  content_type: string;
  status: string;
  slot_at: string | null;
  scheduled_at: string | null;
  after_episode_full: boolean;
  thumbnail_url: string | null;
}

function publishesOf(episodeId: string) {
  return readRows<PublishRow>(
    'publishes',
    `episode_id=eq.${episodeId}&select=content_type,status,slot_at,scheduled_at,after_episode_full,thumbnail_url&order=slot_at.nullsfirst`,
  );
}

/** "Publish video now", retried until the page has hydrated */
async function pressPublishNow(page: Page, expectTest: string) {
  await expect(async () => {
    await byTest(page, 'publish-all').click();
    await expect(byTest(page, expectTest)).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
}

async function queuedTimes(page: Page) {
  return byTest(page, 'queued-short-row').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-scheduled-at') ?? ''),
  );
}

test.describe('Publish video now queues the Shorts (KB-204)', () => {
  test.describe.configure({ timeout: 180_000 });
  test.use({ navigationTimeout: 60_000 });

  test('the confirm step lists the long video now and when each Short is queued; cancelling writes nothing', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb204-confirm' });
    const yt = await youtubeChannel(team);
    const project = await seedProject(team, { name: 'KB-204 confirm' });
    await addProjectChannels(project.id, [yt]);
    const episode = await episodeWithShorts(project.id, 1);

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${episode.slug}/publish`,
    );
    await expect(byTest(page, 'publish-all')).toHaveText('Publish video now');

    const pressed = Date.now();
    await pressPublishNow(page, 'confirm-publish');

    await expect(byTest(page, 'confirm-posts-now-row')).toHaveText([
      /Story YT EN · Long video · English/,
    ]);
    await expect(byTest(page, 'queued-short-row')).toHaveCount(3);
    await expect(byTest(page, 'confirm-publish')).toHaveText(
      'Publish now & queue Shorts',
    );

    // Each Short has its time before anything is sent: one a day, the
    // first no sooner than the channel's 2 hours after the long video
    await expect
      .poll(async () => (await queuedTimes(page)).every(Boolean))
      .toBe(true);
    const times = await queuedTimes(page);
    expect(new Set(times.map(dayOf)).size).toBe(3);
    for (const at of times) {
      expect(new Date(at).getTime()).toBeGreaterThan(
        pressed + 2 * 3600 * 1000 - 20 * 60 * 1000,
      );
    }
    await capture(page, '1-confirm-long-now-shorts-queued');

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(byTest(page, 'confirm-publish')).toBeHidden();
    expect(await publishesOf(episode.episodeId)).toEqual([]);
  });

  test('with the long video out, the Shorts are queued with slots, one a day, without a thumbnail; a second press adds nothing', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb204-queue' });
    const yt = await youtubeChannel(team);
    const project = await seedProject(team, { name: 'KB-204 queue' });
    await addProjectChannels(project.id, [yt]);
    const episode = await episodeWithShorts(project.id, 1);

    // The long video went out a minute ago
    await insertRow(
      'publishes',
      {
        episode_id: episode.episodeId,
        platform_connection_id: yt,
        platform: 'youtube',
        content_type: 'full',
        title: 'Episode 1',
        language: 'en',
        status: 'published',
        published_at: new Date(Date.now() - 60_000).toISOString(),
      },
      serviceRoleAuth(),
    );

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${episode.slug}/publish`,
    );

    await pressPublishNow(page, 'confirm-publish');
    await expect(byTest(page, 'confirm-posts-now')).toContainText(
      'No long video: it is already published or queued.',
    );
    await expect(byTest(page, 'confirm-publish')).toHaveText('Queue Shorts');
    await expect(byTest(page, 'queued-short-row')).toHaveCount(3);
    await expect
      .poll(async () => (await queuedTimes(page)).every(Boolean))
      .toBe(true);
    await capture(page, '2-confirm-shorts-only');

    await byTest(page, 'confirm-publish').click();
    await expect(byTest(page, 'publish-dialog-close')).toHaveText('Done', {
      timeout: 60_000,
    });
    await capture(page, '3-shorts-queued');

    const rows = await publishesOf(episode.episodeId);
    const shorts = rows.filter((row) => row.content_type === 'short');
    expect(rows.filter((row) => row.content_type === 'full')).toHaveLength(1);
    expect(shorts).toHaveLength(3);
    for (const short of shorts) {
      expect(short).toMatchObject({
        status: 'scheduled',
        after_episode_full: true,
        thumbnail_url: null,
      });
      expect(short.slot_at).not.toBeNull();
    }
    // The channel posts one Short a day
    expect(new Set(shorts.map((s) => dayOf(s.slot_at!))).size).toBe(3);

    // --- The second press: everything is already on the channel
    await byTest(page, 'publish-dialog-close').click();
    await pressPublishNow(page, 'publish-error');
    await expect(byTest(page, 'publish-error')).toHaveText(NOTHING_LEFT);
    await capture(page, '4-second-press');

    expect(await publishesOf(episode.episodeId)).toHaveLength(4);
  });
});
