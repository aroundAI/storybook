import { type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import { headerOnlyMp4 } from '../utils/mp4';
import {
  lastLedgerId,
  ledger,
  openPlatforms,
  platformCard,
  sandboxRun,
  storedConnections,
} from '../utils/sandbox';
import {
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  serviceRoleAuth,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-1729, the whole flow, against FILM-1802's X sandbox in a production
 * build. The episode publish screen sends X its video (owner, 2026-10-01).
 * A connection that did not grant media.write is refused before anything is
 * written, and the reason is on screen, returned as a value (thrown action
 * text is redacted in production, KB-6). Reconnecting with the scope lets the
 * second publish through, and the sandbox receives the upload and the post.
 *
 * Needs the sandbox and an app started with local.env's vendor block, as the
 * other sandbox-connect specs do; skipped unless SANDBOX_E2E=1.
 */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:55321';
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const REFUSAL =
  'was connected before X allowed us to upload video (the media.write permission). In Settings → Platforms, disconnect X and connect it again, then publish.';

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== 'running'),
  );
  await page.screenshot({ path: `${OUT}/film-1729-x-${name}.png` });
}

/** The episode's own upload, in its videos folder (KB-123): a real MP4 header. */
async function uploadEpisodeVideo(episodeId: string) {
  const auth = serviceRoleAuth();
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
      body: headerOnlyMp4({ seconds: 45, width: 1280, height: 720 }),
    },
  );

  expect(upload.status, await upload.text()).toBeLessThan(300);

  return `${SUPABASE_URL}/storage/v1/object/public/project-assets/${key}`;
}

async function connectX(page: Page, slug: string, withMediaWrite: boolean) {
  await openPlatforms(page, slug);
  await byTest(
    platformCard(page, 'twitter'),
    'connect-platform-twitter',
  ).click();
  await expect(byTest(page, 'sandbox-consent-allow')).toBeVisible();

  const mediaWrite = page.getByRole('checkbox', { name: 'media.write' });

  if (withMediaWrite) await mediaWrite.check();
  else await mediaWrite.uncheck();

  await capture(
    page,
    withMediaWrite ? '3-consent-granting' : '1-consent-without',
  );
  await byTest(page, 'sandbox-consent-allow').click();
  await page.waitForURL(new RegExp(`/home/${slug}/settings/platforms`));
}

/** Publish All → confirm, and the X row once it has an outcome. */
async function publishToX(page: Page, publishUrl: string) {
  await page.goto(publishUrl);
  // Rendered once connections load: a click before then finds no channels.
  await expect(
    page.getByRole('button', { name: 'Manage Channels' }),
  ).toBeVisible();
  await byTest(page, 'publish-all').click();
  await byTest(page, 'confirm-publish').click();

  const row = page.locator(
    '[data-test="publish-platform-status"][data-platform="twitter"]',
  );

  await expect(row).toHaveAttribute('data-status', /^(error|success)$/, {
    timeout: 120_000,
  });

  return row;
}

test.describe('Publishing to X without media.write, then with it (FILM-1729)', () => {
  sandboxRun();

  test('refused with the reason on screen → reconnect → published', async ({
    page,
  }) => {
    test.setTimeout(300_000);

    const team = await seedTeamAccount({ emailPrefix: 'f1729-x' });
    const project = await seedProject(team);
    const { episodeId, slug } = await seedEpisodeWithShot(project.id);

    await updateRows('episodes', `id=eq.${episodeId}`, {
      localized_videos: { en: await uploadEpisodeVideo(episodeId) },
      // X refuses a post that repeats an earlier one word for word, and the
      // sandbox keeps its X account between runs: the post text is the title.
      title: `The lighthouse keeper's last night (${episodeId.slice(0, 8)})`,
    });

    await signInAs(page, team);
    const publishUrl = `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/publish`;

    // --- Connected without media.write: the grant is recorded as given.
    await connectX(page, team.slug, false);
    const [narrow] = await storedConnections(team.accountId, 'twitter');
    expect(narrow!.scopes).not.toContain('media.write');

    // --- Refused before anything is written or sent, and it says why.
    const before = await lastLedgerId();
    const refused = await publishToX(page, publishUrl);

    await expect(refused).toHaveAttribute('data-status', 'error');
    await expect(byTest(refused, 'publish-platform-error')).toHaveText(
      `@${narrow!.platform_account_name} ${REFUSAL}`,
    );
    await capture(page, '2-refused');
    expect(
      (await ledger('x', before)).filter((e) => e.path.startsWith('/2/media')),
    ).toEqual([]);

    // --- Reconnect, granting it: the same row now holds the scope.
    await connectX(page, team.slug, true);
    const [granted, ...others] = await storedConnections(
      team.accountId,
      'twitter',
    );
    expect(others).toEqual([]);
    expect(granted!.id).toBe(narrow!.id);
    expect(granted!.scopes).toContain('media.write');

    // --- Second publish, from the state the first left: accepted.
    const since = await lastLedgerId();
    const published = await publishToX(page, publishUrl);

    await expect(published).toHaveAttribute('data-status', 'success');
    await expect(byTest(published, 'publish-platform-error')).toHaveCount(0);
    await capture(page, '4-published');

    const calls = (await ledger('x', since)).map(
      (e) => `${e.method} ${e.path} ${e.status}`,
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        'POST /2/media/upload/initialize 200',
        'POST /2/tweets 201',
      ]),
    );
  });
});
