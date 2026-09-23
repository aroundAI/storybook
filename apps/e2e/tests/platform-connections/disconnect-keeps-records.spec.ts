import { Page, expect, test } from '@playwright/test';
import { randomUUID, webcrypto } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { type Server, createServer } from 'node:http';

import { daysAgo } from '../revenue/revenue-currency.po';
import {
  SeededTeam,
  deleteRows,
  insertRow,
  readRows,
  seedProject,
  seedPublishedEpisode,
  seedRevenueRecord,
  seedTeamAccount,
  seedYouTubeConnection,
  serviceRoleAuth,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * KB-22. Pressing Disconnect used to delete the connection row, and the
 * schema cascaded that into the channel's publishes and every revenue entry
 * on them — including ones a person typed in — behind a dialog that said
 * only "this will remove access".
 *
 * Seeded, per test: a YouTube channel with one published video carrying a
 * **$50.00 sponsorship typed in by hand** and $12.34 of synced ads, plus one
 * post scheduled on the channel. Measured on `main` before the fix: the
 * revenue total read "$62" before the disconnect and "$0" after it, and the
 * connection, the publish and the manual row were all gone.
 *
 * The reconnect test drives the real `/api/platforms/callback/youtube`, with
 * a local listener standing in for Google's token and Data APIs (FILM-1801's
 * `VENDOR_URL_*`). It needs a server started for it, so it runs only when
 * `KB22_OAUTH_SANDBOX_PORT` is set — see the note on that test.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const SANDBOX_PORT = process.env.KB22_OAUTH_SANDBOX_PORT;

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  // The dialog fades in; a capture mid-animation is half transparent.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== 'running'),
  );
  await page.screenshot({ path: `${OUT}/kb-22-${name}.png` });
}

interface Fixture {
  team: SeededTeam;
  connectionId: string;
  channelId: string;
  publishId: string;
}

async function seedChannelWithHistory(page: Page): Promise<Fixture> {
  const team = await seedTeamAccount({ emailPrefix: 'kb22' });
  const project = await seedProject(team);
  const channelId = `UC-kb22-${randomUUID()}`;

  const connectionId = await seedYouTubeConnection(team.accountId, 'Acme TV', {
    platformAccountId: channelId,
    // Not a real ciphertext: the revoke step reports it undecryptable and
    // calls nobody, which keeps this test off every network but the app's.
    accessTokenEncrypted: 'kb22-not-a-real-token',
  });

  const { publishId, episodeId } = await seedPublishedEpisode(
    project.id,
    connectionId,
    { title: 'Sponsored video' },
  );

  await seedRevenueRecord({
    publishId,
    revenueCents: 5_000,
    recordDate: daysAgo(4),
    category: 'sponsorship',
    source: 'manual',
  });
  await seedRevenueRecord({
    publishId,
    revenueCents: 1_234,
    recordDate: daysAgo(5),
    category: 'ads',
  });

  await insertRow(
    'publishes',
    {
      episode_id: episodeId,
      platform_connection_id: connectionId,
      platform: 'youtube',
      status: 'scheduled',
      scheduled_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    },
    serviceRoleAuth(),
  );

  await signInAs(page, team);

  return { team, connectionId, channelId, publishId };
}

function row(page: Page, connectionId: string) {
  return page.locator(
    `[data-test="connection-row"][data-connection-id="${connectionId}"]`,
  );
}

async function openPlatforms(page: Page, team: SeededTeam) {
  await page.goto(`/home/${team.slug}/settings/platforms`);
}

/** The revenue total tile, read off the analytics page. */
async function revenueTotal(page: Page, team: SeededTeam) {
  await page.goto(`/home/${team.slug}/studio/analytics`);

  const value = page
    .locator(
      '[data-test="revenue-tile-total"] [data-test="revenue-tile-value"]',
    )
    .first();

  await expect(value).toBeVisible();

  return (await value.innerText()).trim();
}

