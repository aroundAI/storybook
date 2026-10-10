import { expect, test } from '@playwright/test';

import { encryptLikeTheApp } from '../utils/crypto';
import { callMcpTool, mintPersonalAccessToken } from '../utils/mcp';
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

async function fixture(scopes: Parameters<typeof mintPersonalAccessToken>[1]) {
  const team = await seedTeamAccount({ emailPrefix: 'mcppub' });
  const yt = await channel(team, 'Story YT EN', 'youtube');
  const ig = await channel(team, 'Story IG EN', 'instagram');
  const project = await seedProject(team, { name: 'Scheduled over MCP' });
  await addProjectChannels(project.id, [yt, ig]);
  const { episodeId } = await seedEpisodeWithShot(project.id);

  await updateRows('episodes', `id=eq.${episodeId}`, {
    localized_videos: { en: episodeVideoUrl(episodeId, 'en') },
    shorts_groups: [
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
