import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { encryptLikeTheApp } from '../utils/crypto';
import {
  type McpToolCall,
  callMcpTool,
  mintPersonalAccessToken,
} from '../utils/mcp';
import { headerOnlyMp4 } from '../utils/mp4';
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

/**
 * FILM-2208, the owner's workflow end to end over the real MCP endpoint:
 * set each channel's cadence, upload an episode (long video, thumbnail,
 * Shorts per platform cut), release it on the cadence, and release the
 * next one, whose Shorts queue after the first episode's (FILM-2209).
 * FILM-2209's own plan: nine episodes of eight Shorts, released four and
 * then five two days later. Every time is read back from `publishes`
 * (KB-197: no Short carries a thumbnail). Nothing reaches a platform: a
 * scheduled publish is a row until the scheduled job runs.
 */

test.skip(
  !process.env.ENCRYPTION_KEY,
  'Seeds a channel token the server decrypts: needs the server’s ENCRYPTION_KEY',
);

const ZONE = 'Asia/Kolkata';
const IN_A_DAY = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString();

/** A 1×1 PNG */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** The IST date `n` days after tomorrow, as YYYY-MM-DD */
function istDate(n: number) {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  ist.setUTCDate(ist.getUTCDate() + 1 + n);
  return ist.toISOString().slice(0, 10);
}

/** A wall-clock time in IST on day `n` (0 = tomorrow), as epoch ms */
const at = (n: number, time: string) =>
  new Date(`${istDate(n)}T${time}:00+05:30`).getTime();

async function channel(team: SeededTeam, name: string, platform: string) {
  const id = await seedYouTubeConnection(team.accountId, name, {
    platform,
    platformAccountId: `${platform}-cad-${name.replace(/\W/g, '')}-${team.accountId.slice(0, 8)}`,
    accessTokenEncrypted: await encryptLikeTheApp(`${platform}-token`),
  });

  await updateRows('platform_connections', `id=eq.${id}`, {
    language: 'en',
    token_expires_at: IN_A_DAY(),
    youtube_made_for_kids: platform === 'youtube' ? false : null,
    youtube_category_id: platform === 'youtube' ? '22' : null,
  });

  return id;
}

type Call = (
  name: string,
  args: Record<string, unknown>,
) => Promise<McpToolCall>;

async function ok(call: Call, name: string, args: Record<string, unknown>) {
  const result = await call(name, args);
  expect(result.isError, `${name}: ${result.text}`).toBe(false);
  return result;
}

/** request → PUT → finalize, for a video or a thumbnail */
async function upload(
  call: Call,
  kind: 'video' | 'thumbnail',
  episodeId: string,
  extra: Record<string, unknown> = {},
) {
  const file =
    kind === 'video'
      ? Buffer.from(headerOnlyMp4({ seconds: 4, width: 1080, height: 1920 }))
      : PNG;
  const requested = await ok(
    call,
    kind === 'video'
      ? 'request_episode_video_upload'
      : 'request_episode_thumbnail_upload',
    {
      episodeId,
      language: 'en',
      contentType: kind === 'video' ? 'video/mp4' : 'image/png',
      bytes: file.byteLength,
    },
  );
  const signed = requested.structuredContent as {
    key: string;
    uploadUrl: string;
    headers: Record<string, string>;
  };
  const put = await fetch(signed.uploadUrl, {
    method: 'PUT',
    headers: signed.headers,
    body: file,
  });
  expect(put.ok).toBe(true);

  return ok(
    call,
    kind === 'video' ? 'finalize_episode_video' : 'finalize_episode_thumbnail',
    { episodeId, language: 'en', key: signed.key, ...extra },
  );
}

/** A Shorts group for these platforms, with its one short uploaded */
async function short(
  call: Call,
  episodeId: string,
  name: string,
  platforms: string[],
) {
  const made = await ok(call, 'upsert_shorts_group', {
    episodeId,
    name,
    platforms,
  });
  const groupId = (made.structuredContent.shortsGroup as { id: string }).id;
  await upload(call, 'video', episodeId, { shortsGroupId: groupId });
  return groupId;
}

interface Row {
  id: string;
  platform_connection_id: string;
  content_type: string;
  status: string;
  slot_at: string | null;
  scheduled_at: string | null;
  thumbnail_url: string | null;
  after_episode_full: boolean;
  metadata: { shortsGroupId?: string; heldReason?: string };
}

