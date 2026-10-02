import { Page, expect, test } from '@playwright/test';

import { assertSandboxFresh } from './sandbox-freshness';
import { readRows } from './seed';
import { byTest, visible } from './visible';

/**
 * The vendor sandbox's control surface (FILM-1802 §6) and the Platforms
 * page, for the sandbox-backed flows (FILM-1804).
 *
 * Needs `./scripts/local-env.sh up` and an app started with local.env loaded
 * (`docs/ENGINEERING-WORKFLOW.md`, "Sandbox-backed E2E"); every spec that
 * uses this calls `sandboxRun()`, which skips it unless `SANDBOX_E2E=1`.
 *
 * The sandbox's data is random per run, so no spec here writes a figure in
 * advance: it reads what the sandbox served (`servedTotals`, `ledgerFor`)
 * and compares the page with that. There is deliberately no helper that
 * reads an object's *current* figures — they grow while a test runs, and
 * only what was served for the request the app made is comparable.
 */
export const SANDBOX_E2E = process.env.SANDBOX_E2E === '1';

const CONTROL = process.env.SANDBOX_CONTROL_URL ?? 'http://127.0.0.1:4100';

export interface LedgerEntry {
  id: number;
  vendor: string;
  method: string;
  path: string;
  status: number;
  /** The query string, credentials redacted. */
  query?: string;
  requestSummary?: string;
  responseSummary?: string;
  injectedFailure?: boolean;
  /** The social object (video, post) the call was about. */
  object?: string;
}

export async function ledger(vendor: string, since = 0) {
  const response = await fetch(
    `${CONTROL}/__sandbox/ledger?vendor=${vendor}&since=${since}`,
  );

  return ((await response.json()) as { entries: LedgerEntry[] }).entries;
}

/** Every call the app made about one object, newest first. */
export async function ledgerFor(objectId: string, since = 0) {
  const response = await fetch(
    `${CONTROL}/__sandbox/ledger?object=${encodeURIComponent(objectId)}&since=${since}`,
  );

  return ((await response.json()) as { entries: LedgerEntry[] }).entries;
}

/** The run's seed: what `SANDBOX_SEED=<n>` replays. */
export async function sandboxSeed() {
  const response = await fetch(`${CONTROL}/__sandbox/state`);

  return ((await response.json()) as { seed: number }).seed;
}

/**
 * Empties the sandbox and starts a run under `seed`, or a fresh random one.
 * Accounts, tokens and objects are drawn from streams keyed by the seed and
 * a per-kind counter, both of which this resets, so the same seed followed
 * by the same steps draws the same channel, the same video ids and the same
 * performance profiles.
 */
export async function reset(seed?: number) {
  const response = await fetch(`${CONTROL}/__sandbox/reset`, {
    method: 'POST',
    body: JSON.stringify(seed === undefined ? {} : { seed }),
  });
  expect(response.status).toBe(200);

  return ((await response.json()) as { seed: number }).seed;
}

/**
 * The setup every sandbox-backed spec file shares, called inside its
 * `test.describe`:
 *
 * - skips unless `SANDBOX_E2E=1`;
 * - refuses a sandbox started from other source than this checkout's
 *   (`sandbox-freshness.ts`), which would serve stale vendor responses;
 * - runs the file's tests in order (one sandbox, one failure queue);
 * - starts the file on a fresh sandbox run, under `SANDBOX_SEED` when that
 *   is set, so a failure can be replayed;
 * - and when a test fails, prints the seed and the command that replays it.
 */
export function sandboxRun() {
  test.skip(
    !SANDBOX_E2E,
    'Set SANDBOX_E2E=1, with the sandbox and a local.env app running (apps/e2e/README.md, "Sandbox-backed flows").',
  );
  test.describe.configure({ mode: 'default' });

  let seed: number | undefined;

  test.beforeAll(async () => {
    await assertSandboxFresh(CONTROL);
    const replay = process.env.SANDBOX_SEED;
    seed = await reset(replay ? Number(replay) : undefined);
    runSeed = seed;
    idCount = 0;
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus || seed === undefined)
      return;

    const line = `[sandbox] "${testInfo.title}" failed under seed ${seed}. Replay: SANDBOX_SEED=${seed} SANDBOX_E2E=1 npx playwright test ${testInfo.file.split('/tests/')[1] ?? testInfo.file} -g ${JSON.stringify(testInfo.title)} --retries=0`;
    console.error(line);
    testInfo.annotations.push({ type: 'sandbox-seed', description: line });
  });
}

let runSeed = 0;
let idCount = 0;

/**
 * A vendor-shaped numeric id (TikTok, Instagram) for a video the app already
 * holds, drawn from the run's seed rather than at random: the sandbox keys
 * an adopted video's performance profile by its id, so a replay under the
 * same `SANDBOX_SEED` gets the same ids and the same videos, not just the
 * same accounts.
 */
export function replayableVideoId(prefix: string) {
  let hash = (runSeed ^ Math.imul(++idCount, 0x9e3779b1)) >>> 0;
  let digits = '';
  while (digits.length < 16) {
    hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d) >>> 0;
    digits += String(hash % 10);
  }

  return `${prefix}${digits}`;
}

/**
 * The figures the sandbox served for an object, from the newest successful
 * call that carried them — exactly what the app received, however the
 * object has grown since. Throws when no such call was made, so a sync
 * that never asked cannot be compared with a default.
 */