async function disconnect(page: Page, connectionId: string) {
  await row(page, connectionId)
    .locator('[data-test="disconnect-connection"]')
    .click();

  const dialog = page.locator('[data-test="disconnect-dialog"]');

  await expect(dialog).toBeVisible();

  return dialog;
}

interface ConnectionRecord {
  id: string;
  is_active: boolean;
  disconnected_at: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
}

async function connectionRecord(connectionId: string) {
  const [record] = await readRows<ConnectionRecord>(
    'platform_connections',
    `id=eq.${connectionId}&select=id,is_active,disconnected_at,access_token_encrypted,refresh_token_encrypted`,
  );

  return record;
}

test.describe('Disconnecting a platform keeps the creator’s records (KB-22)', () => {
  test('the dialog says what happens, and the manual revenue is still there afterwards', async ({
    page,
  }) => {
    const fixture = await seedChannelWithHistory(page);

    const before = await revenueTotal(page, fixture.team);
    // $50.00 typed in + $12.34 synced; the tile rounds to whole units.
    expect(before).toBe('$62');

    await openPlatforms(page, fixture.team);
    await expect(row(page, fixture.connectionId)).toHaveAttribute(
      'data-status',
      /active|expired/,
    );

    const dialog = await disconnect(page, fixture.connectionId);

    await expect(dialog).toContainText('Disconnect Acme TV?');
    await expect(
      dialog.locator('[data-test="disconnect-access"]'),
    ).toContainText("We'll also ask YouTube to revoke our access.");
    await expect(dialog.locator('[data-test="disconnect-kept"]')).toContainText(
      'revenue you entered',
    );
    await expect(
      dialog.locator('[data-test="disconnect-vendor-data"]'),
    ).toContainText('We delete them within 7 days');
    await expect(
      dialog.locator('[data-test="disconnect-scheduled"]'),
    ).toContainText("1 scheduled post on this channel won't go out");
    await capture(page, '01-dialog-youtube');

    await dialog.locator('[data-test="confirm-disconnect"]').click();

    await expect(dialog).toBeHidden();
    await expect(row(page, fixture.connectionId)).toHaveAttribute(
      'data-status',
      'disconnected',
    );
    await expect(
      row(page, fixture.connectionId).locator(
        '[data-test="disconnected-since"]',
      ),
    ).toContainText('Your records from this channel are kept');
    await expect(
      row(page, fixture.connectionId).locator(
        '[data-test="reconnect-connection"]',
      ),
    ).toBeVisible();
    await capture(page, '02-row-disconnected');

    const record = await connectionRecord(fixture.connectionId);

    expect(record).toMatchObject({
      is_active: false,
      access_token_encrypted: null,
      refresh_token_encrypted: null,
    });
    expect(record?.disconnected_at).not.toBeNull();

    const publishes = await readRows<{ id: string }>(
      'publishes',
      `platform_connection_id=eq.${fixture.connectionId}&select=id`,
    );
    const manual = await readRows<{ revenue_cents: number }>(
      'revenue_records',
      `publish_id=eq.${fixture.publishId}&source=eq.manual&select=revenue_cents`,
    );

    expect(publishes).toHaveLength(2);
    expect(manual).toEqual([{ revenue_cents: 5_000 }]);

    expect(await revenueTotal(page, fixture.team)).toBe(before);
    await capture(page, '03-revenue-after-disconnect');
  });

  test('a platform whose statistics are kept says so, and links to how to ask', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb22-tiktok' });
    const connectionId = await seedYouTubeConnection(
      team.accountId,
      'acme.tok',
      {
        platform: 'tiktok',
      },
    );

    await signInAs(page, team);
    await openPlatforms(page, team);

    const dialog = await disconnect(page, connectionId);

    await expect(
      dialog.locator('[data-test="disconnect-vendor-data"]'),
    ).toContainText(
      'Statistics already collected from TikTok are kept until you ask us to delete them.',
    );
    await expect(
      dialog.locator('a[href="/data-deletion#request"]'),
    ).toBeVisible();
    await expect(
      dialog.locator('[data-test="disconnect-scheduled"]'),
    ).toHaveCount(0);
    await capture(page, '04-dialog-tiktok');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(row(page, connectionId)).not.toHaveAttribute(
      'data-status',
      'disconnected',
    );
  });

  test('an Instagram account and the Facebook Page it is reached through go together, and the dialog says so', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb22-meta' });
    const pageId = `page-${randomUUID()}`;

    const facebookId = await seedYouTubeConnection(
      team.accountId,
      'Acme Page',
      {
        platform: 'facebook',
        platformAccountId: pageId,
      },
    );
    const instagramId = await seedYouTubeConnection(team.accountId, 'acme.ig', {
      platform: 'instagram',
      platformAccountId: `ig-${randomUUID()}`,
      metadata: { linked_page_id: pageId },
    });

    await signInAs(page, team);
    await openPlatforms(page, team);

    const dialog = await disconnect(page, instagramId);

    await expect(
      dialog.locator('[data-test="disconnect-linked"]'),
    ).toContainText(
      'Acme Page is connected through the same Facebook login and is disconnected with it.',
    );
    await capture(page, '05-dialog-instagram-linked');

    await dialog.locator('[data-test="confirm-disconnect"]').click();

    await expect(row(page, instagramId)).toHaveAttribute(
      'data-status',
      'disconnected',
    );
    await expect(row(page, facebookId)).toHaveAttribute(
      'data-status',
      'disconnected',
    );
  });

  /**
   * Needs a server that sends Google's token and Data API calls to the local
   * listener this test starts, and that can encrypt tokens:
   *
   *   KB22_OAUTH_SANDBOX_PORT=4122 ENCRYPTION_KEY=$(openssl rand -base64 32)
   *   VENDOR_SANDBOX=1 VENDOR_URL_GOOGLE_TOKEN=http://127.0.0.1:4122
   *   VENDOR_URL_YOUTUBE_DATA=http://127.0.0.1:4122
   *   NEXT_PUBLIC_SITE_URL=<the server's own origin>
   *
   * in both the server's environment and this run's. CI's E2E job has none of
   * these, so it runs the three tests above and skips this one.
   */
  test('reconnecting the same channel re-attaches it, with its history — and it can be disconnected again', async ({
    page,
  }) => {
    test.skip(
      !SANDBOX_PORT || !process.env.ENCRYPTION_KEY,
      'Needs the local OAuth sandbox (KB22_OAUTH_SANDBOX_PORT, ENCRYPTION_KEY)',
    );

    const fixture = await seedChannelWithHistory(page);
    const google = await startGoogleStandIn(Number(SANDBOX_PORT), {
      channelId: fixture.channelId,
      title: 'Acme TV',
    });

    try {
      const before = await revenueTotal(page, fixture.team);

      await openPlatforms(page, fixture.team);
      await (await disconnect(page, fixture.connectionId))
        .locator('[data-test="confirm-disconnect"]')
        .click();
      await expect(row(page, fixture.connectionId)).toHaveAttribute(
        'data-status',
        'disconnected',
      );

      await withYouTubeAppCredentials(async () => {
        const state = await startOAuthAttempt(fixture.team);

        await page.goto(
          `/api/platforms/callback/youtube?${new URLSearchParams({
            code: 'kb22-code',
            state,
          })}`,
        );
      });

      await expect(page).toHaveURL(
        /settings\/platforms\?success=youtube_connected/,
      );
      await expect(row(page, fixture.connectionId)).toHaveAttribute(
        'data-status',
        'active',
      );
      await capture(page, '06-row-reconnected');

      const reconnected = await connectionRecord(fixture.connectionId);

      expect(reconnected).toMatchObject({
        id: fixture.connectionId,
        is_active: true,
        disconnected_at: null,
      });
      expect(reconnected?.access_token_encrypted).not.toBeNull();

      // The same channel came back as the same row: no second row for it.
      const rows = await readRows<{ id: string }>(
        'platform_connections',
        `account_id=eq.${fixture.team.accountId}&platform_account_id=eq.${fixture.channelId}&select=id`,
      );
      expect(rows).toEqual([{ id: fixture.connectionId }]);

      expect(await revenueTotal(page, fixture.team)).toBe(before);
      await capture(page, '07-revenue-after-reconnect');

      // The second submission: disconnect the reconnected row. Its token is
      // real ciphertext now, so the revoke reaches the stand-in for Google.
      await openPlatforms(page, fixture.team);
      await (await disconnect(page, fixture.connectionId))
        .locator('[data-test="confirm-disconnect"]')
        .click();
      await expect(row(page, fixture.connectionId)).toHaveAttribute(
        'data-status',
        'disconnected',
      );
      expect(google.requests).toContain('POST /revoke');

      expect(await revenueTotal(page, fixture.team)).toBe(before);
    } finally {
      await google.close();
    }
  });
});

