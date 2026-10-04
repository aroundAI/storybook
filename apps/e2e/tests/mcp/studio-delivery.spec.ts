import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';

import { mintPersonalAccessToken } from '../utils/mcp';
import { headerOnlyMp4 } from '../utils/mp4';
import {
  readRows,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import { MCP_URL } from './oauth-client';

/**
 * FILM-2003: StorybookStudio sends a finished cut back over MCP and the
 * publish page offers it. A scripted SDK client, with a personal access
 * token, opens an edit session (FILM-2002's open_edit_session), requests two render uploads (16:9 and 9:16),
 * PUTs a fixture MP4 to each presigned URL, finalizes them, is told
 * TARGET_CHANGED when the episode changed during the edit, and delivers
 * against the current version. The publish page then lists both renders:
 * the 16:9 one is the primary and already the English video; the 9:16 one
 * is added as a Short, which a reload still shows.
 *
 * Screenshots for the PR are written only when CAPTURE_EVIDENCE is set.
 */
const EVIDENCE = process.env.CAPTURE_EVIDENCE
  ? (process.env.EVIDENCE_DIR ?? 'evidence')
  : null;

type ToolResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

const QA = { pass: true, issues: [] };

const REPORT = {
  versions: [
    {
      id: 'v1',
      label: 'Rough cut',
      parentId: null,
      createdAt: '2026-10-04T10:00:00Z',
      origin: 'rough_cut',
    },
    {
      id: 'v2',
      label: 'AI cut v2',
      parentId: 'v1',
      createdAt: '2026-10-04T10:05:00Z',
      origin: 'ai',
    },
  ],
  finalDuration: 12,
  aiOps: 4,
  userOps: 1,
  explain: {
    plan: 'Make it 12 seconds',
    scenes: [
      {
        scene: 1,
        durationBefore: 18,
        durationAfter: 12,
        changes: [
          {
            action: 'trimmed',
            target: 'Shot 1.1',
            reason: 'Information already given by dialogue',
            before: 6,
            after: 3,
            by: 'ai',
          },
        ],
      },
    ],
  },
};

test.describe('StorybookStudio delivers renders over MCP (FILM-2003)', () => {
  test('request, upload, finalize and deliver; the publish page offers the renders', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const team = await seedTeamAccount({ emailPrefix: 'film2003' });
    const project = await seedProject(team);
    const { episodeId, slug } = await seedEpisodeWithShot(project.id);
    await updateRows('episodes', `id=eq.${episodeId}`, { status: 'ready' });

    const token = await mintPersonalAccessToken(team, {
      name: 'StorybookStudio',
      scopes: ['studio:read', 'studio:write'],
    });
    const client = new Client({ name: 'StorybookStudio', version: '0.1.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(MCP_URL), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );

    const call = (name: string, args: Record<string, unknown>) =>
      client.callTool({ name, arguments: args }) as Promise<ToolResult>;

    const renders: Record<string, string> = {};

    try {
      // What the Studio does first (FILM-2002): open a session
      const open = await call('open_edit_session', {
        episodeId,
        packageEtag: 'e2e@v1',
      });
      expect(open.isError, JSON.stringify(open)).toBeFalsy();
      const opened = {
        session: { id: open.structuredContent!.sessionId as string },
        episodeVersion: open.structuredContent!.episodeVersion as number,
      };

      for (const [preset, aspect, width, height] of [
        ['youtube_16x9', '16:9', 1920, 1080],
        ['shorts_9x16', '9:16', 1080, 1920],
      ] as const) {
        const file = headerOnlyMp4({ seconds: 12, width, height });

        const requested = await call('request_render_upload', {
          sessionId: opened.session.id,
          preset,
          language: 'en',
          aspect,
          bytes: file.byteLength,
          contentType: 'video/mp4',
        });
        expect(requested.isError, JSON.stringify(requested)).toBeFalsy();

        const upload = requested.structuredContent as {
          renderId: string;
          key: string;
          uploadUrl: string;
          headers: Record<string, string>;
        };
        expect(upload.key).toBe(
          `projects/${project.id}/episodes/${episodeId}/renders/${upload.renderId}.mp4`,
        );

        // Before the PUT there is nothing to finalize: refused, not ready
        if (preset === 'shorts_9x16') {
          const early = await call('finalize_render', {
            renderId: upload.renderId,
            durationSeconds: 12,
            qa: QA,
          });
          expect(early.isError).toBe(true);
          expect(early.structuredContent).toMatchObject({
            code: 'VALIDATION_FAILED',
            details: { status: 'failed' },
          });

          // A failed render is not reused: request a new upload
          const again = await call('request_render_upload', {
            sessionId: opened.session.id,
            preset,
            language: 'en',
            aspect,
            bytes: file.byteLength,
            contentType: 'video/mp4',
          });
          Object.assign(upload, again.structuredContent);
        }

        const put = await fetch(upload.uploadUrl, {
          method: 'PUT',
          headers: upload.headers,
          body: file,
        });
        expect(put.ok, await put.text()).toBe(true);

        const finalized = await call('finalize_render', {
          renderId: upload.renderId,
          durationSeconds: 12,
          qa: QA,
        });
        expect(finalized.isError, JSON.stringify(finalized)).toBeFalsy();
        expect(finalized.structuredContent).toMatchObject({
          status: 'ready',
          bytes: file.byteLength,
        });

        renders[preset] = upload.renderId;
      }

      const delivery = {
        sessionId: opened.session.id,
        renders: [
          { renderId: renders.youtube_16x9, primary: true },
          { renderId: renders.shorts_9x16 },
        ],
        report: REPORT,
        qa: QA,
      };

      // The episode changes in StoryBook during the edit
      await updateRows('episodes', `id=eq.${episodeId}`, {
        description: 'Changed in StoryBook while the Studio edited',
      });

      const stale = await call('deliver_edit', {
        ...delivery,
        episodeVersion: opened.episodeVersion,
      });
      expect(stale.isError).toBe(true);
      expect(stale.structuredContent).toMatchObject({
        code: 'TARGET_CHANGED',
        details: { expectedVersion: opened.episodeVersion },
      });
      const currentVersion = (
        stale.structuredContent!.details as { currentVersion: number }
      ).currentVersion;
      expect(currentVersion).toBeGreaterThan(opened.episodeVersion);

      // Re-synced: deliver against the current version
      const delivered = await call('deliver_edit', {
        ...delivery,
        episodeVersion: currentVersion,
      });
      expect(delivered.isError, JSON.stringify(delivered)).toBeFalsy();
      expect(delivered.structuredContent).toMatchObject({
        ok: true,
        episodeStatus: 'ready',
        primaryRenderId: renders.youtube_16x9,
      });
    } finally {
      await client.close();
    }

    const [episode] = await readRows<{
      status: string;
      final_video_url: string;
      master_video_asset_id: string | null;
      localized_videos: Record<string, string>;
    }>(
      'episodes',
      `id=eq.${episodeId}&select=status,final_video_url,master_video_asset_id,localized_videos`,
    );
    expect(episode!.status).toBe('ready');
    expect(episode!.final_video_url).toContain(
      `/renders/${renders.youtube_16x9}.mp4`,
    );
    expect(episode!.master_video_asset_id).not.toBeNull();
    expect(episode!.localized_videos.en).toBe(episode!.final_video_url);

    // The stored file is the one the Studio sent
    const stored = await fetch(episode!.final_video_url);
    expect(stored.status).toBe(200);

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/publish`,
    );

    const picker = byTest(page, 'render-picker');
    await expect(picker).toBeVisible();
    await expect(byTest(picker, 'render-row')).toHaveCount(2);

    const primary = picker.locator(
      `[data-test="render-row"][data-render-id="${renders.youtube_16x9}"]`,
    );
    const vertical = picker.locator(
      `[data-test="render-row"][data-render-id="${renders.shorts_9x16}"]`,
    );

    await expect(byTest(primary, 'render-primary')).toBeVisible();
    await expect(byTest(primary, 'render-in-use')).toHaveText(
      /English full video/,
    );
    await expect(byTest(primary, 'render-facts')).toContainText('16:9 · 0:12');
    await expect(byTest(vertical, 'render-facts')).toContainText(
      'for TikTok, Reels and YouTube Shorts',
    );
    await expect(byTest(vertical, 'render-add-short')).toBeVisible();

    if (EVIDENCE) {
      await picker.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${EVIDENCE}/film-2003-01-publish-page-renders.png`,
        fullPage: false,
      });
    }

    await byTest(vertical, 'render-add-short').click();
    await expect(byTest(vertical, 'render-in-shorts')).toBeVisible();

    // After a reload the page reads the saved Shorts group, not client state
    await page.reload();
    const reloaded = byTest(page, 'render-picker').locator(
      `[data-test="render-row"][data-render-id="${renders.shorts_9x16}"]`,
    );
    await expect(byTest(reloaded, 'render-in-shorts')).toBeVisible();

    const [saved] = await readRows<{
      shorts_groups: Array<{ videos: Record<string, string> }>;
    }>('episodes', `id=eq.${episodeId}&select=shorts_groups`);
    expect(saved!.shorts_groups.at(-1)!.videos.en).toContain(
      `/renders/${renders.shorts_9x16}.mp4`,
    );

    if (EVIDENCE) {
      await byTest(page, 'render-picker').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${EVIDENCE}/film-2003-02-short-added-after-reload.png`,
        fullPage: false,
      });
    }
  });
});
