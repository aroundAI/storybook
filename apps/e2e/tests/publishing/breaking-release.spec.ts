import { type Page, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

import { encryptLikeTheApp } from '../utils/crypto';
import {
  type McpToolCall,
  callMcpTool,
  mintPersonalAccessToken,
} from '../utils/mcp';
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
 * FILM-2210. Six episodes are already scheduled on a channel's cadence
 * (a long video every 3 days at 20:00, Shorts at 11:00 and 17:00) when a
 * story breaks. The breaking episode goes through the Publish screen's
 * Breaking news tab: its long video now, beside the scheduled ones; its
 * Shorts at the front of the queue with 2 extra times a day for 3 days;
 * the queued Shorts moved back in order. A second breaking episode goes
 * over MCP at a scheduled long video's own time: preview writes nothing,
 * schedule writes it, and no long video moves. Every time is read back
 * from `publishes`. Nothing reaches a platform: no scheduler runs here.
 */

test.skip(
  !process.env.ENCRYPTION_KEY,
  'Seeds a channel token the server decrypts: needs the server’s ENCRYPTION_KEY',
);

const TZ = 'Asia/Kolkata';
test.use({ timezoneId: TZ, viewport: { width: 1280, height: 2400 } });

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const IN_A_DAY = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString();

async function capture(page: Page, name: string, panel = false) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== 'running'),
  );
  const path = `${OUT}/breaking-release-${name}.png`;

  if (panel) {
    await byTest(page, 'schedule-release-panel').screenshot({ path });
  } else {
    await page.screenshot({ path });
  }
}

const dayOf = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
const timeOf = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

