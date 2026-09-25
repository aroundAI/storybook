import { type Page, expect, test } from '@playwright/test';

import {
  type SeededProject,
  type SeededTeam,
  readRows,
  seedProject,
  seedTeamAccount,
  uniqueStamp,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * KB-26: an uploaded research source belongs to its project.
 *
 * Before the fix, a source uploaded in one account was readable, text and
 * all, by any signed-in user through the Data API, and a second account
 * uploading the same name overwrote the first one's source row. These cases
 * drive the real upload dialog as one user and read as a second, with that
 * second user's own JWT, which is the path an attacker would use. A test
 * reading as the service role would prove nothing about RLS.
 */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:55321';
const ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const capture = !!process.env.CAPTURE_EVIDENCE;

async function tokenFor(user: { email: string; password: string }) {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    },
  );
  const session = (await response.json()) as { access_token: string };
  return session.access_token;
}

/** A Data API read as a signed-in user: RLS decides what comes back. */
async function readAs<T>(token: string, table: string, query: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as T[];
}

function researchPath(team: SeededTeam, project: SeededProject) {
  return `/home/${team.slug}/studio/${project.slug}/research`;
}

async function uploadThroughDialog(page: Page, name: string, text: string) {
  await page.getByRole('button', { name: 'Upload Source' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.locator('[data-test="upload-source-name"]').fill(name);
  await dialog.locator('[data-test="upload-source-paste"]').fill(text);
  await dialog.locator('[data-test="upload-source-submit"]').click();

  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

function sourceRows(page: Page, name: string) {
  return page.locator('[data-test="research-source-row"]', { hasText: name });
}

/**
 * The list loads client-side, so an absence asserted before it arrives
 * passes against an empty page. A seeded shared source proves it has loaded.
 */
async function waitForSourceList(page: Page) {
  await expect(sourceRows(page, 'Reuters')).toHaveCount(1);
}

test.describe('Research sources are private to their project (KB-26)', () => {
  test('an upload is readable by its project and nobody else', async ({
    page,
    browser,
  }) => {
    const alice = await seedTeamAccount({ emailPrefix: 'kb26-alice' });
    const aliceProject = await seedProject(alice);
    const bob = await seedTeamAccount({ emailPrefix: 'kb26-bob' });
    const bobProject = await seedProject(bob);

    const name = `Interview notes ${uniqueStamp().slice(0, 8)}`;

    // Alice uploads twice under the same name: the second submission, after
    // the dialog has reset, must reuse her source rather than add a second.
    await signInAs(page, alice);
    await page.goto(researchPath(alice, aliceProject));
    await waitForSourceList(page);

    await uploadThroughDialog(
      page,
      name,
      'Private interview: the mayor confirmed 12 closures in Geneva in 2024.',
    );
    await expect(sourceRows(page, name)).toHaveCount(1);

    await uploadThroughDialog(
      page,
      name,
      'Second private note: 3 more closures were confirmed in March 2025.',
    );
    await expect(sourceRows(page, name)).toHaveCount(1);

    if (capture) {
      await sourceRows(page, name).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${OUT}/01-alice-hub-after-two-uploads.png`,
        fullPage: true,
      });
    }

    const aliceContent = await readRows<{
      project_id: string;
      is_upload: boolean;
    }>(
      'external_content',
      `project_id=eq.${aliceProject.id}&select=project_id,is_upload`,
    );
    expect(aliceContent).toHaveLength(2);
    expect(aliceContent.every((row) => row.is_upload)).toBe(true);

    // Bob, owner of another team, reads with his own JWT.
    const bobToken = await tokenFor(bob);

    expect(
      await readAs(
        bobToken,
        'external_content',
        `project_id=eq.${aliceProject.id}&select=title,content`,
      ),
    ).toEqual([]);
    expect(
      await readAs(
        bobToken,
        'external_sources',
        `project_id=eq.${aliceProject.id}&select=name`,
      ),
    ).toEqual([]);

    // Making the project public lets Bob read the project (through
    // public_projects since KB-85/88: a public team's project with a public
    // slug), and still not the research uploaded into it.
    await updateRows('accounts', `id=eq.${alice.accountId}`, {
      public_profile: { is_public: true },
    });
    await updateRows('projects', `id=eq.${aliceProject.id}`, {
      visibility: 'public',
      public_slug: `kb26-${aliceProject.id.slice(0, 8)}`,
    });
    expect(
      await readAs(
        bobToken,
        'public_projects',
        `id=eq.${aliceProject.id}&select=id`,
      ),
    ).toHaveLength(1);
    expect(
      await readAs(
        bobToken,
        'external_content',
        `project_id=eq.${aliceProject.id}&select=title`,
      ),
    ).toEqual([]);

    // Bob uploads a source with the same name into his own project.
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();

    await signInAs(bobPage, bob);
    await bobPage.goto(researchPath(bob, bobProject));
    await waitForSourceList(bobPage);
    await expect(sourceRows(bobPage, name)).toHaveCount(0);

    if (capture) {
      await bobPage.screenshot({
        path: `${OUT}/02-bob-hub-without-alices-upload.png`,
        fullPage: true,
      });
    }

    await uploadThroughDialog(
      bobPage,
      name,
      'Bob has his own notes on 7 topics.',
    );
    await expect(sourceRows(bobPage, name)).toHaveCount(1);

    if (capture) {
      await sourceRows(bobPage, name).scrollIntoViewIfNeeded();
      await bobPage.screenshot({
        path: `${OUT}/03-bob-hub-after-same-name-upload.png`,
        fullPage: true,
      });
    }

    const sources = await readRows<{ project_id: string }>(
      'external_sources',
      `name=eq.${encodeURIComponent(name)}&select=project_id`,
    );
    expect(sources.map((row) => row.project_id).sort()).toEqual(
      [aliceProject.id, bobProject.id].sort(),
    );

    // Bob cannot add research to Alice's public project either. The route
    // queues work that writes into the project with the service role.
    const refused = await bobPage.request.post('/api/research/upload', {
      multipart: {
        file: {
          name: 'injected.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('injected'),
        },
        projectId: aliceProject.id,
        extractFacts: 'true',
      },
    });
    expect(refused.status()).toBe(403);
    expect((await refused.json()) as { error: string }).toEqual({
      error: 'You need to be a member of this project to add research to it.',
    });

    await bobContext.close();
  });
});
