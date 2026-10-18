import { type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

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
  readRows,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  seedYouTubeConnection,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-2212. StoryBook takes a video up to 4.99 GB (one PUT to R2), and a
 * platform that takes less refuses it when the publish is prepared, saying
 * why, rather than in the worker after it is scheduled. Facebook takes at
 * most 20 minutes by URL: a header-only MP4 says 21 minutes in a few
 * hundred bytes, so the refusal is driven here without a gigabyte file
 * (the size refusals are unit-tested in publish-platform-limits.test.ts).
 */

test.skip(
  !process.env.ENCRYPTION_KEY,
  'Seeds a channel token the server decrypts: needs the server’s ENCRYPTION_KEY',
);

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const IN_A_DAY = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const TOO_LONG =
  "Facebook can't take this video: it is 21 minutes long, and Facebook takes at most 20 minutes. Leave Facebook out of this one.";

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== 'running'),
  );
  await page.screenshot({ path: `${OUT}/film-2212-${name}.png` });
}

async function channel(team: SeededTeam, name: string, platform: string) {
  const id = await seedYouTubeConnection(team.accountId, name, {
    platform,
    platformAccountId: `${platform}-f2212-${name.replace(/\W/g, '')}-${team.accountId.slice(0, 8)}`,
    accessTokenEncrypted: await encryptLikeTheApp(`${platform}-token`),
  });

  await updateRows('platform_connections', `id=eq.${id}`, {
    language: 'en',
    token_expires_at: IN_A_DAY(),
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

/** request → PUT → finalize, over MCP: the episode's English video */
async function uploadVideo(call: Call, episodeId: string, minutes: number) {
  const file = Buffer.from(
    headerOnlyMp4({ seconds: minutes * 60, width: 1920, height: 1080 }),
  );
  const requested = await ok(call, 'request_episode_video_upload', {
    episodeId,
    language: 'en',
    contentType: 'video/mp4',
    bytes: file.byteLength,
  });
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
  await ok(call, 'finalize_episode_video', {
    episodeId,
    language: 'en',
    key: signed.key,
  });
}

test.describe('Large uploads and each platform’s limit (FILM-2212)', () => {
  test('the upload dialog offers 4.99 GB; a video too long for Facebook is refused on the screen and over MCP, and a shorter one is taken', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const team = await seedTeamAccount({ emailPrefix: 'f2212' });
    const fb = await channel(team, 'Ledger FB', 'facebook');
    const project = await seedProject(team, { name: 'Ledger Autopsy' });
    await addProjectChannels(project.id, [fb]);
    const { episodeId, slug } = await seedEpisodeWithShot(project.id);

    const token = await mintPersonalAccessToken(team, {
      scopes: ['studio:read', 'studio:write', 'studio:publish'],
    });
    const call: Call = callMcpTool.bind(null, token);

    // --- A 21-minute episode video
    await uploadVideo(call, episodeId, 21);

    // --- The upload dialog states the limit the whole path takes
    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/publish`,
    );
    await byTest(page, 'add-full-video-language').click({ timeout: 60_000 });
    await expect(page.getByText(/MP4, MOV, WebM • Max 4\.99 GB/)).toBeVisible();
    await capture(page, '01-upload-dialog-limit');
    await page.keyboard.press('Escape');

    // --- Publish now to Facebook: refused before anything is written
    await byTest(page, 'publish-all').click();
    await byTest(page, 'confirm-publish').click();
    const row = page.locator(
      '[data-test="publish-platform-status"][data-platform="facebook"]',
    );
    await expect(row).toHaveAttribute('data-status', 'error', {
      timeout: 60_000,
    });
    await expect(byTest(row, 'publish-platform-error')).toHaveText(TOO_LONG);
    await capture(page, '02-facebook-refused-on-screen');

    // --- Scheduled over MCP: the same refusal, nothing written
    const when = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    const target = {
      connectionId: fb,
      contentType: 'full',
      title: 'Case 1',
      scheduledAt: when,
    };
    const refused = await call('schedule_publish', {
      episodeId,
      targets: [target],
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(TOO_LONG);
    expect(
      await readRows('publishes', `episode_id=eq.${episodeId}&select=id`),
    ).toEqual([]);

    // --- The second submission: a 19-minute cut is taken
    await uploadVideo(call, episodeId, 19);
    await ok(call, 'schedule_publish', { episodeId, targets: [target] });
    expect(
      await readRows<{ status: string; platform: string }>(
        'publishes',
        `episode_id=eq.${episodeId}&select=status,platform`,
      ),
    ).toEqual([{ status: 'scheduled', platform: 'facebook' }]);
  });
});
