import { Page, expect } from '@playwright/test';

import { readRows } from './seed';
import { byTest, visible } from './visible';

/**
 * The vendor sandbox's control surface (FILM-1802) and the Platforms page,
 * for specs that connect a platform through the sandbox's consent screen.
 *
 * Needs `./scripts/local-env.sh up` and an app started with local.env loaded
 * (`docs/ENGINEERING-WORKFLOW.md`, "Sandbox-backed E2E"); the spec files that
 * use this skip unless `SANDBOX_CONNECT=1`.
 */
export const SANDBOX_CONNECT = process.env.SANDBOX_CONNECT === '1';

const CONTROL = process.env.SANDBOX_CONTROL_URL ?? 'http://127.0.0.1:4100';

export interface LedgerEntry {
  id: number;
  vendor: string;
  method: string;
  path: string;
  status: number;
  requestSummary?: string;
}

export async function ledger(vendor: string, since = 0) {
  const response = await fetch(
    `${CONTROL}/__sandbox/ledger?vendor=${vendor}&since=${since}`,
  );

  return ((await response.json()) as { entries: LedgerEntry[] }).entries;
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
