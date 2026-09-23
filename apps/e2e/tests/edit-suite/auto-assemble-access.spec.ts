import { type Page, expect, test } from '@playwright/test';

import { PRODUCTION_SENTENCE } from '../refusals/refusals.po';
import {
  readRows,
  seedEpisodeWithShot,
  seedMembership,
  seedProject,
  seedProjectMember,
  seedTeamAccount,
  seedUser,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * KB-40: who may auto-assemble an episode's timeline in the Edit Suite.
 *
 * Auto-Assemble replaces the episode's edit project, so it follows the
 * project-write rule (`can_write_project`): the project's owner, admins and
 * members. A project viewer, or a team member with no role on the project,
 * can open the Edit Suite and read it, but pressing Auto-Assemble shows why
 * it did nothing. Before KB-40 both of them assembled a timeline.
 *
 * The refusal is returned as a value, so it reads as written on a
 * production build (KB-6); the assertions check the words, and that they
 * are not the sentence a production build puts in a thrown error.
 */

const REFUSAL =
  "Only the project's owner, admins and members can assemble its timeline.";

type Role = 'owner' | 'member' | 'viewer' | 'no project role';

async function seedEpisodeFor(role: Role) {
  const team = await seedTeamAccount({ emailPrefix: 'kb40-owner' });
  const project = await seedProject(team);
  const episode = await seedEpisodeWithShot(project.id);

  if (role === 'owner') {
    return { user: team, team, project, episode };
  }

  const user = await seedUser(`kb40-${role.replaceAll(' ', '-')}`);
  await seedMembership(user.userId, team.accountId, 'member');

  if (role === 'member' || role === 'viewer') {
    await seedProjectMember(project.id, user.userId, role);
  }

  return { user, team, project, episode };
}

async function openEditSuite(
  page: Page,
  fixture: Awaited<ReturnType<typeof seedEpisodeFor>>,
) {
  const { user, team, project, episode } = fixture;

  await signInAs(page, user);
  await page.goto(
    `/home/${team.slug}/studio/${project.slug}/episodes/${episode.slug}/edit-suite`,
  );
}

async function editProjectCount(episodeId: string) {
  const rows = await readRows<{ id: string }>(
    'edit_projects',
    `episode_id=eq.${episodeId}&select=id`,
  );

  return rows.length;
}

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_EVIDENCE) {
    await page.screenshot({
      path: `${process.env.EVIDENCE_DIR ?? '/tmp'}/${name}.png`,
    });
  }
}

test.describe('KB-40: Auto-Assemble follows the project-write rule', () => {
  for (const role of ['owner', 'member'] as const) {
    test(`a project ${role} assembles the timeline`, async ({ page }) => {
      const fixture = await seedEpisodeFor(role);
      await openEditSuite(page, fixture);

      const assemble = page.locator('[data-test="edit-suite-auto-assemble"]');
      await expect(assemble).toBeVisible({ timeout: 60_000 });
      await assemble.click();

      // The button is only offered while no project is loaded, so its
      // disappearance is the timeline arriving.
      await expect(assemble).toBeHidden({ timeout: 60_000 });
      await expect(page.getByText('No project loaded')).toBeHidden();
      await expect(
        page.locator('[data-test="edit-suite-assembly-error"]'),
      ).toHaveCount(0);
      expect(await editProjectCount(fixture.episode.episodeId)).toBe(1);

      await capture(page, `kb40-${role}-assembled`);
    });
  }

  for (const role of ['viewer', 'no project role'] as const) {
    test(`a user with ${role === 'viewer' ? 'a project viewer role' : 'no project role'} is told why nothing happened`, async ({
      page,
    }) => {
      const fixture = await seedEpisodeFor(role);
      await openEditSuite(page, fixture);

      const assemble = page.locator('[data-test="edit-suite-auto-assemble"]');
      const error = page.locator('[data-test="edit-suite-assembly-error"]');

      await expect(assemble).toBeVisible({ timeout: 60_000 });
      await assemble.click();

      await expect(error).toHaveText(REFUSAL, { timeout: 60_000 });
      await expect(error).not.toContainText(PRODUCTION_SENTENCE);
      await expect(assemble).toBeEnabled();
      expect(await editProjectCount(fixture.episode.episodeId)).toBe(0);

      await capture(page, `kb40-${role.replaceAll(' ', '-')}-refused`);

      // The second press: state carried over from the first must not
      // change the answer, or hide it.
      await assemble.click();
      await expect(error).toHaveText(REFUSAL, { timeout: 60_000 });
      await expect(assemble).toBeEnabled();
      expect(await editProjectCount(fixture.episode.episodeId)).toBe(0);
    });
  }
});
