import { type Page, expect, test } from '@playwright/test';

import {
  connectThroughSandbox,
  failNext,
  lastLedgerId,
  ledger,
  sandboxRun,
  storedConnections,
} from '../utils/sandbox';
import {
  type SeededTeam,
  episodeVideoUrl,
  readRows,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  serviceRoleAuth,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-1804 §2 "Publish" and the publish half of "Vendor errors": an episode
 * published from the Publishing Studio, inline (publishToAllAction), to a
 * YouTube channel connected through the sandbox's consent screen. The
 * upload reaches the sandbox, which creates the video; the publish row
 * holds the id the vendor gave it. Then the vendor refuses an upload — a
 * rate limit, then a 5xx — and the dialog says it failed and why, and the
 * next attempt from the same screen goes through.
 *
 * The scheduled path (cron → publish queue → worker) is
 * `sandbox/publish-queue-evidence.spec.ts` (FILM-1806).
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const shoot = Boolean(process.env.CAPTURE_EVIDENCE);
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:55321';

interface Fixture {
  team: SeededTeam;
  episodeId: string;
  connectionId: string;
  publishUrl: string;
}

/** A team, a YouTube channel connected through the sandbox, an episode with its video. */
async function readyToPublish(page: Page, prefix: string): Promise<Fixture> {
  const team = await seedTeamAccount({ emailPrefix: prefix });
  await signInAs(page, team);
  await connectThroughSandbox(page, team.slug, 'youtube');
  const [connection] = await storedConnections(team.accountId, 'youtube');

  // The channel's audience and category, which the first publish to a
  // channel otherwise asks for (KB-30, `youtube-audience.spec.ts`).
  await updateRows('platform_connections', `id=eq.${connection!.id}`, {
    youtube_made_for_kids: false,
    youtube_category_id: '22',
  });

  const project = await seedProject(team);
  const { episodeId, slug } = await seedEpisodeWithShot(project.id);

  // The episode's own video, in its videos folder (KB-123): the YouTube
  // upload sends its bytes.
  const auth = serviceRoleAuth();
  const upload = await fetch(
    `${SUPABASE_URL}/storage/v1/object/project-assets/episodes/${episodeId}/videos/en-1.mp4`,
    {
      method: 'POST',
      headers: {
        apikey: auth.key,
        Authorization: `Bearer ${auth.key}`,
        'Content-Type': 'video/mp4',
      },
      body: new Uint8Array(4096).fill(7),
    },
  );
  expect(upload.status, await upload.text()).toBeLessThan(300);
  await updateRows('episodes', `id=eq.${episodeId}`, {
    localized_videos: { en: episodeVideoUrl(episodeId) },
  });

  return {
    team,
    episodeId,
    connectionId: connection!.id,
    publishUrl: `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/publish`,
  };
}

/**
 * Publish All → Confirm, and the dialog once every upload has answered: its
 * button reads Done (some went out) or Close (all failed), the only two ways
 * it ends.
 */
async function publishAll(page: Page) {
  // A click before the page has hydrated and loaded its channels does
  // nothing, and there is no hook that says it has: retry the click until
  // the confirm step opens.
  await expect(async () => {
    await byTest(page, 'publish-all').click();
    await expect(byTest(page, 'confirm-publish')).toBeVisible({
      timeout: 5_000,
    });
  }).toPass({ timeout: 60_000 });
  await byTest(page, 'confirm-publish').click();
  const close = byTest(page, 'publish-dialog-close');
  await expect(close).toBeVisible({ timeout: 120_000 });

  return close;
}

async function publishesOf(episodeId: string) {
  return readRows<{
    id: string;
    status: string;
    platform_content_id: string | null;
    metadata: { error?: string } | null;
  }>(
    'publishes',
    `episode_id=eq.${episodeId}&order=created_at&select=id,status,platform_content_id,metadata`,
  );
}

test.describe('Publishing to a sandbox channel (FILM-1804)', () => {
  sandboxRun();
  test.describe.configure({ timeout: 240_000 });

  test('Publish All uploads to YouTube, and the publish holds the id the vendor gave the video', async ({
    page,
  }) => {
    const fixture = await readyToPublish(page, 'sbx-publish');
    await page.goto(fixture.publishUrl);

    const since = await lastLedgerId();
    await expect(await publishAll(page)).toHaveText('Done');
    await expect(byTest(page, 'publish-platform-status')).toHaveAttribute(
      'data-status',
      'success',
    );
    await expect(byTest(page, 'publish-error')).toHaveCount(0);
    if (shoot)
      await page.screenshot({ path: `${OUT}/publish-1-youtube-done.png` });

    const [published, ...others] = await publishesOf(fixture.episodeId);
    expect(others).toEqual([]);
    expect(published!.status).toBe('published');

    // The id is the one the sandbox created for this upload, read off the
    // ledger, not one the app made up.
    const uploads = (await ledger('google', since)).filter(
      (entry) =>
        entry.method === 'POST' &&
        entry.path === '/upload/youtube/v3/videos' &&
        entry.status === 200,
    );
    expect(uploads.map((entry) => entry.object)).toContain(
      published!.platform_content_id,
    );
  });

  // YouTube answers a rate limit with 403 quotaExceeded, not 429, and the
  // sandbox serves it the way YouTube does.
  for (const { status, served, kind } of [
    { status: 429, served: 403, kind: 'rate-limit' },
    { status: 503, served: 503, kind: '5xx' },
  ] as const) {
    test(`a ${kind} (${status}) from YouTube's upload is shown as a failed publish with the vendor's reason, and the retry publishes`, async ({
      page,
    }) => {
      const fixture = await readyToPublish(page, `sbx-publish-${kind}`);
      await page.goto(fixture.publishUrl);

      const since = await lastLedgerId();
      await failNext({
        vendor: 'google',
        status,
        pathIncludes: '/upload/youtube/v3/videos',
      });
      await expect(await publishAll(page)).toHaveText('Close');
      await expect(byTest(page, 'publish-error')).toContainText(
        'All 1 platform(s) failed to publish.',
      );
      if (shoot)
        await page.screenshot({ path: `${OUT}/publish-2-${kind}-dialog.png` });

      // What the vendor said, from the ledger: its own error body.
      const [refused] = (await ledger('google', since)).filter(
        (entry) => entry.injectedFailure,
      );
      expect(refused!.status).toBe(served);
      const vendorMessage = (
        JSON.parse(refused!.responseSummary!) as {
          error: { message: string };
        }
      ).error.message;

      const [row] = await publishesOf(fixture.episodeId);
      expect(row!.status).toBe('failed');
      expect(row!.platform_content_id).toBeNull();
      expect(row!.metadata?.error).toBe(vendorMessage);

      // The screen's record of the attempt says it failed, and why, in the
      // vendor's words: not a blank, and not "Unknown error".
      await byTest(page, 'publish-dialog-close').click();
      const item = page.locator(
        `[data-test="published-content-item"][data-publish-id="${row!.id}"]`,
      );
      await expect(item).toHaveAttribute('data-status', 'failed');
      await expect(byTest(item, 'published-content-error')).toHaveText(
        vendorMessage,
      );
      if (shoot)
        await page.screenshot({ path: `${OUT}/publish-3-${kind}-record.png` });

      // --- The second submission, from the screen the failure left.
      await expect(await publishAll(page)).toHaveText('Done');
      const rows = await publishesOf(fixture.episodeId);
      expect(rows.map((r) => r.status).sort()).toEqual(['failed', 'published']);
      if (shoot)
        await page.screenshot({ path: `${OUT}/publish-4-${kind}-retried.png` });
    });
  }
});
