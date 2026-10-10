import { type Page, expect, test } from '@playwright/test';

import {
  type LedgerEntry,
  connectThroughSandbox,
  lastLedgerId,
  ledger,
  sandboxRun,
  storedConnections,
} from '../utils/sandbox';
import {
  addTeamChannelsToProject,
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
 * FILM-1731 (owner, 2026-10-02: "add an option to mark it as AI Labeled").
 * The publish screen's "AI-generated (label it)" option, driven through the
 * sandbox: a short published to YouTube, Instagram and a Facebook Page with
 * the option on reaches YouTube with status.containsSyntheticMedia and
 * Instagram with is_ai_generated, read off the sandbox's ledger, and the
 * publish rows store the declaration. Facebook has no field: the screen says
 * so beside the option, and nothing AI-shaped is sent there. The second
 * publish, with the option turned off again, sends neither field.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const shoot = Boolean(process.env.CAPTURE_EVIDENCE);
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:55321';

/** A team with YouTube and a Facebook Page (with its Instagram), and a short. */
async function readyToPublish(page: Page) {
  const team = await seedTeamAccount({ emailPrefix: 'sbx-ai-label' });
  await signInAs(page, team);
  await connectThroughSandbox(page, team.slug, 'youtube');
  await connectThroughSandbox(page, team.slug, 'facebook');
  const [youtube] = await storedConnections(team.accountId, 'youtube');
  await updateRows('platform_connections', `id=eq.${youtube!.id}`, {
    youtube_made_for_kids: false,
    youtube_category_id: '22',
  });

  const project = await seedProject(team);
  await addTeamChannelsToProject(project.id, team.accountId);
  const { episodeId, slug } = await seedEpisodeWithShot(project.id);

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
    shorts_groups: [
      {
        id: 'short-1',
        name: 'Short 1',
        title: 'The Letter Under the Floorboards',
        description: 'Episode 1',
        tags: [],
        videos: { en: episodeVideoUrl(episodeId) },
      },
    ],
  });

  return {
    episodeId,
    publishUrl: `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/publish`,
  };
}

/** Publish All → Confirm, then the dialog's end: Done when some went out. */
async function publishAll(page: Page) {
  await expect(async () => {
    await byTest(page, 'publish-all').click();
    await expect(byTest(page, 'confirm-publish')).toBeVisible({
      timeout: 5_000,
    });
  }).toPass({ timeout: 60_000 });
  await byTest(page, 'confirm-publish').click();
  const close = byTest(page, 'publish-dialog-close');
  await expect(close).toBeVisible({ timeout: 180_000 });

  return close;
}

/** What the app sent to each vendor since `since`, by the calls that matter. */
async function sentSince(since: number) {
  const meta = await ledger('meta', since);
  const google = await ledger('google', since);
  const container = (entry: LedgerEntry) =>
    entry.method === 'POST' && /\/\d+\/media$/.test(entry.path);

  return {
    instagramContainers: meta.filter(container),
    facebook: meta.filter((entry) => entry.path.includes('video_reels')),
    youtubeInserts: google.filter(
      (entry) =>
        entry.method === 'POST' && entry.path === '/upload/youtube/v3/videos',
    ),
  };
}

async function rowsOf(episodeId: string) {
  return readRows<{ platform: string; status: string; ai_generated: boolean }>(
    'publishes',
    `episode_id=eq.${episodeId}&order=created_at&select=platform,status,ai_generated`,
  );
}

test.describe('The AI label on a publish (FILM-1731)', () => {
  sandboxRun();
  test.describe.configure({ timeout: 480_000 });
  // A dev server compiles each route on its first visit; the connect
  // round trips and the publish page are several of them.
  test.use({ navigationTimeout: 60_000 });

  test('declared AI-generated: YouTube and Instagram get their field, Facebook is named as having none; turned off, neither is sent', async ({
    page,
  }) => {
    const fixture = await readyToPublish(page);
    await page.goto(fixture.publishUrl);

    const option = byTest(page, 'ai-label-option');
    const declaration = byTest(page, 'ai-label-declaration');
    await expect(option).toHaveAttribute('data-state', 'unchecked');
    await expect(byTest(page, 'ai-label-unsupported')).toHaveText(
      "Facebook can't take the AI label: its publishing API has no field for it, so the video goes out there without one.",
    );
    if (shoot)
      await declaration.screenshot({ path: `${OUT}/ai-label-1-off.png` });

    await option.click();
    await expect(option).toHaveAttribute('data-state', 'checked');
    if (shoot) {
      await declaration.screenshot({ path: `${OUT}/ai-label-2-on.png` });
      await byTest(page, 'ai-label-unsupported').screenshot({
        path: `${OUT}/ai-label-3-facebook-note.png`,
      });
    }

    // --- First publish: declared
    const first = await lastLedgerId();
    await expect(await publishAll(page)).toHaveText('Done');
    if (shoot)
      await page.screenshot({ path: `${OUT}/ai-label-4-published.png` });

    const declared = await sentSince(first);
    expect(declared.instagramContainers).toHaveLength(1);
    expect(declared.instagramContainers[0]!.query).toContain(
      'is_ai_generated=true',
    );
    expect(declared.youtubeInserts).toHaveLength(1);
    expect(declared.youtubeInserts[0]!.requestSummary).toContain(
      '"containsSyntheticMedia":true',
    );
    expect(declared.facebook.length).toBeGreaterThan(0);
    for (const entry of declared.facebook) {
      expect(`${entry.query ?? ''} ${entry.requestSummary ?? ''}`).not.toMatch(
        /ai_generated|synthetic|aigc|made_with_ai/i,
      );
    }

    const firstRows = await rowsOf(fixture.episodeId);
    expect(firstRows.map((row) => row.platform).sort()).toEqual([
      'facebook',
      'instagram',
      'youtube',
    ]);
    expect(firstRows.every((row) => row.ai_generated)).toBe(true);
    expect(
      firstRows
        .filter((row) => row.platform !== 'facebook')
        .map((row) => row.status),
    ).toEqual(['published', 'published']);

    // --- The second submission, from the same screen, with the option off
    await byTest(page, 'publish-dialog-close').click();
    await option.click();
    await expect(option).toHaveAttribute('data-state', 'unchecked');

    const second = await lastLedgerId();
    await expect(await publishAll(page)).toHaveText('Done');

    const undeclared = await sentSince(second);
    expect(undeclared.instagramContainers).toHaveLength(1);
    expect(undeclared.instagramContainers[0]!.query).not.toContain(
      'is_ai_generated',
    );
    expect(undeclared.youtubeInserts).toHaveLength(1);
    expect(undeclared.youtubeInserts[0]!.requestSummary).not.toContain(
      'containsSyntheticMedia',
    );

    const secondRows = (await rowsOf(fixture.episodeId)).slice(3);
    expect(secondRows).toHaveLength(3);
    expect(secondRows.some((row) => row.ai_generated)).toBe(false);
  });
});
