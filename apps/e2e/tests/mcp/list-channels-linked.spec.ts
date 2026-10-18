import { type Page, expect, test } from '@playwright/test';

import { encryptLikeTheApp } from '../utils/crypto';
import {
  type McpToolCall,
  callMcpTool,
  mintPersonalAccessToken,
} from '../utils/mcp';
import { headerOnlyMp4 } from '../utils/mp4';
import {
  type SeededTeam,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  seedYouTubeConnection,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest, visible } from '../utils/visible';

/**
 * KB-199. The producer's MCP session saw no channel for a project whose
 * channels were all linked, because `list_channels(projectId)` listed the
 * channels the project had *published* from, and nothing had been
 * published yet. Linked on the Publish screen, the channels are listed at
 * once, and they are the ones `schedule_release` accepts.
 */

test.skip(
  !process.env.ENCRYPTION_KEY,
  'Seeds a channel token the server decrypts: needs the server’s ENCRYPTION_KEY',
);

const ZONE = 'Asia/Kolkata';
const IN_A_DAY = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString();

async function channel(team: SeededTeam, name: string, platform: string) {
  const id = await seedYouTubeConnection(team.accountId, name, {
    platform,
    platformAccountId: `${platform}-kb199-${name.replace(/\W/g, '')}-${team.accountId.slice(0, 8)}`,
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

/** Links the channels on the Publish screen, as the owner does. */
async function linkOnPublishScreen(page: Page, url: string, ids: string[]) {
  await page.goto(url);
  await byTest(page, 'choose-project-channels').first().click({
    timeout: 60_000,
  });

  const picker = byTest(page, 'project-channel-picker');
  await expect(picker).toBeVisible();

  for (const id of ids) {
    const box = visible(
      picker,
      `[data-test="project-channel-checkbox"][data-channel-id="${id}"]`,
    );
    await box.click();
    await expect(box).toHaveAttribute('data-state', 'checked');
  }

  await byTest(picker, 'project-channels-save').click();
  await expect(picker).toBeHidden();
  await expect(
    visible(
      page,
      '[data-test="project-channels-language"][data-lang="en"] [data-test="channel-badge"]',
    ),
  ).toHaveCount(ids.length);
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

test.describe('list_channels lists the channels a project links (KB-199)', () => {
  test('linked on the Publish screen, nothing published: listed, and schedule_release previews to them', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const team = await seedTeamAccount({ emailPrefix: 'kb199' });
    const yt = await channel(team, 'Ledger YT', 'youtube');
    const fb = await channel(team, 'Ledger FB', 'facebook');
    const ig = await channel(team, 'Ledger IG', 'instagram');
    const elsewhere = await channel(team, 'Other project YT', 'youtube');
    const project = await seedProject(team, { name: 'Ledger Autopsy' });
    const { episodeId, slug } = await seedEpisodeWithShot(project.id);

    const token = await mintPersonalAccessToken(team, {
      scopes: ['studio:read', 'studio:write', 'studio:publish'],
    });
    const call: Call = callMcpTool.bind(null, token);

    const listed = async () =>
      (
        (await ok(call, 'list_channels', { projectId: project.id }))
          .structuredContent.data as Array<{
          connectionId: string;
          linked: boolean;
        }>
      )
        .map(({ connectionId, linked }) => `${connectionId}:${linked}`)
        .sort();

    // --- The episode video, so the Publish screen offers its channels.
    const video = Buffer.from(
      headerOnlyMp4({ seconds: 4, width: 1920, height: 1080 }),
    );
    const requested = await ok(call, 'request_episode_video_upload', {
      episodeId,
      language: 'en',
      contentType: 'video/mp4',
      bytes: video.byteLength,
    });
    const signed = requested.structuredContent as {
      key: string;
      uploadUrl: string;
      headers: Record<string, string>;
    };
    const put = await fetch(signed.uploadUrl, {
      method: 'PUT',
      headers: signed.headers,
      body: video,
    });
    expect(put.ok).toBe(true);
    await ok(call, 'finalize_episode_video', {
      episodeId,
      language: 'en',
      key: signed.key,
    });

    // --- Nothing linked yet: no channel is the project's.
    expect(await listed()).toEqual([]);

    await signInAs(page, team);
    await linkOnPublishScreen(
      page,
      `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/publish`,
      [yt, fb, ig],
    );

    // --- Linked, nothing published: all three, and not the team's fourth.
    expect(await listed()).toEqual(
      [`${yt}:true`, `${fb}:true`, `${ig}:true`].sort(),
    );
    expect((await listed()).join()).not.toContain(elsewhere);

    // --- What it listed is what scheduling accepts.
    for (const connectionId of [yt, fb]) {
      await ok(call, 'set_channel_cadence', {
        connectionId,
        contentType: 'full',
        timezone: ZONE,
        slotTimes: ['08:00'],
        minDaysBetween: 3,
      });
    }

    const preview = await ok(call, 'schedule_release', {
      episodeId,
      notBefore: IN_A_DAY(),
      timezone: ZONE,
      preview: true,
      targets: [
        { connectionId: yt, contentType: 'full', title: 'Case 1' },
        { connectionId: fb, contentType: 'full', title: 'Case 1' },
      ],
    });
    expect(JSON.stringify(preview.structuredContent)).toContain(yt);
    expect(JSON.stringify(preview.structuredContent)).toContain(fb);

    // --- A channel list_channels did not list is refused.
    const refused = await call('schedule_release', {
      episodeId,
      notBefore: IN_A_DAY(),
      timezone: ZONE,
      preview: true,
      targets: [{ connectionId: elsewhere, contentType: 'full', title: 'X' }],
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("isn't one of this project's channels");
  });
});
