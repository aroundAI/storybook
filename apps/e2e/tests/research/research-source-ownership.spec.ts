import { type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import {
  type SeededProject,
  type SeededTeam,
  readRows,
  readRowsAs,
  seedMembership,
  seedProject,
  seedProjectMember,
  seedTeamAccount,
  seedUser,
  uniqueStamp,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * KB-37: research sources belong to a team.
 *
 * The hub's "Add Source" used to write a row every team saw, and its delete
 * deactivated any source by id, behind a check that the caller owned *some*
 * account, which anyone is one `create_team_account` call away from. Now a
 * source belongs to the project or, for a team owner, to the team; built-ins
 * cannot be changed from the app, and RLS refuses anyone else.
 *
 * The UI cases drive the dialog; the cross-team cases use the other team's
 * own JWT against the Data API, which is the path an attacker would use.
 * Refusal texts are asserted on the page, so this must run against a
 * production build, where a thrown message would be replaced.
 */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:55321';
const ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/kb-37-${name}.png`, fullPage: true });
}

async function tokenFor(user: { email: string; password: string }) {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    },
  );
  return ((await response.json()) as { access_token: string }).access_token;
}

/** A Data API write as a signed-in user: RLS decides. */
async function writeAs(
  token: string,
  method: 'POST' | 'PATCH',
  query: string,
  body: Record<string, unknown>,
) {
  return fetch(`${SUPABASE_URL}/rest/v1/external_sources${query}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
}

function researchPath(team: SeededTeam, project: SeededProject) {
  return `/home/${team.slug}/studio/${project.slug}/research`;
}

function sourceRow(page: Page, name: string) {
  return page.locator('[data-test="research-source-row"]', { hasText: name });
}

/** The list loads client-side; a built-in proves it has arrived. */
async function waitForSourceList(page: Page) {
  await expect(sourceRow(page, 'Reuters')).toHaveCount(1);
}

async function addSource(
  page: Page,
  name: string,
  scope?: 'This project' | 'Every project in the team',
) {
  await page.getByRole('button', { name: 'Add Source' }).first().click();

  const dialog = page.getByRole('dialog');
  await byTest(dialog, 'add-source-name').fill(name);
  await byTest(dialog, 'add-source-category').click();
  await page.getByRole('option', { name: 'research' }).click();

  if (scope) {
    await byTest(dialog, 'add-source-scope').click();
    await page.getByRole('option', { name: scope }).click();
  }

  await byTest(dialog, 'add-source-submit').click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

test.describe('Research sources belong to a team (KB-37)', () => {
  test('a team owner adds project and team sources; built-ins cannot be removed; another team can change none of them', async ({
    page,
    browser,
  }) => {
    const alice = await seedTeamAccount({ emailPrefix: 'kb37-alice' });
    const project = await seedProject(alice);
    const bob = await seedTeamAccount({ emailPrefix: 'kb37-bob' });
    const stamp = uniqueStamp().slice(0, 8);
    const projectSource = `Draft notes ${stamp}`;
    const teamSource = `House style ${stamp}`;

    await signInAs(page, alice);
    await page.goto(researchPath(alice, project));
    await waitForSourceList(page);

    // A built-in says so and has no remove button.
    const reuters = sourceRow(page, 'Reuters');
    await expect(byTest(reuters, 'research-source-kind')).toHaveText(
      'Built-in',
    );
    await expect(byTest(reuters, 'research-source-remove')).toHaveCount(0);

    // A team-wide source first, then, after the dialog has reset, a source
    // with the default scope: the second must be this project's, not the
    // team's (a Select that kept its last value would make it the team's).
    await addSource(page, teamSource, 'Every project in the team');
    await expect(
      sourceRow(page, teamSource).locator('[data-test="research-source-kind"]'),
    ).toHaveText('Team');

    await addSource(page, projectSource);
    await expect(
      sourceRow(page, projectSource).locator(
        '[data-test="research-source-kind"]',
      ),
    ).toHaveText('This project');
    await capture(page, '01-owner-hub-after-two-adds');

    const [teamRow] = await readRows<{
      id: string;
      account_id: string | null;
      project_id: string | null;
      is_builtin: boolean;
    }>(
      'external_sources',
      `name=eq.${encodeURIComponent(teamSource)}&select=id,account_id,project_id,is_builtin`,
    );
    expect(teamRow).toMatchObject({
      account_id: alice.accountId,
      project_id: null,
      is_builtin: false,
    });

    const [projectRow] = await readRows<{
      id: string;
      account_id: string | null;
      project_id: string | null;
    }>(
      'external_sources',
      `name=eq.${encodeURIComponent(projectSource)}&select=id,account_id,project_id`,
    );
    expect(projectRow).toMatchObject({
      account_id: alice.accountId,
      project_id: project.id,
    });

    // Bob, owner of another team, with his own JWT.
    const bobToken = await tokenFor(bob);

    expect(
      await readRowsAs(
        bob,
        'external_sources',
        `id=in.(${teamRow!.id},${projectRow!.id})&select=id`,
      ),
    ).toEqual([]);

    for (const id of [teamRow!.id, projectRow!.id]) {
      const response = await writeAs(bobToken, 'PATCH', `?id=eq.${id}`, {
        is_active: false,
      });
      expect(await response.json()).toEqual([]);
    }

    const reutersPatch = await writeAs(
      bobToken,
      'PATCH',
      '?slug=eq.reuters&is_builtin=eq.true',
      { is_active: false },
    );
    expect(await reutersPatch.json()).toEqual([]);

    const planted = await writeAs(bobToken, 'POST', '', {
      name: 'Planted',
      slug: `planted-${stamp}`,
      account_id: alice.accountId,
      category: 'news',
      provider_type: 'manual',
    });
    expect(planted.status).toBe(403);

    const unowned = await writeAs(bobToken, 'POST', '', {
      name: 'Planted shared',
      slug: `planted-shared-${stamp}`,
      category: 'news',
      provider_type: 'manual',
    });
    expect(unowned.status).toBe(403);

    const stillActive = await readRows<{ is_active: boolean }>(
      'external_sources',
      `id=in.(${teamRow!.id},${projectRow!.id})&select=is_active`,
    );
    expect(stillActive.map((row) => row.is_active)).toEqual([true, true]);

    // Bob's hub shows neither of Alice's sources.
    const bobProject = await seedProject(bob);
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await signInAs(bobPage, bob);
    await bobPage.goto(researchPath(bob, bobProject));
    await waitForSourceList(bobPage);
    await expect(sourceRow(bobPage, teamSource)).toHaveCount(0);
    await expect(sourceRow(bobPage, projectSource)).toHaveCount(0);
    await capture(bobPage, '02-other-team-hub');
    await bobContext.close();

    // Alice removes her project source.
    await sourceRow(page, projectSource)
      .locator('[data-test="research-source-remove"]')
      .click();
    await expect(page.getByText('Source removed')).toBeVisible();
    await expect(sourceRow(page, projectSource)).toHaveCount(0);
  });

  test('a team member who is not an owner gets no team option and cannot remove team sources; a removal RLS refuses reads as a refusal', async ({
    page,
  }) => {
    const alice = await seedTeamAccount({ emailPrefix: 'kb37-owner' });
    const project = await seedProject(alice);
    const other = await seedTeamAccount({ emailPrefix: 'kb37-other' });
    const otherProject = await seedProject(other);
    const carol = await seedUser('kb37-carol');
    await seedMembership(carol.userId, alice.accountId, 'member');
    await seedProjectMember(project.id, carol.userId, 'member');

    const stamp = uniqueStamp().slice(0, 8);
    const teamSource = `Team glossary ${stamp}`;
    const carolSource = `Carol notes ${stamp}`;

    // The team source, as Alice would have added it.
    const aliceToken = await tokenFor(alice);
    const created = await writeAs(aliceToken, 'POST', '', {
      name: teamSource,
      slug: `team-glossary-${stamp}`,
      account_id: alice.accountId,
      category: 'research',
      provider_type: 'manual',
    });
    expect(created.status).toBe(201);

    await signInAs(page, carol);
    await page.goto(researchPath(alice, project));
    await waitForSourceList(page);

    await expect(sourceRow(page, teamSource)).toHaveCount(1);
    await expect(
      sourceRow(page, teamSource).locator(
        '[data-test="research-source-remove"]',
      ),
    ).toHaveCount(0);

    await page.getByRole('button', { name: 'Add Source' }).first().click();
    await expect(
      page.getByRole('dialog').locator('[data-test="add-source-scope"]'),
    ).toHaveCount(0);
    await capture(page, '03-member-dialog-without-team-option');
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Carol adds a source to the project; before she removes it, it is moved
    // to another team's project (the state another tab or user would leave).
    await addSource(page, carolSource);
    const [row] = await readRows<{ id: string }>(
      'external_sources',
      `name=eq.${encodeURIComponent(carolSource)}&select=id`,
    );
    await updateRows('external_sources', `id=eq.${row!.id}`, {
      project_id: otherProject.id,
      account_id: other.accountId,
    });

    await sourceRow(page, carolSource)
      .locator('[data-test="research-source-remove"]')
      .click();
    await expect(page.getByText("You can't remove this source.")).toBeVisible();
    await capture(page, '04-refused-removal');

    const [after] = await readRows<{ is_active: boolean }>(
      'external_sources',
      `id=eq.${row!.id}&select=is_active`,
    );
    expect(after?.is_active).toBe(true);
  });
});