/** Google's token endpoint, channels.list and revoke, answering for one channel. */
async function startGoogleStandIn(
  port: number,
  channel: { channelId: string; title: string },
) {
  const requests: string[] = [];

  const server: Server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://stand-in').pathname;

    requests.push(`${request.method} ${path}`);
    request.resume();
    request.on('end', () => {
      response.setHeader('content-type', 'application/json');

      if (path === '/token') {
        response.end(
          JSON.stringify({
            access_token: `kb22-access-${randomUUID()}`,
            refresh_token: `kb22-refresh-${randomUUID()}`,
            expires_in: 3600,
            token_type: 'Bearer',
            scope:
              'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly',
          }),
        );
        return;
      }

      if (path === '/youtube/v3/channels') {
        response.end(
          JSON.stringify({
            items: [
              {
                id: channel.channelId,
                snippet: { title: channel.title, thumbnails: {} },
                statistics: {},
              },
            ],
          }),
        );
        return;
      }

      if (path === '/revoke') {
        response.end('{}');
        return;
      }

      response.statusCode = 404;
      response.end('{}');
    });
  });

  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));

  return {
    requests,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/** The `state` a connect route would have issued, with its stored nonce. */
async function startOAuthAttempt(team: SeededTeam) {
  const nonce = randomUUID();

  await insertRow(
    'oauth_states',
    {
      nonce,
      user_id: team.userId,
      platform: 'youtube',
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    },
    serviceRoleAuth(),
  );

  return Buffer.from(
    JSON.stringify({
      accountId: team.accountId,
      returnUrl: `/home/${team.slug}/settings/platforms`,
      nonce,
    }),
  ).toString('base64url');
}

/**
 * Fake YouTube app credentials for the length of `run`. The table is global
 * (one row per platform), and KB-19's spec expects YouTube to read as not
 * configured, so the row is removed again however `run` ends.
 */
async function withYouTubeAppCredentials(run: () => Promise<void>) {
  await deleteRows('oauth_app_credentials', 'platform=eq.youtube');
  await insertRow(
    'oauth_app_credentials',
    {
      platform: 'youtube',
      client_id: 'kb22-client-id',
      client_secret_encrypted: await encryptLikeTheApp('kb22-client-secret'),
    },
    serviceRoleAuth(),
  );

  try {
    await run();
  } finally {
    await deleteRows('oauth_app_credentials', 'platform=eq.youtube');
  }
}

/** `@kit/shared/crypto`'s format: base64(IV ‖ AES-256-GCM ciphertext+tag). */
async function encryptLikeTheApp(plaintext: string) {
  const key = await webcrypto.subtle.importKey(
    'raw',
    Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64'),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    new TextEncoder().encode(plaintext),
  );

  return Buffer.concat([iv, new Uint8Array(ciphertext)]).toString('base64');
}
