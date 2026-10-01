import { type Page, expect, test } from '@playwright/test';

import { headerOnlyMp4 } from '../utils/mp4';
import {
  connectThroughSandbox,
  cronHeaders,
  sandboxRun,
  storedConnections,
} from '../utils/sandbox';
import {
  episodeVideoUrl,
  insertRow,
  readRows,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  serviceRoleAuth,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * FILM-1710: "Instagram's duration comes from the uploaded file at publish
 * time, or is duration_unknown". Meta never reports a Reel's length, so the
 * publish records the length of the file it sent, read from the file's own
 * MP4 header — and a file whose header cannot be read leaves the row null,
 * not 0 and not the episode's duration.
 *
 * The Instagram account is connected through the sandbox's Facebook Login,
 * and a due Instagram short goes out the way a scheduled one does: the
 * scheduled-publish cron uploads it to the sandbox (container → publish →
 * permalink). The inline Publish All path for a short waits on the
 * metadata-translation batch first, which has nothing to do with this.
 */
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:55321';

async function dueInstagramShort(
  page: Page,
  prefix: string,
  file: Uint8Array<ArrayBuffer>,
) {
  const team = await seedTeamAccount({ emailPrefix: prefix });
  await signInAs(page, team);
  await connectThroughSandbox(page, team.slug, 'facebook');
  const [instagram] = await storedConnections(team.accountId, 'instagram');

  const project = await seedProject(team);
  const { episodeId } = await seedEpisodeWithShot(project.id);

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
      body: file,
    },
  );
  expect(upload.status, await upload.text()).toBeLessThan(300);
  await updateRows('episodes', `id=eq.${episodeId}`, {
    shorts_groups: [
      { id: 'short-1', videos: { en: episodeVideoUrl(episodeId) } },
    ],
    // The episode's own length, far from the clip's: it must not leak in.
    duration_seconds: 1320,
  });

  const inserted = await insertRow<Array<{ id: string }>>(
    'publishes',
    {
      episode_id: episodeId,
      platform_connection_id: instagram!.id,
      platform: 'instagram',
      content_type: 'short',
      title: 'The Letter Under the Floorboards',
      description: 'Episode 1',
      status: 'scheduled',
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
      language: 'en',
      metadata: { shortsGroupId: 'short-1' },
    },
    auth,
  );

  return (Array.isArray(inserted) ? inserted[0] : inserted)!.id;
}

async function publishDue(publishId: string) {
  const response = await fetch(
    `${process.env.PLAYWRIGHT_BASE_URL}/api/cron/publish-scheduled`,
    { headers: cronHeaders() },
  );
  expect(response.status, await response.text()).toBe(200);

  const [row] = await readRows<{
    status: string;
    platform_content_id: string | null;
    duration_seconds: number | null;
    metadata: { error?: string } | null;
  }>(
    'publishes',
    `id=eq.${publishId}&select=status,platform_content_id,duration_seconds,metadata`,
  );

  return row!;
}

test.describe('An Instagram publish records its file’s length (FILM-1710)', () => {
  sandboxRun();
  test.describe.configure({ timeout: 300_000 });

  test('a 45-second file published to Instagram reads 45 seconds, not its episode’s 1,320', async ({
    page,
  }) => {
    const publishId = await dueInstagramShort(
      page,
      'sbx-ig-duration',
      headerOnlyMp4({ seconds: 45, width: 1080, height: 1920 }),
    );

    const row = await publishDue(publishId);

    expect(row.metadata?.error).toBeUndefined();
    expect(row.status).toBe('published');
    expect(row.platform_content_id).toBeTruthy();
    expect(row.duration_seconds).toBe(45);
  });

  test('a file whose header cannot be read publishes, and its duration stays unknown', async ({
    page,
  }) => {
    const publishId = await dueInstagramShort(
      page,
      'sbx-ig-duration-unknown',
      new Uint8Array(4096).fill(7),
    );

    const row = await publishDue(publishId);

    expect(row.status).toBe('published');
    expect(row.duration_seconds).toBeNull();
  });
});
