import { expect, test } from '@playwright/test';

import { callMcpTool, mintPersonalAccessToken } from '../utils/mcp';
import { headerOnlyMp4 } from '../utils/mp4';
import {
  insertRow,
  seedProject,
  seedTeamAccount,
  serviceRoleAuth,
  uniqueStamp,
} from '../utils/seed';

/**
 * FILM-2204: an external AI makes seasons and publishes what it has, over
 * MCP, through the functions the web calls. J1 (seasons first) and J2 (an
 * episode from a finished video, and from a video already on YouTube), and
 * FILM-2206 J5 (a follow-up).
 */
test.describe('Flexible production over MCP', () => {
  async function connect() {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const token = await mintPersonalAccessToken(team);

    return { project, call: callMcpTool.bind(null, token) };
  }

  test('seasons first: an empty season, an episode in it, reorder, delete keeps the episode', async () => {
    const { project, call } = await connect();

    const first = await call('create_season', {
      projectId: project.id,
      name: 'Origins',
    });
    const second = await call('create_season', {
      projectId: project.id,
      name: 'Ashes',
    });
    expect(first.isError).toBe(false);

    const a = first.structuredContent.season as { id: string; version: number };
    const b = second.structuredContent.season as { id: string };

    const empty = await call('list_seasons', { projectId: project.id });
    expect(empty.structuredContent.seasons).toEqual([
      expect.objectContaining({ name: 'Origins', episodeCount: 0 }),
      expect.objectContaining({ name: 'Ashes', episodeCount: 0 }),
    ]);

    const episode = await call('create_episode', {
      projectId: project.id,
      seasonId: a.id,
      title: 'Pilot',
    });
    const episodeId = (episode.structuredContent.episode as { id: string }).id;

    const reordered = await call('reorder_seasons', {
      projectId: project.id,
      seasonIds: [b.id, a.id],
    });
    expect(
      (reordered.structuredContent.seasons as Array<{ name: string }>).map(
        (season) => season.name,
      ),
    ).toEqual(['Ashes', 'Origins']);

    const seasons = await call('list_seasons', { projectId: project.id });
    const origins = (
      seasons.structuredContent.seasons as Array<{
        id: string;
        version: number;
      }>
    ).find((season) => season.id === a.id)!;

    const deleted = await call('delete_season', {
      seasonId: a.id,
      version: origins.version,
    });
    expect(deleted.structuredContent).toMatchObject({ episodesMoved: 1 });

    const unsorted = await call('list_episodes', {
      projectId: project.id,
      seasonId: null,
    });
    expect(unsorted.structuredContent.episodes).toEqual([
      expect.objectContaining({ id: episodeId, seasonId: null }),
    ]);
  });

  test('from a finished video: no story, screenplay or shots, and the episode is ready', async () => {
    const { project, call } = await connect();

    const created = await call('create_episode', {
      projectId: project.id,
      title: 'Finished elsewhere',
    });
    const episodeId = (created.structuredContent.episode as { id: string }).id;

    const screenplay = await call('start_generation', {
      stage: 'screenplay',
      episodeId,
    });
    expect(screenplay.isError).toBe(true);
    expect(screenplay.structuredContent).toMatchObject({
      code: 'MISSING_INPUTS',
      details: { missing: ['story'] },
    });

    const file = Buffer.from(
      headerOnlyMp4({ seconds: 4, width: 1920, height: 1080 }),
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

    const finalized = await call('finalize_episode_video', {
      episodeId,
      language: 'en',
      key: upload.key,
    });
    expect(finalized.structuredContent).toMatchObject({ status: 'ready' });

    const episode = await call('get_episode', { episodeId });
    expect(episode.structuredContent.publishReadiness).toMatchObject({
      hasVideo: true,
      canPublish: true,
      languages: ['en'],
    });
  });

  test('a video already on YouTube links once, and only once', async () => {
    const { project, call } = await connect();
    const url = `https://www.youtube.com/watch?v=${uniqueStamp().slice(0, 11)}`;

    const ids = [];
    for (const title of ['First', 'Second']) {
      const created = await call('create_episode', {
        projectId: project.id,
        title,
      });
      ids.push((created.structuredContent.episode as { id: string }).id);
    }

    const linked = await call('link_published_video', {
      episodeId: ids[0],
      platform: 'youtube',
      platformUrl: url,
    });
    expect(linked.isError).toBe(false);

    const again = await call('link_published_video', {
      episodeId: ids[1],
      platform: 'youtube',
      platformUrl: url,
    });
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/already linked to another episode/);
  });

  // FILM-2206: the follow-up's snapshot is frozen at creation and leads
  // the story brief
  test('a follow-up carries what its source did into the story brief', async () => {
    const { project, call } = await connect();

    const source = await call('create_episode', {
      projectId: project.id,
      title: 'The Gate',
      description: 'A keeper opens a door that was never there.',
    });
    const sourceId = (source.structuredContent.episode as { id: string }).id;

    const followUp = await call('create_episode', {
      projectId: project.id,
      title: 'Through the Gate',
      description: 'What came through the door.',
      followUpOf: sourceId,
    });
    expect(followUp.isError, followUp.text).toBe(false);
    const followUpId = (followUp.structuredContent.episode as { id: string })
      .id;

    const started = await call('start_generation', {
      stage: 'story',
      episodeId: followUpId,
    });
    expect(started.isError, started.text).toBe(false);

    const brief = started.structuredContent.brief as {
      instructions: string;
      context: { followUp?: { episodeId: string; title: string } };
    };
    expect(brief.instructions).toContain(
      'This episode follows up Episode 1, "The Gate"',
    );
    expect(brief.context.followUp).toMatchObject({
      episodeId: sourceId,
      title: 'The Gate',
    });

    // An episode of another project is refused, and nothing is created
    const other = await seedProject(await seedTeamAccount());
    const stray = await insertRow<{ id: string }>(
      'episodes',
      {
        project_id: other.id,
        number: 1,
        title: 'Elsewhere',
        slug: `elsewhere-${uniqueStamp()}`,
      },
      serviceRoleAuth(),
    );
    const refused = await call('create_episode', {
      projectId: project.id,
      title: 'Stray',
      followUpOf: stray.id,
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/live episode of this project/);
  });
});
