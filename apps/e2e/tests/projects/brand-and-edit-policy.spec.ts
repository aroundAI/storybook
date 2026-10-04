import { type Page, expect, test } from '@playwright/test';

import {
  type SeededProject,
  type SeededTeam,
  insertRow,
  readRows,
  seedMembership,
  seedProject,
  seedTeamAccount,
  seedUser,
  serviceRoleAuth,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-2004: a project's Brand and Edit policy pages. Seeded through the
 * API; the subject is the forms, the live caption preview and what lands in
 * projects.brand / projects.edit_policy.
 *
 * CAPTURE_EVIDENCE=1 also writes the PR screenshots into EVIDENCE_DIR.
 */

const EVIDENCE = !!process.env.CAPTURE_EVIDENCE;
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

const RED = 'rgb(255, 0, 0)';
const GREEN = 'rgb(0, 255, 0)';
const WHITE = 'rgb(255, 255, 255)';

async function shot(page: Page, testId: string, name: string) {
  if (EVIDENCE) {
    await byTest(page, testId).screenshot({ path: `${OUT}/${name}.png` });
  }
}

/**
 * The whole page. The app scrolls inside its main column, not the window,
 * so fullPage would stop at the fold: the evidence run uses a tall viewport.
 */
async function pageShot(page: Page, name: string) {
  if (EVIDENCE) {
    await page.screenshot({ path: `${OUT}/${name}.png` });
  }
}

const previewText = (page: Page) =>
  byTest(page, 'brand-caption-preview-text').locator('span').first();

async function stored(projectId: string) {
  const [row] = await readRows<{
    brand: Record<string, Record<string, unknown>>;
    edit_policy: Record<string, unknown>;
  }>('projects', `id=eq.${projectId}&select=brand,edit_policy`);

  return row!;
}

async function choose(page: Page, trigger: string, option: string) {
  await byTest(page, trigger).click();
  await byTest(page, `${trigger}-${option}`).click();
  await expect(byTest(page, trigger)).toContainText(
    option.charAt(0).toUpperCase() + option.slice(1),
  );
}

test.describe('Project brand and edit policy (FILM-2004)', () => {
  let team: SeededTeam;
  let project: SeededProject;

  test.beforeEach(async ({ page }) => {
    if (EVIDENCE) await page.setViewportSize({ width: 1280, height: 2000 });
    team = await seedTeamAccount({ emailPrefix: 'brand' });
    project = await seedProject(team);
  });

  test('the caption preview follows the form, and a saved brand survives a reload twice', async ({
    page,
  }) => {
    const settingsUrl = `/home/${team.slug}/studio/${project.slug}/settings`;

    await signInAs(page, team);
    await page.goto(settingsUrl);
    await byTest(page, 'settings-link-brand').click();
    await page.waitForURL(`**${settingsUrl}/brand`);

    // A project that never set a brand shows the defaults
    const captionText = byTest(page, 'brand-color-caption-text');
    await expect(captionText).toHaveValue('#FFFFFF');
    await expect(previewText(page)).toHaveCSS('color', WHITE);
    await pageShot(page, '01-brand-defaults');

    // The preview changes as the colour is typed, before any save
    await captionText.fill('#FF0000');
    await expect(previewText(page)).toHaveCSS('color', RED);
    await shot(page, 'brand-caption-preview', '02-preview-red');

    // A colour the schema refuses is shown as an error and not saved
    await byTest(page, 'brand-color-caption-background').fill('black');
    await byTest(page, 'brand-save').click();
    await expect(
      page.getByText('Use a hex colour: #RRGGBB or #RRGGBBAA'),
    ).toBeVisible();
    await shot(page, 'brand-settings-form', '03-invalid-colour-refused');
    expect((await stored(project.id)).brand).toEqual({});

    await byTest(page, 'brand-color-caption-background').fill('#000000CC');
    await byTest(page, 'brand-save').click();
    await expect(page.getByText('Brand saved')).toBeVisible();

    const first = await stored(project.id);
    expect(first.brand.colors).toMatchObject({
      captionText: '#FF0000',
      captionBackground: '#000000CC',
    });

    await page.reload();
    await expect(captionText).toHaveValue('#FF0000');
    await expect(previewText(page)).toHaveCSS('color', RED);
    await pageShot(page, '04-brand-after-reload');

    // The second submission: a fresh form state after a save and reload
    await captionText.fill('#00FF00');
    await choose(page, 'brand-caption-position', 'top');
    await expect(previewText(page)).toHaveCSS('color', GREEN);
    await byTest(page, 'brand-save').click();
    await expect(page.getByText('Brand saved')).toBeVisible();

    await page.reload();
    await expect(captionText).toHaveValue('#00FF00');
    await expect(byTest(page, 'brand-caption-position')).toContainText('Top');
    await expect(previewText(page)).toHaveCSS('color', GREEN);
    await shot(page, 'brand-caption-preview', '05-second-save-green-top');

    const second = await stored(project.id);
    expect(second.brand.colors).toMatchObject({
      captionText: '#00FF00',
      captionBackground: '#000000CC',
    });
    expect(second.brand.captionStyle).toMatchObject({ position: 'top' });

    // Emphasis words are comma-separated tags, saved as a list
    await byTest(page, 'brand-caption-emphasis-words').fill('free, never ,');
    await byTest(page, 'brand-save').click();
    await expect(page.getByText('Brand saved')).toBeVisible();
    await page.reload();
    await expect(byTest(page, 'brand-caption-emphasis-words')).toHaveValue(
      'free, never',
    );
    await pageShot(page, '10-brand-emphasis-words-saved');
    expect((await stored(project.id)).brand.captionStyle).toMatchObject({
      emphasisWords: ['free', 'never'],
    });
    // The whole object is stored, defaults included
    expect(second.brand).toHaveProperty('transitionStyle', 'cut');
  });

  test('the logo picks from the project assets and shows in the preview', async ({
    page,
  }) => {
    const logo = await insertRow<{ id: string }>(
      'assets',
      {
        project_id: project.id,
        name: 'Channel logo',
        type: 'prop',
        content_type: 'image/png',
      },
      serviceRoleAuth(),
    );

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/${project.slug}/settings/brand`);

    await byTest(page, 'brand-logo-asset').click();
    await page.getByRole('option', { name: /Channel logo/ }).click();
    await expect(byTest(page, 'brand-caption-preview-logo')).toBeVisible();
    await byTest(page, 'brand-save').click();
    await expect(page.getByText('Brand saved')).toBeVisible();

    expect((await stored(project.id)).brand.logo).toMatchObject({
      assetId: logo.id,
    });
  });

  test('an edit policy whose shortest shot passes its longest is refused, then saved twice', async ({
    page,
  }) => {
    const url = `/home/${team.slug}/studio/${project.slug}/settings/edit-policy`;

    await signInAs(page, team);
    await page.goto(url);

    const min = byTest(page, 'policy-min-shot');
    const max = byTest(page, 'policy-max-shot');
    await expect(min).toHaveValue('1.2');
    await expect(max).toHaveValue('6');

    await min.fill('5');
    await max.fill('3');
    await byTest(page, 'edit-policy-save').click();
    await expect(
      page.getByText(
        'The shortest shot cannot be longer than the longest shot',
      ),
    ).toBeVisible();
    await shot(page, 'edit-policy-settings-form', '06-policy-min-over-max');
    expect((await stored(project.id)).edit_policy).toEqual({});

    await max.fill('8');
    await byTest(page, 'policy-transition-dip').click();
    await byTest(page, 'edit-policy-save').click();
    await expect(page.getByText('Edit policy saved')).toBeVisible();

    await page.reload();
    await expect(min).toHaveValue('5');
    await expect(max).toHaveValue('8');
    await expect(byTest(page, 'policy-transition-dip')).toBeChecked();

    // Second submission
    await byTest(page, 'policy-music-duck-db').fill('-12');
    await byTest(page, 'policy-target-duration').fill('300');

    // Dialogue drops default to "ask"; a silence over the ceiling is refused
    await expect(byTest(page, 'policy-dialogue-cuts')).toContainText(
      'Ask me for each drop',
    );
    await expect(byTest(page, 'policy-max-silence')).toHaveValue('1.5');
    await byTest(page, 'policy-max-silence').fill('11');
    await byTest(page, 'edit-policy-save').click();
    await expect(page.getByText(/less than or equal to 10/i)).toBeVisible();
    await shot(page, 'edit-policy-settings-form', '09-policy-silence-refused');

    await byTest(page, 'policy-max-silence').fill('2.5');
    await choose(page, 'policy-dialogue-cuts', 'never');
    await byTest(page, 'edit-policy-save').click();
    await expect(page.getByText('Edit policy saved')).toBeVisible();

    await page.reload();
    await expect(byTest(page, 'policy-music-duck-db')).toHaveValue('-12');
    await expect(byTest(page, 'policy-target-duration')).toHaveValue('300');
    await expect(byTest(page, 'policy-max-silence')).toHaveValue('2.5');
    await expect(byTest(page, 'policy-dialogue-cuts')).toContainText(
      'Never drop dialogue',
    );
    await pageShot(page, '07-policy-after-second-save');

    expect((await stored(project.id)).edit_policy).toMatchObject({
      minShotLength: 5,
      maxShotLength: 8,
      targetDurationSeconds: 300,
      transitions: { preferred: ['cut', 'dissolve', 'dip'] },
      music: { duckDb: -12, enabled: true },
      allowDialogueCuts: 'never',
      maxSilenceSeconds: 2.5,
    });
  });

  test('a project admin without the team settings permission sees the pages read-only', async ({
    page,
  }) => {
    const member = await seedUser('brand-nomanage');
    // `custom-role` (seed.sql) holds no permissions, so no settings.manage
    await seedMembership(member.userId, team.accountId, 'custom-role');
    await insertRow(
      'project_members',
      { project_id: project.id, user_id: member.userId, role: 'admin' },
      serviceRoleAuth(),
    );

    await signInAs(page, member);
    await page.goto(`/home/${team.slug}/studio/${project.slug}/settings/brand`);

    await expect(byTest(page, 'settings-read-only')).toBeVisible();
    await expect(byTest(page, 'brand-save')).toBeDisabled();
    await expect(byTest(page, 'brand-color-caption-text')).toBeDisabled();
    await pageShot(page, '08-read-only-without-settings-manage');

    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/settings/edit-policy`,
    );
    await expect(byTest(page, 'edit-policy-save')).toBeDisabled();
  });
});
