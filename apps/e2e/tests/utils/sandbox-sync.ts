import { type Page, expect } from '@playwright/test';

import { cronHeaders, replayableVideoId } from './sandbox';
import { insertRow, readRows, serviceRoleAuth, updateRows } from './seed';

/**
 * The app's own analytics sync, driven against the vendor sandbox
 * (FILM-1804, KB-150): a video the app holds, the cron route production
 * calls, and the sync record the run leaves on the publish.
 */

export interface SyncedVideo {
  publishId: string;
  episodeSlug: string;
  videoId: string;
}

/** An episode with one published video on `connectionId`, as the app holds it. */
export async function publishedVideo(
  projectId: string,
  connectionId: string,
  platform: 'tiktok' | 'instagram',
  title: string,
): Promise<SyncedVideo> {
  const auth = serviceRoleAuth();
  const videoId = replayableVideoId(platform === 'tiktok' ? '73' : '179');
  const episodeSlug = `sandbox-sync-${platform}-${crypto.randomUUID()}`;

  const episode = await insertRow<{ id: string }>(
    'episodes',
    { project_id: projectId, number: 1, title, slug: episodeSlug },
    auth,
  );
  const publish = await insertRow<{ id: string }>(
    'publishes',
    {
      episode_id: episode.id,
      platform_connection_id: connectionId,
      platform,
      status: 'published',
      title,
      platform_content_id: videoId,
      // Under a day old, so the first sync dates the lifetime to the
      // publish (`shouldWriteMetricRow`) and the page has a row to show.
      published_at: new Date().toISOString(),
    },
    auth,
  );

  return { publishId: publish.id, episodeSlug, videoId };
}

export async function runSync(page: Page) {
  const response = await page.request.post('/api/analytics/sync', {
    headers: cronHeaders(),
    timeout: 120_000,
  });
  expect(response.status(), await response.text()).toBe(200);

  return (await response.json()) as {
    byPlatform: Record<string, { processed: number; successful: number }>;
  };
}

export interface SyncMeta {
  last_sync_status?: string;
  last_error?: string;
  last_synced_at?: string | null;
  consecutive_failures?: number;
  requires_reauth?: boolean;
  last_failed_at?: string;
}

export async function syncMeta(publishId: string) {
  const [row] = await readRows<{ metadata: { sync?: SyncMeta } | null }>(
    'publishes',
    `id=eq.${publishId}&select=metadata`,
  );

  return row?.metadata?.sync ?? {};
}

/**
 * Makes the publish due again, as time would: the schedule waits after the
 * last successful sync, so its time is moved back past the hourly interval
 * rather than erased — erasing it would also erase the "last refreshed"
 * time the page is meant to show.
 */
export async function makeDue(publishId: string, hoursAgo = 2) {
  const sync = await syncMeta(publishId);
  const due = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

  await updateRows('publishes', `id=eq.${publishId}`, {
    metadata: {
      sync: { ...sync, last_synced_at: sync.last_synced_at ? due : null },
    },
  });

  return sync.last_synced_at ? due : null;
}