const rowsOf = (episodeId: string) =>
  readRows<Row>(
    'publishes',
    `episode_id=eq.${episodeId}&select=id,platform_connection_id,content_type,status,slot_at,scheduled_at,thumbnail_url,after_episode_full,metadata&order=slot_at.asc.nullslast,id`,
  );

const slot = (row: Row | undefined) =>
  row?.slot_at ? new Date(row.slot_at).getTime() : null;

test.describe('A release on the channels’ cadence over MCP', () => {
  test('long videos 3 days apart, Shorts at 11:00 and 21:00 after them, the next episode’s queued after the first’s 7th; no Short carries a thumbnail', async () => {
    test.setTimeout(180_000);

    const team = await seedTeamAccount({ emailPrefix: 'mcpcad' });
    const yt = await channel(team, 'Ledger YT', 'youtube');
    const fb = await channel(team, 'Ledger FB', 'facebook');
    const ig = await channel(team, 'Ledger IG', 'instagram');
    const project = await seedProject(team, { name: 'Ledger Autopsy' });
    await addProjectChannels(project.id, [yt, fb, ig]);
    const { episodeId: ep1 } = await seedEpisodeWithShot(project.id);
    const { episodeId: ep2 } = await seedEpisodeWithShot(project.id, {
      number: 2,
    });

    const token = await mintPersonalAccessToken(team, {
      scopes: ['studio:read', 'studio:write', 'studio:publish'],
    });
    const call: Call = callMcpTool.bind(null, token);

    // --- The owner's cadence, set over MCP
    for (const connectionId of [yt, fb]) {
      await ok(call, 'set_channel_cadence', {
        connectionId,
        contentType: 'full',
        timezone: ZONE,
        slotTimes: ['08:00'],
        minDaysBetween: 3,
        jitterMinutes: 15,
      });
    }
    for (const connectionId of [yt, fb, ig]) {
      await ok(call, 'set_channel_cadence', {
        connectionId,
        contentType: 'short',
        timezone: ZONE,
        slotTimes: ['21:00', '11:00'],
        startAfterHours: 2,
        jitterMinutes: 15,
      });
    }
    const cadence = await ok(call, 'get_channel_cadence', {
      connectionIds: [yt],
    });
    expect(cadence.structuredContent.cadences).toEqual([
      expect.objectContaining({
        contentType: 'full',
        own: true,
        cadence: expect.objectContaining({ slotTimes: ['08:00'] }),
      }),
      expect.objectContaining({
        contentType: 'short',
        own: true,
        cadence: expect.objectContaining({ slotTimes: ['11:00', '21:00'] }),
      }),
    ]);

    // --- Episode 1: long video, thumbnail, seven YouTube Shorts, one Reel
    await upload(call, 'video', ep1);
    const thumb = await upload(call, 'thumbnail', ep1);
    const thumbnailUrl = thumb.structuredContent.thumbnailUrl as string;
    const ytShorts: string[] = [];
    for (let n = 1; n <= 7; n++) {
      ytShorts.push(await short(call, ep1, `YT ${n}`, ['youtube']));
    }
    const reel = await short(call, ep1, 'IG/FB 1', ['instagram', 'facebook']);

    const release = (episodeId: string, targets: unknown[], preview: boolean) =>
      call('schedule_release', {
        episodeId,
        notBefore: `${istDate(0)}T00:00:00+05:30`,
        timezone: ZONE,
        preview,
        targets,
      });

    const ep1Targets = [
      { connectionId: yt, contentType: 'full', title: 'Case 1' },
      { connectionId: fb, contentType: 'full', title: 'Case 1' },
      ...ytShorts.map((shortsGroupId, i) => ({
        connectionId: yt,
        contentType: 'short',
        shortsGroupId,
        title: `Case 1, short ${i + 1}`,
      })),
      {
        connectionId: ig,
        contentType: 'short',
        shortsGroupId: reel,
        title: 'Case 1 reel',
      },
      {
        connectionId: fb,
        contentType: 'short',
        shortsGroupId: reel,
        title: 'Case 1 reel',
      },
    ];

    // A preview writes nothing
    const preview = await release(ep1, ep1Targets, true);
    expect(preview.isError, preview.text).toBe(false);
    expect(preview.structuredContent.placed).toHaveLength(11);
    expect(await rowsOf(ep1)).toEqual([]);

    const scheduled = await release(ep1, ep1Targets, false);
    expect(scheduled.isError, scheduled.text).toBe(false);

    const rows1 = await rowsOf(ep1);
    const on = (connectionId: string, type: string) =>
      rows1.filter(
        (r) =>
          r.platform_connection_id === connectionId && r.content_type === type,
      );

    // Long videos: 08:00 tomorrow, with the episode's thumbnail
    for (const connectionId of [yt, fb]) {
      const [long] = on(connectionId, 'full');
      expect(slot(long)).toBe(at(0, '08:00'));
      expect(long?.thumbnail_url).toBe(thumbnailUrl);
    }

    // YouTube Shorts: 11:00 and 21:00 from 2 hours after it, one a slot
    expect(on(yt, 'short').map(slot)).toEqual([
      at(0, '11:00'),
      at(0, '21:00'),
      at(1, '11:00'),
      at(1, '21:00'),
      at(2, '11:00'),
      at(2, '21:00'),
      at(3, '11:00'),
    ]);
    expect(slot(on(ig, 'short')[0])).toBe(at(0, '11:00'));
    expect(slot(on(fb, 'short')[0])).toBe(at(0, '11:00'));

    // Every Short waits for its long video and carries no thumbnail (KB-197)
    for (const row of rows1.filter((r) => r.content_type === 'short')) {
      expect(row.after_episode_full).toBe(true);
      expect(row.thumbnail_url).toBeNull();
    }

    // Jitter stays within ±15 minutes of the slot
    for (const row of rows1) {
      const drift = Math.abs(
        new Date(row.scheduled_at!).getTime() - slot(row)!,
      );
      expect(drift).toBeLessThanOrEqual(15 * 60_000);
    }

    // --- Episode 2: its long video 3 days later; episode 1's 7th Short
    //     stays, and episode 2's Short queues after it
    await upload(call, 'video', ep2);
    const ep2Short = await short(call, ep2, 'YT 1', ['youtube']);
    const second = await release(
      ep2,
      [
        { connectionId: yt, contentType: 'full', title: 'Case 2' },
        {
          connectionId: yt,
          contentType: 'short',
          shortsGroupId: ep2Short,
          title: 'Case 2, short 1',
        },
      ],
      false,
    );
    expect(second.isError, second.text).toBe(false);

    const rows2 = await rowsOf(ep2);
    expect(rows2.map((r) => [r.content_type, slot(r)])).toEqual([
      ['full', at(3, '08:00')],
      ['short', at(3, '21:00')],
    ]);
    expect(
      rows2.find((r) => r.content_type === 'full')?.thumbnail_url,
    ).toBeNull();

    const seventh = (await rowsOf(ep1)).find(
      (r) => r.metadata.shortsGroupId === ytShorts[6],
    )!;
    expect(seventh).toMatchObject({ status: 'scheduled' });
    expect(slot(seventh)).toBe(at(3, '11:00'));
    expect(seventh.metadata.heldReason).toBeUndefined();

    // --- The calendar lists both episodes' posts, none held
    const calendar = await ok(call, 'get_publish_calendar', {
      projectId: project.id,
      from: new Date().toISOString(),
      to: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    });
    const listed = calendar.structuredContent.posts as Array<{
      status: string;
    }>;
    expect(listed).toHaveLength(rows1.length + rows2.length);
    expect(listed.every((p) => p.status === 'scheduled')).toBe(true);
  });

  test('nine episodes of eight Shorts, four and then five two days later: long videos every 3 days at 20:00, Shorts 2 a day oldest first', async () => {
    test.setTimeout(300_000);

    const team = await seedTeamAccount({ emailPrefix: 'mcpspill' });
    const yt = await channel(team, 'Spill YT', 'youtube');
    const ig = await channel(team, 'Spill IG', 'instagram');
    const project = await seedProject(team, { name: 'Spill queue' });
    await addProjectChannels(project.id, [yt, ig]);

    const token = await mintPersonalAccessToken(team, {
      scopes: ['studio:read', 'studio:write', 'studio:publish'],
    });
    const call: Call = callMcpTool.bind(null, token);

    // --- The owner's plan: a long video at 20:00 every 3 days; Shorts at
    //     11:00 and 17:00 every day, 2 hours after their long video
    await ok(call, 'set_channel_cadence', {
      connectionId: yt,
      contentType: 'full',
      timezone: ZONE,
      slotTimes: ['20:00'],
      minDaysBetween: 3,
      jitterMinutes: 15,
    });
    for (const connectionId of [yt, ig]) {
      await ok(call, 'set_channel_cadence', {
        connectionId,
        contentType: 'short',
        timezone: ZONE,
        slotTimes: ['17:00', '11:00'],
        everyNDays: 1,
        startAfterHours: 2,
        jitterMinutes: 15,
      });
    }

    // --- Nine episodes, each with eight Shorts for YouTube and Instagram
    const episodes: Array<{ id: string; number: number }> = [];
    for (let number = 1; number <= 9; number++) {
      const { episodeId } = await seedEpisodeWithShot(project.id, { number });
      const video = episodeVideoUrl(episodeId, 'en');
      await updateRows('episodes', `id=eq.${episodeId}`, {
        title: `Episode ${number}`,
        localized_videos: { en: video },
        shorts_groups: Array.from({ length: 8 }, (_, n) => ({
          id: `ep${number}-short-${n + 1}`,
          name: `Short ${n + 1}`,
          title: `Episode ${number}, Short ${n + 1}`,
          description: '',
          tags: [],
          platforms: ['youtube', 'instagram'],
          videos: { en: video },
        })),
      });
      episodes.push({ id: episodeId, number });
    }

    const releaseEpisode = (
      episode: { id: string; number: number },
      notBefore: string,
    ) =>
      ok(call, 'schedule_release', {
        episodeId: episode.id,
        notBefore,
        timezone: ZONE,
        targets: [
          {
            connectionId: yt,
            contentType: 'full',
            title: `Episode ${episode.number}`,
          },
          ...[yt, ig].flatMap((connectionId) =>
            Array.from({ length: 8 }, (_, n) => ({
              connectionId,
              contentType: 'short',
              shortsGroupId: `ep${episode.number}-short-${n + 1}`,
              title: `Episode ${episode.number}, Short ${n + 1}`,
            })),
          ),
        ],
      });

    interface Post {
      id: string;
      episode_id: string;
      platform_connection_id: string;
      content_type: string;
      status: string;
      slot_at: string;
      scheduled_at: string;
    }
    const posts = () =>
      readRows<Post>(
        'publishes',
        `platform_connection_id=in.(${yt},${ig})&select=id,episode_id,platform_connection_id,content_type,status,slot_at,scheduled_at&order=slot_at`,
      );

    // --- Four episodes now
    for (const episode of episodes.slice(0, 4)) {
      await releaseEpisode(episode, `${istDate(0)}T00:00:00+05:30`);
    }
    const firstBatch = await posts();
    expect(firstBatch).toHaveLength(4 * 17);

    // --- Two days on: what was due has gone out
    const twoDaysOn = at(2, '00:00');
    for (const row of firstBatch) {
      if (new Date(row.scheduled_at).getTime() < twoDaysOn) {
        await updateRows('publishes', `id=eq.${row.id}`, {
          status: 'published',
          published_at: row.scheduled_at,
        });
      }
    }

    // --- Five more, released then
    let last: McpToolCall | undefined;
    for (const episode of episodes.slice(4)) {
      last = await releaseEpisode(episode, `${istDate(2)}T00:00:00+05:30`);
    }
    const all = await posts();
    expect(all).toHaveLength(9 * 17);

    // Nothing of the first four moved
    for (const before of firstBatch) {
      const after = all.find((r) => r.id === before.id)!;
      expect([after.slot_at, after.scheduled_at]).toEqual([
        before.slot_at,
        before.scheduled_at,
      ]);
    }

    const numberOf = (episodeId: string) =>
      episodes.find((e) => e.id === episodeId)!.number;
    const istDay = (iso: string) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
        new Date(iso),
      );
    const istTime = (iso: string) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: ZONE,
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(iso));

    // Long videos: in episode order, at 20:00, 3 days apart, jitter on the day
    const longs = all.filter((r) => r.content_type === 'full');
    expect(longs.map((r) => numberOf(r.episode_id))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    longs.forEach((long, i) => {
      expect(new Date(long.slot_at).getTime()).toBe(at(3 * i, '20:00'));
      expect(istDay(long.scheduled_at)).toBe(istDay(long.slot_at));
      expect(
        Math.abs(Date.parse(long.scheduled_at) - Date.parse(long.slot_at)),
      ).toBeLessThanOrEqual(15 * 60_000);
    });

    for (const connectionId of [yt, ig]) {
      const shorts = all
        .filter(
          (r) =>
            r.platform_connection_id === connectionId &&
            r.content_type === 'short',
        )
        .sort((a, b) => a.slot_at.localeCompare(b.slot_at));
      expect(shorts).toHaveLength(72);

      // Oldest episode first, and in order after jitter too
      const order = shorts.map((r) => numberOf(r.episode_id));
      expect(order).toEqual([...order].sort((a, b) => a - b));
      for (let i = 1; i < shorts.length; i++) {
        expect(shorts[i]!.scheduled_at > shorts[i - 1]!.scheduled_at).toBe(
          true,
        );
      }

      // Never more than 2 a day, by when they go out
      const perDay = new Map<string, number>();
      for (const r of shorts) {
        perDay.set(
          istDay(r.scheduled_at),
          (perDay.get(istDay(r.scheduled_at)) ?? 0) + 1,
        );
      }
      expect(Math.max(...perDay.values())).toBe(2);

      // None before its episode's long video plus 2 hours
      for (const r of shorts) {
        const long = longs.find((l) => l.episode_id === r.episode_id)!;
        expect(Date.parse(r.slot_at)).toBeGreaterThanOrEqual(
          Date.parse(long.slot_at) + 2 * 3_600_000,
        );
      }
    }

    // 8 Shorts an episode, 6 slots between long videos: the queue grows
    expect(last!.structuredContent.shortsQueue).toContainEqual(
      expect.objectContaining({ connectionId: yt, runsAhead: true }),
    );

    // --- The calendar, day by day, for the PR
    if (process.env.CALENDAR_OUT) {
      const days = [...new Set(all.map((r) => istDay(r.scheduled_at)))].sort();
      const cell = (rows: Post[]) =>
        rows
          .map((r) => `E${numberOf(r.episode_id)} ${istTime(r.scheduled_at)}`)
          .join(', ') || '—';
      const lines = [
        '| Day (IST) | YouTube long video | YouTube Shorts | Instagram Reels |',
        '|---|---|---|---|',
        ...days.map((day) => {
          const on = (connectionId: string, type: string) =>
            all
              .filter(
                (r) =>
                  r.platform_connection_id === connectionId &&
                  r.content_type === type &&
                  istDay(r.scheduled_at) === day,
              )
              .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
          return `| ${day} | ${cell(on(yt, 'full'))} | ${cell(on(yt, 'short'))} | ${cell(on(ig, 'short'))} |`;
        }),
      ];
      mkdirSync(dirname(process.env.CALENDAR_OUT), { recursive: true });
      writeFileSync(
        process.env.CALENDAR_OUT,
        `${lines.join('\n')}\n\nShorts queue after episode 9: ${JSON.stringify(last!.structuredContent.shortsQueue)}\n`,
      );
    }
  });

  test('a connection without studio:publish reads the cadence but cannot set it or release', async () => {
    const team = await seedTeamAccount({ emailPrefix: 'mcpcadro' });
    const yt = await channel(team, 'Read only YT', 'youtube');
    const project = await seedProject(team, { name: 'Read only' });
    await addProjectChannels(project.id, [yt]);
    const { episodeId } = await seedEpisodeWithShot(project.id);
    const token = await mintPersonalAccessToken(team, {
      scopes: ['studio:read', 'studio:write'],
    });
    const call: Call = callMcpTool.bind(null, token);

    await ok(call, 'get_channel_cadence', { connectionIds: [yt] });

    const set = await call('set_channel_cadence', {
      connectionId: yt,
      contentType: 'short',
      timezone: ZONE,
      slotTimes: ['11:00'],
    });
    expect(set.isError).toBe(true);
    expect(set.text).toContain('studio:publish');

    const released = await call('schedule_release', {
      episodeId,
      notBefore: `${istDate(0)}T00:00:00+05:30`,
      timezone: ZONE,
      targets: [{ connectionId: yt, contentType: 'full', title: 'Nope' }],
    });
    expect(released.isError).toBe(true);
    expect(released.text).toContain('studio:publish');
    expect(await rowsOf(episodeId)).toEqual([]);
  });
});
