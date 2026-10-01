import { Page, expect, test } from '@playwright/test';

import { seedTeamAccount, seedYouTubeConnection } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-1711. The Platform Connections page says which analytics a connection
 * cannot reach and who can change that — and offers a reconnect only when
 * reconnecting would change it.
 *
 * Connections are seeded with the grant an OAuth callback would have
 * recorded, because the states are decided from that record and the OAuth
 * round trip itself is three vendors' consent screens.
 */
const G = 'https://www.googleapis.com/auth/';

const YOUTUBE_BEFORE_FILM_1711 = [
  `${G}youtube.upload`,
  `${G}youtube.readonly`,
  `${G}youtube.force-ssl`,
  `${G}yt-analytics.readonly`,
];

const YOUTUBE_FULL = [
  ...YOUTUBE_BEFORE_FILM_1711,
  `${G}yt-analytics-monetary.readonly`,
];

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

async function seedConnections() {
  const team = await seedTeamAccount({ emailPrefix: 'film1711' });

  const ids = {
    legacy: await seedYouTubeConnection(team.accountId, 'Made before revenue', {
      scopes: YOUTUBE_BEFORE_FILM_1711,
    }),
    full: await seedYouTubeConnection(team.accountId, 'Fully authorised', {
      scopes: YOUTUBE_FULL,
    }),
    gated: await seedYouTubeConnection(team.accountId, 'Not in the YPP', {
      scopes: YOUTUBE_FULL,
      metadata: { analytics_account_gated: ['youtube.revenue'] },
    }),
    tiktok: await seedYouTubeConnection(team.accountId, 'tiktok.creator', {
      platform: 'tiktok',
      scopes: ['user.info.basic', 'video.upload'],
    }),
    unrecorded: await seedYouTubeConnection(team.accountId, 'ig.creator', {
      platform: 'instagram',
    }),
  };

  return { team, ids };
}

function notice(page: Page, connectionId: string) {
  return page.locator(
    `[data-test="analytics-access-notice"][data-connection-id="${connectionId}"]`,
  );
}

function entry(page: Page, connectionId: string, requirement: string) {
  return notice(page, connectionId).locator(
    `[data-test="analytics-access-entry"][data-requirement="${requirement}"]`,
  );
}

async function openPlatforms(page: Page) {
  const { team, ids } = await seedConnections();

  await signInAs(page, team);
  await page.goto(`/home/${team.slug}/settings/platforms`);
  await expect(notice(page, ids.legacy)).toBeVisible();

  return { team, ids };
}

test.describe('Analytics authorisation on Platform Connections', () => {
  test('a connection made before the revenue scope is asked to reconnect, and told what for', async ({
    page,
  }) => {
    const { ids } = await openPlatforms(page);

    await expect(notice(page, ids.legacy)).toHaveAttribute(
      'data-access',
      'not_authorised',
    );
    await expect(entry(page, ids.legacy, 'youtube.revenue')).toHaveAttribute(
      'data-state',
      'scope_missing',
    );
    await expect(entry(page, ids.legacy, 'youtube.revenue')).toContainText(
      'Estimated revenue, split into ads and YouTube Premium',
    );

    // Only what is missing is listed: views and retention already work.
    await expect(
      byTest(notice(page, ids.legacy), 'analytics-access-entry'),
    ).toHaveCount(1);
  });

  test('each platform’s prompt names what that platform’s analytics add', async ({
    page,
  }) => {
    const { ids } = await openPlatforms(page);

    await expect(entry(page, ids.tiktok, 'tiktok.video-metrics')).toContainText(
      'Views, likes, comments and shares for each TikTok video',
    );
    await expect(
      entry(page, ids.tiktok, 'tiktok.follower-count'),
    ).toContainText('Your TikTok follower count over time');
    await expect(
      entry(page, ids.unrecorded, 'instagram.insights'),
    ).toContainText(
      'Views, reach, saves and shares for each Reel, and your audience',
    );

    // Another platform's gain never appears under this one.
    await expect(notice(page, ids.legacy)).not.toContainText('TikTok');
    await expect(notice(page, ids.tiktok)).not.toContainText('revenue');
  });

  test('a fully authorised connection says nothing', async ({ page }) => {
    const { ids } = await openPlatforms(page);

    await expect(notice(page, ids.full)).toHaveCount(0);
  });

  test('a channel outside the Partner Program is not told to reconnect', async ({
    page,
  }) => {
    const { ids } = await openPlatforms(page);

    await expect(entry(page, ids.gated, 'youtube.revenue')).toHaveAttribute(
      'data-state',
      'account_type_gated',
    );
    await expect(entry(page, ids.gated, 'youtube.revenue')).toContainText(
      'Partner Program',
    );
    await expect(
      byTest(notice(page, ids.gated), 'analytics-reconnect'),
    ).toHaveCount(0);
  });

  test('a scope the vendor has not approved yet offers no reconnect', async ({
    page,
  }) => {
    const { ids } = await openPlatforms(page);

    await expect(
      entry(page, ids.tiktok, 'tiktok.video-metrics'),
    ).toHaveAttribute('data-state', 'review_pending');
    await expect(entry(page, ids.tiktok, 'tiktok.video-metrics')).toContainText(
      'reconnecting will not change it',
    );
    await expect(
      byTest(notice(page, ids.tiktok), 'analytics-reconnect'),
    ).toHaveCount(0);
  });

  test('a connection with no recorded grant is unknown, not unauthorised', async ({
    page,
  }) => {
    const { ids } = await openPlatforms(page);

    await expect(notice(page, ids.unrecorded)).toHaveAttribute(
      'data-access',
      'unknown',
    );

    // Reconnecting records the grant. It does not promise access: Instagram
    // insights still wait on Meta, and the label must not say otherwise.
    await expect(
      byTest(notice(page, ids.unrecorded), 'analytics-reconnect'),
    ).toHaveText('Reconnect Instagram');
    await expect(
      byTest(notice(page, ids.legacy), 'analytics-reconnect'),
    ).toHaveText('Reconnect YouTube to grant access');
  });

  test('reconnect starts that platform’s OAuth flow for this account', async ({
    page,
  }) => {
    const { team, ids } = await openPlatforms(page);

    const connect = page.waitForRequest((request) =>
      request.url().includes('/api/platforms/connect/youtube'),
    );

    await notice(page, ids.legacy)
      .locator('[data-test="analytics-reconnect"]')
      .click();

    expect(new URL((await connect).url()).searchParams.get('account')).toBe(
      team.slug,
    );
  });
});

test.describe('Analytics authorisation — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test('captures each access state as a creator sees it', async ({ page }) => {
    const { ids } = await openPlatforms(page);

    await notice(page, ids.legacy).screenshot({
      path: `${OUT}/01-youtube-scope-missing.png`,
    });
    await notice(page, ids.gated).screenshot({
      path: `${OUT}/02-youtube-account-type-gated.png`,
    });
    await notice(page, ids.tiktok).screenshot({
      path: `${OUT}/03-tiktok-review-pending.png`,
    });
    await notice(page, ids.unrecorded).screenshot({
      path: `${OUT}/04-instagram-unknown-grant.png`,
    });
    await page.screenshot({
      path: `${OUT}/05-platform-connections-page.png`,
      fullPage: true,
    });

    const measured = await page
      .locator('[data-test="analytics-access-entry"]')
      .evaluateAll((entries) =>
        entries.map((node) => ({
          requirement: node.getAttribute('data-requirement'),
          state: node.getAttribute('data-state'),
          text: node.textContent?.trim(),
        })),
      );

    console.log(JSON.stringify(measured, null, 2));
  });
});
