import { Page, expect, test } from '@playwright/test';

import {
  SeededTeam,
  insertRow,
  readRows,
  readRowsAs,
  seedMembership,
  seedTeamAccount,
  seedUser,
  serviceRoleAuth,
  updateRows,
  writeRowsAs,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * Team settings → API Keys (KB-84, and the owner's decision of 2026-09-25).
 *
 * Members may not read a key's ciphertext, so the save became an admin-client
 * upsert after an owner check, and the list reads through an access-checked
 * helper. Only account owners add, replace or remove keys; every other role
 * sees which providers are connected, without the last four characters.
 *
 * Hailuo is the provider under test: its validation is a length check, so the
 * dialog's Test button needs no network.
 */

type KeyRow = { provider: string; encrypted_key: string; is_active: boolean };

const HAILUO_A = 'hailuo-e2e-key-AAAA1111';
const HAILUO_B = 'hailuo-e2e-key-BBBB2222';

const EVIDENCE = process.env.CAPTURE_EVIDENCE
  ? (process.env.EVIDENCE_DIR ?? 'evidence')
  : null;

/** A PR screenshot when CAPTURE_EVIDENCE is set; nothing otherwise. */
async function evidence(page: Page, name: string) {
  if (EVIDENCE) {
    await page
      .locator('[data-test="api-keys-settings"]')
      .screenshot({ path: `${EVIDENCE}/${name}.png` });
  }
}

function settings(team: SeededTeam) {
  return `/home/${team.slug}/settings`;
}

function hailuoCard(page: Page) {
  return byTest(page, 'api-key-card-hailuo');
}

async function keyRows(team: SeededTeam) {
  return readRows<KeyRow>(
    'external_api_keys',
    `account_id=eq.${team.accountId}&provider=eq.hailuo&select=provider,encrypted_key,is_active`,
  );
}

async function saveHailuoKey(page: Page, key: string) {
  await byTest(hailuoCard(page), 'api-key-edit').click();
  await byTest(page, 'api-key-input').fill(key);
  await byTest(page, 'api-key-test').click();
  await expect(page.getByText('API key is valid and working!')).toBeVisible();
  await byTest(page, 'api-key-save').click();
}

/**
 * Saving a key encrypts it on the server, which needs ENCRYPTION_KEY there.
 * Like the disconnect specs, these run only when this run sets it — to the
 * same value the server was started with.
 */
const NEEDS_ENCRYPTION_KEY = 'Needs ENCRYPTION_KEY, the same as the server’s';

test.describe('API keys: owners manage them', () => {
  test.skip(!process.env.ENCRYPTION_KEY, NEEDS_ENCRYPTION_KEY);

  test('an owner adds a key, replaces it, and removes it', async ({ page }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb84-owner' });

    await signInAs(page, team);
    await page.goto(settings(team));

    await expect(byTest(hailuoCard(page), 'api-key-status')).toHaveText(
      'Not configured',
    );

    // First submission: a fresh dialog.
    await saveHailuoKey(page, HAILUO_A);
    await expect(page.getByText('API key saved successfully')).toBeVisible();
    await expect(byTest(hailuoCard(page), 'api-key-last-four')).toHaveText(
      '••••••1111',
    );
    await evidence(page, 'kb84-01-owner-after-first-save');

    const [first] = await keyRows(team);
    expect(first?.is_active).toBe(true);
    // Stored encrypted, never as typed.
    expect(first?.encrypted_key).not.toContain('1111');

    // Second submission: replacing a key is the upsert's conflict branch —
    // the path a member-client upsert could not take once members lost
    // SELECT on encrypted_key.
    await saveHailuoKey(page, HAILUO_B);
    await expect(byTest(hailuoCard(page), 'api-key-last-four')).toHaveText(
      '••••••2222',
    );
    await evidence(page, 'kb84-02-owner-after-replace');

    const [second] = await keyRows(team);
    expect(second?.encrypted_key).not.toBe(first?.encrypted_key);
    expect(await keyRows(team)).toHaveLength(1);

    await byTest(hailuoCard(page), 'api-key-edit').click();
    await byTest(page, 'api-key-remove').click();
    await expect(page.getByText('API key removed successfully')).toBeVisible();
    await expect(byTest(hailuoCard(page), 'api-key-status')).toHaveText(
      'Not configured',
    );
    expect(await keyRows(team)).toHaveLength(0);
  });
});

test.describe('API keys: other roles see, and are refused', () => {
  test('a member sees which providers are connected, but no key and no controls', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb84-team' });
    const member = await seedUser('kb84-member');
    await seedMembership(member.userId, team.accountId, 'member');

    await insertRow(
      'external_api_keys',
      {
        account_id: team.accountId,
        provider: 'hailuo',
        encrypted_key: 'seeded-ciphertext',
      },
      serviceRoleAuth(),
    );

    await signInAs(page, member);
    await page.goto(settings(team));

    await expect(byTest(page, 'api-keys-owners-only')).toBeVisible();
    await expect(byTest(hailuoCard(page), 'api-key-status')).toHaveText(
      'Connected',
    );
    await expect(byTest(hailuoCard(page), 'api-key-last-four')).toHaveCount(0);
    await expect(byTest(page, 'api-key-edit')).toHaveCount(0);
    await evidence(page, 'kb84-03-member-view');
  });

  test('an owner demoted while the dialog is open is refused by the server', async ({
    page,
  }) => {
    test.skip(!process.env.ENCRYPTION_KEY, NEEDS_ENCRYPTION_KEY);

    const team = await seedTeamAccount({ emailPrefix: 'kb84-team' });
    const coOwner = await seedUser('kb84-coowner');
    await seedMembership(coOwner.userId, team.accountId, 'owner');

    await signInAs(page, coOwner);
    await page.goto(settings(team));

    await byTest(hailuoCard(page), 'api-key-edit').click();
    await byTest(page, 'api-key-input').fill(HAILUO_A);
    await byTest(page, 'api-key-test').click();
    await expect(page.getByText('API key is valid and working!')).toBeVisible();

    // The page still shows the controls; the server must not trust that.
    await updateRows(
      'accounts_memberships',
      `user_id=eq.${coOwner.userId}&account_id=eq.${team.accountId}`,
      { account_role: 'member' },
    );

    await byTest(page, 'api-key-save').click();

    await expect(byTest(page, 'api-key-error')).toHaveText(
      'Only account owners can add, replace or remove API keys.',
    );
    if (EVIDENCE) {
      await page
        .getByRole('dialog')
        .screenshot({ path: `${EVIDENCE}/kb84-04-demoted-owner-refused.png` });
    }
    expect(await keyRows(team)).toHaveLength(0);
  });

  test('a member cannot read the ciphertext, nor change or delete a key, through the API', async () => {
    const team = await seedTeamAccount({ emailPrefix: 'kb84-team' });
    const member = await seedUser('kb84-member');
    await seedMembership(member.userId, team.accountId, 'member');

    await insertRow(
      'external_api_keys',
      {
        account_id: team.accountId,
        provider: 'hailuo',
        encrypted_key: 'seeded-ciphertext',
      },
      serviceRoleAuth(),
    );

    await expect(
      readRowsAs(
        member,
        'external_api_keys',
        `account_id=eq.${team.accountId}&select=encrypted_key`,
      ),
    ).rejects.toThrow(/permission denied/);

    // Which providers are configured stays readable.
    await expect(
      readRowsAs<{ provider: string }>(
        member,
        'external_api_keys',
        `account_id=eq.${team.accountId}&select=provider,is_active`,
      ),
    ).resolves.toEqual([{ provider: 'hailuo', is_active: true }]);

    await writeRowsAs(
      member,
      'PATCH',
      'external_api_keys',
      `account_id=eq.${team.accountId}&provider=eq.hailuo`,
      { encrypted_key: 'member-overwrite' },
    );
    await writeRowsAs(
      member,
      'DELETE',
      'external_api_keys',
      `account_id=eq.${team.accountId}&provider=eq.hailuo`,
    );

    expect(await keyRows(team)).toEqual([
      {
        provider: 'hailuo',
        encrypted_key: 'seeded-ciphertext',
        is_active: true,
      },
    ]);
  });
});