export async function servedTotals(
  platform: 'tiktok' | 'instagram',
  objectId: string,
  since = 0,
): Promise<Record<string, number>> {
  const entries = (await ledgerFor(objectId, since)).filter(
    (entry) => entry.status === 200 && entry.responseSummary,
  );

  if (platform === 'tiktok') {
    const served = entries.find((entry) => entry.path === '/v2/video/query/');
    const video =
      served &&
      parseServed<{
        data: { videos: Array<Record<string, number>> };
      }>(served).data.videos[0];

    if (!video)
      throw new Error(
        `the sandbox served no TikTok video query for ${objectId}`,
      );

    return {
      views: video.view_count!,
      likes: video.like_count!,
      comments: video.comment_count!,
      shares: video.share_count!,
    };
  }

  const served = entries.find((entry) =>
    entry.path.endsWith(`/${objectId}/insights`),
  );

  if (!served)
    throw new Error(`the sandbox served no media insights for ${objectId}`);

  return Object.fromEntries(
    parseServed<{
      data: Array<{ name: string; values: [{ value: number }] }>;
    }>(served).data.map((metric) => [metric.name, metric.values[0].value]),
  );
}

function parseServed<T>(entry: LedgerEntry): T {
  const text = entry.responseSummary!;

  if (text.endsWith('…'))
    throw new Error(
      `ledger entry ${entry.id} (${entry.path}) was cut at the ledger's summary cap; it cannot be compared`,
    );

  return JSON.parse(text) as T;
}

/** The newest ledger id, so a test can read only what happened after it. */
export async function lastLedgerId() {
  const response = await fetch(`${CONTROL}/__sandbox/ledger`);

  return (
    ((await response.json()) as { entries: LedgerEntry[] }).entries[0]?.id ?? 0
  );
}

/** The next `count` calls to `vendor` whose path includes `pathIncludes` fail. */
export async function failNext(rule: {
  vendor: string;
  status: number;
  pathIncludes: string;
  count?: number;
}) {
  const response = await fetch(`${CONTROL}/__sandbox/fail`, {
    method: 'POST',
    body: JSON.stringify(rule),
  });

  expect(response.status).toBe(200);
}

export function platformCard(page: Page, platform: string) {
  return byTest(page, `platform-card-${platform}`);
}

/** A connection's row, matched on the vendor's account name. */
export function connectionRow(page: Page, platform: string, name: string) {
  return byTest(platformCard(page, platform), 'connection-row').filter({
    hasText: name,
  });
}

export function connectionById(page: Page, id: string) {
  return visible(
    page,
    `[data-test="connection-row"][data-connection-id="${id}"]`,
  );
}

export interface StoredConnection {
  id: string;
  platform: string;
  platform_account_id: string;
  platform_account_name: string;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  scopes: string[] | null;
  is_active: boolean;
  metadata: Record<string, unknown> | null;
}

export function storedConnections(accountId: string, platform: string) {
  return readRows<StoredConnection>(
    'platform_connections',
    `account_id=eq.${accountId}&platform=eq.${platform}&order=created_at&select=id,platform,platform_account_id,platform_account_name,access_token_encrypted,refresh_token_encrypted,scopes,is_active,metadata`,
  );
}

export async function openPlatforms(page: Page, slug: string) {
  await page.goto(`/home/${slug}/settings/platforms`);
  await expect(byTest(page, 'platform-connections')).toBeVisible();
}

/** The sandbox consent screen's scope boxes, in the order the app asked. */
export function consentScopes(page: Page) {
  return byTest(page, 'sandbox-scope');
}

/**
 * Connects a platform the way a person does: the card's Connect button, the
 * sandbox's consent screen, Allow, and back to the Platforms page with no
 * failure shown. `card` is the card's platform id (`facebook` connects the
 * Page and its Instagram account together).
 */
export async function connectThroughSandbox(
  page: Page,
  slug: string,
  card: string,
) {
  await openPlatforms(page, slug);
  await byTest(platformCard(page, card), `connect-platform-${card}`).click();
  await byTest(page, 'sandbox-consent-allow').click();
  await page.waitForURL(new RegExp(`/home/${slug}/settings/platforms`));
  await expect(byTest(page, 'connect-failure')).toHaveCount(0);
}

/** The cron routes production calls, with the local CRON_SECRET. */
export function cronHeaders() {
  const secret = process.env.CRON_SECRET;

  if (!secret)
    throw new Error(
      'CRON_SECRET is not in this run’s environment: load deployment/config/local.env first',
    );

  return { Authorization: `Bearer ${secret}` };
}

/** Each vendor's "who am I" call, which any valid token of the grant can make. */
const WHO_AM_I: Record<string, (token: string) => [string, RequestInit]> = {
  youtube: (token) => [
    'http://127.0.0.1:4103/youtube/v3/channels?part=id&mine=true',
    { headers: { Authorization: `Bearer ${token}` } },
  ],
  tiktok: (token) => [
    'http://127.0.0.1:4102/v2/user/info/?fields=open_id',
    { headers: { Authorization: `Bearer ${token}` } },
  ],
  twitter: (token) => [
    'http://127.0.0.1:4104/2/users/me',
    { headers: { Authorization: `Bearer ${token}` } },
  ],
  linkedin: (token) => [
    'http://127.0.0.1:4105/v2/userinfo',
    { headers: { Authorization: `Bearer ${token}` } },
  ],
  facebook: (token) => [
    `http://127.0.0.1:4101/v18.0/me/permissions?access_token=${encodeURIComponent(token)}`,
    {},
  ],
};

/** The HTTP status the vendor answers a token with: 200 while it is good. */
export async function vendorAccepts(platform: string, token: string) {
  const [url, init] = WHO_AM_I[platform]!(token);

  return (await fetch(url, init)).status;
}