async function youtubeChannel(team: SeededTeam, name: string) {
  const id = await seedYouTubeConnection(team.accountId, name, {
    platformAccountId: `yt-breaking-${name.replace(/\W/g, '')}-${team.accountId.slice(0, 8)}`,
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

async function episodeWithShorts(
  projectId: string,
  number: number,
  shorts: number,
) {
  const episode = await seedEpisodeWithShot(projectId, { number });
  const video = episodeVideoUrl(episode.episodeId, 'en');

  await updateRows('episodes', `id=eq.${episode.episodeId}`, {
    title: `Episode ${number}`,
    localized_videos: { en: video },
    shorts_groups: Array.from({ length: shorts }, (_, i) => ({
      id: `ep${number}-short-${i + 1}`,
      name: `Short ${i + 1}`,
      title: `Episode ${number}, Short ${i + 1}`,
      description: '',
      tags: [],
      platforms: ['youtube'],
      videos: { en: video },
    })),
  });

  return { ...episode, number, shorts };
}

const targetsOf = (connectionId: string, number: number, shorts: number) => [
  { connectionId, contentType: 'full', title: `Episode ${number}` },
  ...Array.from({ length: shorts }, (_, i) => ({
    connectionId,
    contentType: 'short',
    shortsGroupId: `ep${number}-short-${i + 1}`,
    title: `Episode ${number}, Short ${i + 1}`,
  })),
];

interface Row {
  id: string;
  episode_id: string;
  title: string | null;
  content_type: string;
  status: string;
  slot_at: string | null;
  scheduled_at: string | null;
  after_episode_full: boolean;
  release_priority: string;
}

const publishesOn = (connectionId: string) =>
  readRows<Row>(
    'publishes',
    `platform_connection_id=eq.${connectionId}&select=id,episode_id,title,content_type,status,slot_at,scheduled_at,after_episode_full,release_priority&order=scheduled_at.asc,id`,
  );

const goes = (row: Row) => row.slot_at ?? row.scheduled_at!;

async function ok(
  call: (name: string, args: Record<string, unknown>) => Promise<McpToolCall>,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await call(name, args);
  expect(result.isError, `${name}: ${result.text}`).toBe(false);
  return result;
}

/** The day × posts table for the PR */
function calendarTable(rows: Row[], titles: Map<string, string>) {
  const days = [...new Set(rows.map((r) => dayOf(goes(r))))].sort();
  const lines = [
    '| Day (IST) | Long videos | Normal Shorts | Breaking Shorts | Shorts total |',
    '|---|---|---|---|---|',
  ];

  for (const day of days) {
    const on = rows.filter((r) => dayOf(goes(r)) === day);
    const longs = on
      .filter((r) => r.content_type === 'full')
      .map(
        (r) =>
          `${timeOf(r.scheduled_at!)} ${titles.get(r.episode_id)}${r.release_priority === 'breaking' ? ' **(breaking)**' : ''}`,
      );
    const normal = on.filter(
      (r) => r.content_type === 'short' && r.release_priority !== 'breaking',
    );
    const breaking = on.filter(
      (r) => r.content_type === 'short' && r.release_priority === 'breaking',
    );
    const list = (shorts: Row[]) =>
      shorts.length
        ? `${shorts.length}: ${shorts.map((r) => timeOf(goes(r))).join(', ')}`
        : '0';

    lines.push(
      `| ${day} | ${longs.join('; ') || '–'} | ${list(normal)} | ${list(breaking)} | ${normal.length + breaking.length} |`,
    );
  }

  return lines.join('\n');
}

test.describe('A breaking-news release', () => {
  test('goes now through the Breaking news tab, ahead of six scheduled episodes, and again over MCP at a scheduled long video’s time', async ({
    page,
  }) => {
    test.setTimeout(300_000);

    const team = await seedTeamAccount({ emailPrefix: 'breaking' });
    const yt = await youtubeChannel(team, 'Story YT');
    const project = await seedProject(team, { name: 'Breaking release' });
    await addProjectChannels(project.id, [yt]);

    const scheduled = [];
    for (let n = 1; n <= 6; n++) {
      scheduled.push(await episodeWithShorts(project.id, n, 4));
    }
    const news = await episodeWithShorts(project.id, 7, 6);
    const news2 = await episodeWithShorts(project.id, 8, 3);
    const titles = new Map(
      [...scheduled, news, news2].map((e) => [e.episodeId, `Ep ${e.number}`]),
    );

    const token = await mintPersonalAccessToken(team, {
      scopes: ['studio:read', 'studio:write', 'studio:publish'],
    });
    const call = callMcpTool.bind(null, token);

    // --- The channel's cadence, and six episodes on it
    await ok(call, 'set_channel_cadence', {
      connectionId: yt,
      contentType: 'full',
      timezone: TZ,
      slotTimes: ['20:00'],
      minDaysBetween: 3,
      jitterMinutes: 0,
    });
    await ok(call, 'set_channel_cadence', {
      connectionId: yt,
      contentType: 'short',
      timezone: TZ,
      slotTimes: ['11:00', '17:00'],
      startAfterHours: 2,
      jitterMinutes: 0,
    });
    for (const episode of scheduled) {
      await ok(call, 'schedule_release', {
        episodeId: episode.episodeId,
        notBefore: new Date().toISOString(),
        timezone: TZ,
        preview: false,
        targets: targetsOf(yt, episode.number, 4),
      });
    }

    const before = await publishesOn(yt);
    expect(before).toHaveLength(30);
    const longsBefore = before.filter((r) => r.content_type === 'full');
    const shortsBefore = before
      .filter((r) => r.content_type === 'short')
      .sort((a, b) => a.slot_at!.localeCompare(b.slot_at!));

    // A second YouTube channel of the team, busy every two hours for six
    // days: any day with a breaking upload passes 6 YouTube uploads
    const busy = await youtubeChannel(team, 'Other YT');
    for (let k = 1; k <= 72; k++) {
      await insertRow(
        'publishes',
        {
          episode_id: scheduled[0]!.episodeId,
          platform_connection_id: busy,
          platform: 'youtube',
          content_type: 'short',
          status: 'scheduled',
          title: `Other channel ${k}`,
          scheduled_at: new Date(
            Date.now() + k * 2 * 3600 * 1000,
          ).toISOString(),
        },
        serviceRoleAuth(),
      );
    }

    // --- Breaking news on the Publish screen
    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${news.slug}/publish`,
    );
    await expect(byTest(page, 'release-mode-breaking')).toBeVisible({
      timeout: 60_000,
    });
    await byTest(page, 'release-mode-breaking').click();
    await expect(byTest(page, 'breaking-release-form')).toBeVisible();
    await expect(byTest(page, 'breaking-schedule')).toBeDisabled();
    await expect(byTest(page, 'breaking-extra-per-day')).toHaveValue('2');
    await expect(byTest(page, 'breaking-days')).toHaveValue('3');
    await capture(page, '01-breaking-tab', true);

    // A time in the past is refused in the form
    await byTest(page, 'breaking-when-at').click();
    await byTest(page, 'breaking-at').fill('2020-01-01T10:00');
    await byTest(page, 'breaking-preview').click();
    await expect(page.getByText('Choose a time in the future.')).toBeVisible();
    await capture(page, '02-past-time-refused', true);
    await byTest(page, 'breaking-when-now').click();

    // The project's channels load after the panel: until then the preview
    // says so, and is asked again
    await expect(async () => {
      await byTest(page, 'breaking-preview').click();
      await expect(byTest(page, 'breaking-preview-result')).toBeVisible({
        timeout: 5_000,
      });
    }).toPass({ timeout: 60_000 });
    await expect(byTest(page, 'breaking-placed')).toHaveCount(7);
    await expect(byTest(page, 'breaking-quota-warning')).toBeVisible();
    const movedInPreview = await byTest(page, 'breaking-moved').count();
    expect(movedInPreview).toBeGreaterThan(0);
    expect(await publishesOn(yt)).toEqual(before);
    await capture(page, '03-preview-moves-and-quota', true);

    const scheduledAt = Date.now();
    await byTest(page, 'breaking-schedule').click();
    await expect
      .poll(
        async () =>
          (await publishesOn(yt)).filter((r) => r.episode_id === news.episodeId)
            .length,
        { timeout: 30_000 },
      )
      .toBe(7);
    await expect(page.getByText(/Scheduled 7 breaking uploads/)).toBeVisible();
    // The preview is spent: scheduling again needs a fresh one
    await expect(byTest(page, 'breaking-preview-result')).toHaveCount(0);
    await expect(byTest(page, 'breaking-schedule')).toBeDisabled();
    await capture(page, '04-after-schedule');

    const afterUi = await publishesOn(yt);
    const newsRows = afterUi.filter((r) => r.episode_id === news.episodeId);
    const newsLong = newsRows.find((r) => r.content_type === 'full')!;
    const newsShorts = newsRows
      .filter((r) => r.content_type === 'short')
      .sort((a, b) => a.slot_at!.localeCompare(b.slot_at!));

    // The long video at the next scheduler run, holding no cadence slot
    expect(newsLong.release_priority).toBe('breaking');
    expect(newsLong.slot_at).toBeNull();
    expect(Date.parse(newsLong.scheduled_at!) - scheduledAt).toBeLessThan(
      3 * 60_000,
    );
    // No scheduled long video moved
    for (const long of longsBefore) {
      expect(afterUi.find((r) => r.id === long.id)).toEqual(long);
    }
    // Its Shorts first, an hour after it, waiting for it
    expect(
      newsShorts.every(
        (r) => r.release_priority === 'breaking' && r.after_episode_full,
      ),
    ).toBe(true);
    expect(
      Date.parse(newsShorts[0]!.slot_at!) - Date.parse(newsLong.scheduled_at!),
    ).toBeGreaterThanOrEqual(3_600_000);
    const lastBreaking = newsShorts.at(-1)!.slot_at!;
    const normalAfter = afterUi
      .filter(
        (r) => r.content_type === 'short' && r.release_priority === 'normal',
      )
      .sort((a, b) => a.slot_at!.localeCompare(b.slot_at!));
    // The queued Shorts keep their order, none earlier than it was
    expect(normalAfter.map((r) => r.id)).toEqual(shortsBefore.map((r) => r.id));
    for (const row of normalAfter) {
      const was = shortsBefore.find((r) => r.id === row.id)!;
      expect(row.slot_at! >= was.slot_at!).toBe(true);
      if (row.slot_at !== was.slot_at) {
        expect(row.slot_at! > newsShorts[0]!.slot_at!).toBe(true);
      }
    }
    const moved = normalAfter.filter(
      (r) => r.slot_at !== shortsBefore.find((b) => b.id === r.id)!.slot_at,
    );
    expect(moved).toHaveLength(movedInPreview);
    expect(lastBreaking < moved.at(-1)!.slot_at!).toBe(true);

    // --- Over MCP: at a scheduled long video's own time
    const sameTime = longsBefore[2]!;
    const breakingArgs = {
      episodeId: news2.episodeId,
      notBefore: new Date().toISOString(),
      timezone: TZ,
      targets: targetsOf(yt, 8, 3),
      breaking: { at: sameTime.slot_at },
    };
    const preview = await ok(call, 'schedule_release', {
      ...breakingArgs,
      preview: true,
    });
    expect(preview.structuredContent).toMatchObject({
      preview: true,
      breaking: true,
    });
    expect(preview.text).toContain('Breaking preview, nothing written');
    expect(await publishesOn(yt)).toEqual(afterUi);

    const done = await ok(call, 'schedule_release', {
      ...breakingArgs,
      preview: false,
    });
    expect(done.structuredContent).toMatchObject({ breaking: true });

    const afterMcp = await publishesOn(yt);
    const news2Long = afterMcp.find(
      (r) => r.episode_id === news2.episodeId && r.content_type === 'full',
    )!;
    expect(Date.parse(news2Long.scheduled_at!)).toBe(
      Date.parse(sameTime.slot_at!),
    );
    for (const long of longsBefore) {
      expect(afterMcp.find((r) => r.id === long.id)).toEqual(long);
    }

    // Normal Shorts never pass the channel's 2 a day; outside the two
    // releases' boost days no day passes 2 Shorts at all
    const boostDays = new Set(
      [
        newsShorts[0]!,
        ...afterMcp.filter(
          (r) => r.episode_id === news2.episodeId && r.content_type === 'short',
        ),
      ].flatMap((r) => {
        const first = dayOf(r.slot_at!);
        return [0, 1, 2].map((n) => {
          const d = new Date(`${first}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + n);
          return d.toISOString().slice(0, 10);
        });
      }),
    );
    const shortsByDay = new Map<string, { normal: number; total: number }>();
    for (const row of afterMcp.filter((r) => r.content_type === 'short')) {
      const day = shortsByDay.get(dayOf(goes(row))) ?? { normal: 0, total: 0 };
      day.total++;
      if (row.release_priority === 'normal') day.normal++;
      shortsByDay.set(dayOf(goes(row)), day);
    }
    for (const [day, count] of shortsByDay) {
      expect(count.normal, day).toBeLessThanOrEqual(2);
      if (!boostDays.has(day)) expect(count.total, day).toBeLessThanOrEqual(2);
    }

    if (process.env.CAPTURE_EVIDENCE) {
      mkdirSync(OUT, { recursive: true });
      const movedLines = moved.map((row) => {
        const was = shortsBefore.find((r) => r.id === row.id)!;
        return `| ${row.title} | ${dayOf(was.slot_at!)} ${timeOf(was.slot_at!)} | ${dayOf(row.slot_at!)} ${timeOf(row.slot_at!)} |`;
      });
      writeFileSync(
        `${OUT}/calendar.md`,
        [
          '## Before: six episodes scheduled',
          '',
          calendarTable(before, titles),
          '',
          `## After: Ep 7 breaking now (Publish screen), Ep 8 breaking at ${dayOf(sameTime.slot_at!)} ${timeOf(sameTime.slot_at!)} (MCP)`,
          '',
          calendarTable(afterMcp, titles),
          '',
          `## Shorts the Publish screen's breaking release moved back (${moved.length})`,
          '',
          '| Short | Was | Now |',
          '|---|---|---|',
          ...movedLines,
          '',
        ].join('\n'),
      );
    }
  });
});
