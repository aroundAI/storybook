import { expect, test } from '@playwright/test';

import {
  insertRow,
  readRows,
  seedProject,
  seedTeamAccount,
  serviceRoleAuth,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-1806's publish queue: a scheduled publish goes out the way production
 * sends one - the scheduled-publish cron finds it due, queues it on the
 * publish queue, and the publish worker's own handler uploads the episode's
 * video to YouTube, here FILM-1802's sandbox. The channel is connected
 * through the app's real OAuth flow and the sandbox's consent page, so the
 * worker holds tokens the sandbox itself issued.
 *
 * Needs `./scripts/local-env.sh up` and an app started with local.env, as
 * studio-flow-evidence.spec.ts does. Skipped otherwise, and so in CI:
 *
 *   PUBLISH_QUEUE_EVIDENCE=1 PLAYWRIGHT_BASE_URL=http://localhost:3144 \
 *     npx playwright test publish-queue-evidence
 */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:55321';
const CONTROL = process.env.SANDBOX_CONTROL_URL ?? 'http://127.0.0.1:4100';
// The cron runs every five minutes in the local runner.
const CRON_TIMEOUT = 7 * 60_000;

interface LedgerEntry {
  id: number;
  vendor: string;
  path: string;
  method?: string;
  status: number;
}

async function ledger() {
  const response = await fetch(`${CONTROL}/__sandbox/ledger`);
  return ((await response.json()) as { entries: LedgerEntry[] }).entries;
}

test.describe('A scheduled publish through the local publish queue (FILM-1806)', () => {
  test.skip(
    !process.env.PUBLISH_QUEUE_EVIDENCE,
    'Set PUBLISH_QUEUE_EVIDENCE=1, with the sandbox, the local job queue and a local.env app running.',
  );

  test('the cron queues it and the publish worker uploads it to YouTube', async ({
    page,
  }) => {
    test.setTimeout(2 * CRON_TIMEOUT + 240_000);

    const team = await seedTeamAccount({ emailPrefix: 'publish-queue' });
    const project = await seedProject(team, {
      name: 'Harbor Lights Diner',
      slug: `harbor-lights-${Date.now()}`,
    });
    const auth = serviceRoleAuth();

    const episodeSlug = `the-letter-${Date.now()}`;
    const episode = await insertRow<Array<{ id: string }>>(
      'episodes',
      {
        project_id: project.id,
        number: 1,
        title: 'The Letter Under the Floorboards',
        slug: episodeSlug,
      },
      auth,
    );
    const episodeId = (Array.isArray(episode) ? episode[0] : episode)!.id;

    // The publish screen unlocks once the episode has shots.
    await insertRow(
      'shots',
      { episode_id: episodeId, sequence_number: 1, prompt: 'Seeded shot' },
      auth,
    );

    // The episode's own upload, in its videos folder (KB-123).
    const key = `episodes/${episodeId}/videos/en-1.mp4`;
    const upload = await fetch(
      `${SUPABASE_URL}/storage/v1/object/project-assets/${key}`,
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
    const videoUrl = `${SUPABASE_URL}/storage/v1/object/public/project-assets/${key}`;
    const patched = await fetch(
      `${SUPABASE_URL}/rest/v1/episodes?id=eq.${episodeId}`,
      {
        method: 'PATCH',
        headers: {
          apikey: auth.key,
          Authorization: `Bearer ${auth.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ final_video_url: videoUrl }),
      },
    );
    expect(patched.status).toBeLessThan(300);

    // Connect YouTube as a user does: the app's connect route, the sandbox's
    // consent page, the app's callback.
    await signInAs(page, team);
    await page.goto(
      `/api/platforms/connect/youtube?accountId=${team.accountId}&returnUrl=/home/${team.slug}/settings/platforms`,
    );
    await page
      .locator('[data-test="sandbox-consent-allow"]')
      .click({ timeout: 30_000 });
    await page.waitForURL(/\/settings\/platforms/);

    const connections = await readRows<{ id: string }>(
      'platform_connections',
      `account_id=eq.${team.accountId}&platform=eq.youtube&is_active=eq.true&select=id`,
    );
    expect(connections).toHaveLength(1);

    // The channel's audience and category, which the owner chooses in
    // Settings → Platforms before a first upload (KB-30).
    const declared = await fetch(
      `${SUPABASE_URL}/rest/v1/platform_connections?id=eq.${connections[0]!.id}`,
      {
        method: 'PATCH',
        headers: {
          apikey: auth.key,
          Authorization: `Bearer ${auth.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          youtube_made_for_kids: false,
          youtube_category_id: '22',
        }),
      },
    );
    expect(declared.status).toBeLessThan(300);

    const lastBefore = (await ledger())[0]?.id ?? 0;
    const scheduleDuePublish = async () => {
      const publish = await insertRow<Array<{ id: string }>>(
        'publishes',
        {
          episode_id: episodeId,
          platform_connection_id: connections[0]!.id,
          platform: 'youtube',
          content_type: 'full',
          title: 'The Letter Under the Floorboards',
          description: 'Episode 1',
          status: 'scheduled',
          scheduled_at: new Date(Date.now() - 60_000).toISOString(),
          language: 'en',
        },
        auth,
      );

      return (Array.isArray(publish) ? publish[0] : publish)!.id;
    };
    const publishStatus = async (id: string) =>
      (
        await readRows<{ status: string }>(
          'publishes',
          `id=eq.${id}&select=status`,
        )
      )[0]?.status;
    const publishId = await scheduleDuePublish();

    await expect
      .poll(() => publishStatus(publishId), {
        timeout: CRON_TIMEOUT,
        intervals: [5_000],
      })
      .toBe('published');

    const [row] = await readRows<{
      platform_content_id: string | null;
      platform_url: string | null;
    }>(
      'publishes',
      `id=eq.${publishId}&select=platform_content_id,platform_url`,
    );
    expect(row!.platform_content_id).toBeTruthy();

    const uploads = (await ledger()).filter(
      (e) =>
        e.id > lastBefore &&
        e.vendor === 'google' &&
        e.path.includes('/youtube/v3/videos'),
    );
    expect(uploads.length).toBeGreaterThan(0);
    for (const entry of uploads) expect(entry.status).toBeLessThan(300);

    // Unpublish from the publish screen: the delete goes through the same
    // queue to the worker's own delete handler, which calls the sandbox.
    const lastBeforeDelete = (await ledger())[0]?.id ?? 0;
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${episodeSlug}/publish`,
    );
    await page
      .locator('[data-test="publish-unpublish"]')
      .first()
      .click({ timeout: 60_000 });
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Unpublish' })
      .click({ timeout: 30_000 });

    await expect
      .poll(
        async () =>
          (await ledger()).filter(
            (e) =>
              e.id > lastBeforeDelete &&
              e.vendor === 'google' &&
              e.method === 'DELETE' &&
              e.path.startsWith('/youtube/v3/videos') &&
              e.status === 204,
          ).length,
        { timeout: 120_000 },
      )
      .toBeGreaterThan(0);

    // The unpublish removed the record once the worker had deleted the video.
    await expect
      .poll(() => publishStatus(publishId), { timeout: 60_000 })
      .toBeUndefined();

    // Delete all, from the publish screen: a second publish goes out the same
    // way, then deleteEpisodePublishesAction queues its delete and the
    // worker's own handler removes the video from the sandbox and the record
    // from the database.
    const secondPublishId = await scheduleDuePublish();
    await expect
      .poll(() => publishStatus(secondPublishId), {
        timeout: CRON_TIMEOUT,
        intervals: [5_000],
      })
      .toBe('published');

    const lastBeforeDeleteAll = (await ledger())[0]?.id ?? 0;
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${episodeSlug}/publish`,
    );
    await byTest(page, 'publish-delete-all').click({ timeout: 60_000 });
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete All' })
      .click({ timeout: 30_000 });
    await expect(page.getByText('Deleted 1 publish record(s)')).toBeVisible({
      timeout: 30_000,
    });

    await expect
      .poll(
        async () =>
          (await ledger()).filter(
            (e) =>
              e.id > lastBeforeDeleteAll &&
              e.vendor === 'google' &&
              e.method === 'DELETE' &&
              e.path.startsWith('/youtube/v3/videos') &&
              e.status === 204,
          ).length,
        { timeout: 120_000 },
      )
      .toBeGreaterThan(0);

    await expect
      .poll(
        async () =>
          (
            await readRows<{ id: string }>(
              'publishes',
              `episode_id=eq.${episodeId}&select=id`,
            )
          ).length,
        { timeout: 60_000 },
      )
      .toBe(0);
  });
});
