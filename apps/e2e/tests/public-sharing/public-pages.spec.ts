import { Page, expect, test } from '@playwright/test';

import {
  insertRow,
  readRowsAs,
  seedProject,
  seedTeamAccount,
  seedUser,
  serviceRoleAuth,
  uniqueStamp,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * KB-60: public pages read accounts through `public_accounts`, a view that
 * returns only the public fields of public team accounts, because `accounts`
 * itself is now readable by members only.
 *
 * The subject is a signed-in stranger — someone with no role on the team —
 * because that is who public pages work for today. (Logged-out visitors are
 * refused at the schema before any of this runs; that is its own KB.)
 *
 * The same spec passes on the code before the fix, which is the point: the
 * pages must look the same, while the raw read of the account stops
 * returning its email.
 */

const EVIDENCE = process.env.CAPTURE_EVIDENCE
  ? (process.env.EVIDENCE_DIR ?? 'evidence')
  : null;

async function capture(page: Page, name: string) {
  if (EVIDENCE) {
    await page.screenshot({ path: `${EVIDENCE}/${name}.png`, fullPage: true });
  }
}

test.describe('Public pages for a signed-in stranger (KB-60)', () => {
  test('company, project and episode pages render from the public view, and the account row does not', async ({
    page,
  }) => {
    const stamp = uniqueStamp().slice(0, 8);
    const team = await seedTeamAccount({ name: `KB60 Studio ${stamp}` });
    const displayName = `KB60 Public Studio ${stamp}`;

    await updateRows('accounts', `id=eq.${team.accountId}`, {
      email: `press-${stamp}@kb60.dev`,
      public_profile: { is_public: true, display_name: displayName },
    });

    const project = await seedProject(team, { name: `KB60 Show ${stamp}` });
    const projectSlug = `kb60-show-${stamp}`;

    await updateRows('projects', `id=eq.${project.id}`, {
      visibility: 'public',
      public_slug: projectSlug,
    });

    const episodeTitle = `KB60 Pilot ${stamp}`;
    const episodeSlug = `kb60-pilot-${stamp}`;

    await insertRow(
      'episodes',
      {
        project_id: project.id,
        number: 1,
        title: episodeTitle,
        slug: episodeSlug,
        public_slug: episodeSlug,
        visibility: 'inherit',
        localized_videos: {
          en: { youtube: { url: 'https://www.youtube.com/watch?v=kb60' } },
        },
      },
      serviceRoleAuth(),
    );

    const stranger = await seedUser('kb60-stranger');

    // The raw read a stranger could make of the account itself.
    const rows = await readRowsAs<{ id: string; email: string | null }>(
      stranger,
      'accounts',
      `select=id,email&id=eq.${team.accountId}`,
    );

    expect(rows, 'a stranger reads no row of the account itself').toEqual([]);

    await signInAs(page, stranger);

    const company = await page.goto(`/@${team.slug}`);
    expect(company?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: displayName }),
    ).toBeVisible();
    await expect(page.getByText(project.name).first()).toBeVisible();
    await expect(page.getByText(`press-${stamp}@kb60.dev`)).toHaveCount(0);
    await capture(page, '01-company-page');

    const show = await page.goto(`/@${team.slug}/${projectSlug}`);
    expect(show?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: project.name }),
    ).toBeVisible();
    await expect(page.getByText(episodeTitle).first()).toBeVisible();
    await capture(page, '02-project-page');

    const episode = await page.goto(
      `/@${team.slug}/${projectSlug}/e/${episodeSlug}`,
    );
    expect(episode?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: episodeTitle }),
    ).toBeVisible();
    await capture(page, '03-episode-page');
  });

  test('a team that is not public stays a 404', async ({ page }) => {
    const team = await seedTeamAccount();
    const stranger = await seedUser('kb60-stranger');

    await signInAs(page, stranger);

    const response = await page.goto(`/@${team.slug}`);

    expect(response?.status()).toBe(404);
    await capture(page, '04-private-team-404');
  });
});
