import { expect, test } from '@playwright/test';

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
 * Scheduling publishes over MCP (owner, 2026-10-10). A connection holding
 * studio:publish schedules an episode's video and a Shorts group's to the
 * project's channels at a future time, and cancels one before it goes out;
 * a refused target schedules nothing, and a connection without the scope is
 * told how to get it. Against the real endpoint and database, so RLS,
 * publishes_delete and the scope constraint all apply. Nothing reaches a
 * platform: a scheduled publish is a row until the scheduled job runs.
 */

test.skip(
  !process.env.ENCRYPTION_KEY,
  'Seeds a channel token the server decrypts: needs the server’s ENCRYPTION_KEY',
);

const IN_A_DAY = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString();

async function channel(team: SeededTeam, name: string, platform: string) {
  const id = await seedYouTubeConnection(team.accountId, name, {
    platform,
    platformAccountId: `${platform}-mcp-${name.replace(/\W/g, '')}-${team.accountId.slice(0, 8)}`,
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

async function fixture(
  scopes: Parameters<typeof mintPersonalAccessToken>[1],
  options: { seedGroups?: boolean } = {},
) {
  const team = await seedTeamAccount({ emailPrefix: 'mcppub' });
  const yt = await channel(team, 'Story YT EN', 'youtube');
  const ig = await channel(team, 'Story IG EN', 'instagram');
  const project = await seedProject(team, { name: 'Scheduled over MCP' });
  await addProjectChannels(project.id, [yt, ig]);
  const { episodeId } = await seedEpisodeWithShot(project.id);

  await updateRows('episodes', `id=eq.${episodeId}`, {
    localized_videos: { en: episodeVideoUrl(episodeId, 'en') },
    shorts_groups:
      options.seedGroups === false
        ? []
        : [
            {
              id: 'ig-cut',
              name: 'IG cut',
              title: '',
              description: '',
              tags: [],
              platforms: ['instagram'],
              videos: { en: episodeVideoUrl(episodeId, 'en') },
            },
          ],
  });

  const token = await mintPersonalAccessToken(team, scopes);

  return { yt, ig, episodeId, call: callMcpTool.bind(null, token) };
}

/** request_episode_video_upload, PUT, finalize_episode_video: one file */
async function uploadVideo(
  call: (name: string, args: Record<string, unknown>) => Promise<McpToolCall>,
  episodeId: string,
  extra: Record<string, unknown>,
) {
  const file = Buffer.from(
    headerOnlyMp4({ seconds: 4, width: 1080, height: 1920 }),
  );
  const requested = await call('request_episode_video_upload', {
    episodeId,
    language: 'en',
    contentType: 'video/mp4',
    bytes: file.byteLength,
  });
  const upload = requested.structuredContent as {
    key: string;
    uploadUrl: string;
    headers: Record<string, string>;
  };
  const put = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: upload.headers,
    body: file,
  });
  expect(put.ok).toBe(true);

  return call('finalize_episode_video', {
    episodeId,
    language: 'en',
    key: upload.key,
    ...extra,
  });
}

function publishesOf(episodeId: string) {
  return readRows<{
    id: string;
    platform: string;
    platform_connection_id: string;
    content_type: string;
    status: string;
    language: string;
    metadata: { shortsGroupId?: string | null; createdVia?: string };
  }>(
    'publishes',
    `episode_id=eq.${episodeId}&select=id,platform,platform_connection_id,content_type,status,language,metadata&order=platform`,
  );
}

test.describe('Scheduling publishes over MCP', () => {
  test('schedules the video and a Shorts cut to their channels, refuses what the screen refuses, and cancels one', async () => {
    const { yt, ig, episodeId, call } = await fixture({
      scopes: ['studio:read', 'studio:write', 'studio:publish'],
    });

    const listed = await call('list_episode_publishes', { episodeId });
    expect(listed.structuredContent.shortsGroups).toEqual([
      {
        id: 'ig-cut',
        name: 'IG cut',
        title: '',
        description: '',
        tags: [],
        platforms: ['instagram'],
        languages: ['en'],
      },
    ]);

    const when = IN_A_DAY();
    const scheduled = await call('schedule_publish', {
      episodeId,
      targets: [
        {
          connectionId: yt,
          contentType: 'full',
          title: 'Pilot',
          scheduledAt: when,
        },
        {
          connectionId: ig,
          contentType: 'short',
          shortsGroupId: 'ig-cut',
          title: 'Pilot, the short',
          scheduledAt: when,
        },
      ],
    });
    expect(scheduled.isError, scheduled.text).toBe(false);

    const rows = await publishesOf(episodeId);
    expect(rows).toEqual([
      expect.objectContaining({
        platform: 'instagram',
        platform_connection_id: ig,
        content_type: 'short',
        status: 'scheduled',
        language: 'en',
        metadata: expect.objectContaining({
          shortsGroupId: 'ig-cut',
          createdVia: 'mcp',
        }),
      }),
      expect.objectContaining({
        platform: 'youtube',
        platform_connection_id: yt,
        content_type: 'full',
        status: 'scheduled',
        // KB-30: the channel's own answer, declared on the row
        metadata: expect.objectContaining({ madeForKids: false }),
      }),
    ]);

    // --- Refused before anything is written: the IG cut to YouTube, and a
    // time already gone
    const wrongPlatform = await call('schedule_publish', {
      episodeId,
      targets: [
        {
          connectionId: ig,
          contentType: 'full',
          title: 'Fine on its own',
          scheduledAt: when,
        },
        {
          connectionId: yt,
          contentType: 'short',
          shortsGroupId: 'ig-cut',
          title: 'Wrong cut',
          scheduledAt: when,
        },
      ],
    });
    expect(wrongPlatform.isError).toBe(true);
    expect(wrongPlatform.text).toContain(
      'The Shorts group "IG cut" isn\'t set to go to YouTube.',
    );

    const past = await call('schedule_publish', {
      episodeId,
      targets: [
        {
          connectionId: yt,
          contentType: 'full',
          title: 'Too late',
          scheduledAt: new Date(Date.now() - 60_000).toISOString(),
        },
      ],
    });
    expect(past.isError).toBe(true);
    expect(past.text).toContain('must be in the future');
    expect(await publishesOf(episodeId)).toHaveLength(2);

    // --- Cancelled before it goes out: the row is gone, the other stays
    const youtubeRow = rows.find((row) => row.platform === 'youtube')!;
    const cancelled = await call('cancel_scheduled_publish', {
      publishId: youtubeRow.id,
    });
    expect(cancelled.isError, cancelled.text).toBe(false);
    expect((await publishesOf(episodeId)).map((row) => row.platform)).toEqual([
      'instagram',
    ]);

    const again = await call('cancel_scheduled_publish', {
      publishId: youtubeRow.id,
    });
    expect(again.isError).toBe(true);
    expect(again.text).toContain('Publish record not found');
  });

  test('builds a YouTube cut and an Instagram cut over MCP, uploads a short into each and schedules each to its own platform', async () => {
    const { yt, ig, episodeId, call } = await fixture(
      { scopes: ['studio:read', 'studio:write', 'studio:publish'] },
      { seedGroups: false },
    );

    const ytCut = await call('upsert_shorts_group', {
      episodeId,
      name: 'YT cut',
      platforms: ['youtube'],
    });
    const igCut = await call('upsert_shorts_group', {
      episodeId,
      name: 'IG/FB cut',
      platforms: ['instagram', 'facebook'],
    });
    expect(ytCut.isError, ytCut.text).toBe(false);
    const ytId = (ytCut.structuredContent.shortsGroup as { id: string }).id;
    const igId = (igCut.structuredContent.shortsGroup as { id: string }).id;

    // A short goes into its group, not over the episode video
    for (const shortsGroupId of [ytId, igId]) {
      const finalized = await uploadVideo(call, episodeId, { shortsGroupId });
      expect(finalized.isError, finalized.text).toBe(false);
    }

    // The second save: rename, and the platforms stay
    const renamed = await call('upsert_shorts_group', {
      episodeId,
      shortsGroupId: ytId,
      name: 'YouTube cut',
      title: 'Pilot #shorts',
    });
    expect(renamed.isError, renamed.text).toBe(false);

    const listed = await call('list_episode_publishes', { episodeId });
    expect(listed.structuredContent.shortsGroups).toEqual([
      expect.objectContaining({
        id: ytId,
        name: 'YouTube cut',
        title: 'Pilot #shorts',
        platforms: ['youtube'],
        languages: ['en'],
      }),
      expect.objectContaining({
        id: igId,
        platforms: ['instagram', 'facebook'],
        languages: ['en'],
      }),
    ]);

    const [row] = await readRows<{
      localized_videos: Record<string, string>;
      shorts_groups: Array<{ id: string; videos: Record<string, string> }>;
    }>('episodes', `id=eq.${episodeId}&select=localized_videos,shorts_groups`);
    expect(row!.localized_videos.en).toBe(episodeVideoUrl(episodeId, 'en'));
    expect(row!.shorts_groups[0]!.videos.en).not.toBe(
      row!.shorts_groups[1]!.videos.en,
    );

    const when = IN_A_DAY();
    const scheduled = await call('schedule_publish', {
      episodeId,
      targets: [
        {
          connectionId: yt,
          contentType: 'short',
          shortsGroupId: ytId,
          title: 'YT short',
          scheduledAt: when,
        },
        {
          connectionId: ig,
          contentType: 'short',
          shortsGroupId: igId,
          title: 'IG short',
          scheduledAt: when,
        },
      ],
    });
    expect(scheduled.isError, scheduled.text).toBe(false);
    expect(
      (await publishesOf(episodeId)).map((p) => [
        p.platform,
        p.metadata.shortsGroupId,
      ]),
    ).toEqual([
      ['instagram', igId],
      ['youtube', ytId],
    ]);

    // A group a scheduled publish uses is not deleted under it
    const deleted = await call('delete_shorts_group', {
      episodeId,
      shortsGroupId: ytId,
    });
    expect(deleted.isError).toBe(true);
    expect(deleted.text).toContain('cancel_scheduled_publish');
  });

  test('a connection without studio:publish reads the publishes but cannot schedule', async () => {
    const { yt, episodeId, call } = await fixture({
      scopes: ['studio:read', 'studio:write'],
    });

    const listed = await call('list_episode_publishes', { episodeId });
    expect(listed.isError).toBe(false);

    const refused = await call('schedule_publish', {
      episodeId,
      targets: [
        {
          connectionId: yt,
          contentType: 'full',
          title: 'Pilot',
          scheduledAt: IN_A_DAY(),
        },
      ],
    });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toMatchObject({ code: 'FORBIDDEN' });
    expect(refused.text).toContain('tick "Schedule publishes"');
    expect(await publishesOf(episodeId)).toHaveLength(0);
  });
});
