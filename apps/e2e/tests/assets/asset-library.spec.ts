import { type Page, expect, test } from '@playwright/test';

import { seedProject, seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * The asset library page (FILM-204, FILM-207, FILM-208).
 *
 * Every defect here lived between the DOM and component state, which a unit
 * test cannot see: an empty-state button wired to nothing, a gallery that
 * seeded its list once and never saw a new asset, a dropzone that discarded a
 * rejected file without a word.
 */
async function openAssets(page: Page) {
  const team = await seedTeamAccount();
  const project = await seedProject(team, { name: 'Asset Library Project' });

  await signInAs(page, team);
  await page.goto(`/home/${team.slug}/studio/${project.slug}/assets`);

  return { team, project };
}

async function createCharacter(page: Page, name: string) {
  await byTest(page, 'character-name-input').fill(name);
  await byTest(page, 'character-submit-button').click();
}

test.describe('Asset library', () => {
  test('the empty-state button opens the create dialog', async ({ page }) => {
    await openAssets(page);

    await expect(
      page.getByText('No characters yet').filter({ visible: true }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Create Character' }).click();

    await expect(page.getByRole('dialog')).toContainText('Create Character');
    await expect(byTest(page, 'character-name-input')).toBeVisible();
  });

  test('a new asset appears in the gallery without a reload, twice', async ({
    page,
  }) => {
    await openAssets(page);

    await byTest(page, 'create-asset-button').click();
    await byTest(page, 'create-character-item').click();
    await createCharacter(page, 'First Hero');

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(
      page.getByText('First Hero').filter({ visible: true }),
    ).toBeVisible();

    // The second create runs against a gallery that already holds state, which
    // is where a list seeded once from the server goes stale.
    await byTest(page, 'create-asset-button').click();
    await byTest(page, 'create-character-item').click();
    await createCharacter(page, 'Second Hero');

    await expect(
      page.getByText('Second Hero').filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText('First Hero').filter({ visible: true }),
    ).toBeVisible();
  });

  test('Ctrl+K opens the create menu', async ({ page }) => {
    await openAssets(page);

    await expect(byTest(page, 'create-asset-button')).toBeVisible();

    // The shortcut's listener attaches on hydration, so a press that lands
    // before it does nothing; press again until the menu answers.
    await expect(async () => {
      await page.keyboard.press('Control+k');
      await expect(byTest(page, 'create-character-item')).toBeVisible({
        timeout: 1_000,
      });
    }).toPass();

    await expect(byTest(page, 'create-location-item')).toBeVisible();
  });

  test('the breadcrumb runs Home, Studio, the project, Assets', async ({
    page,
  }) => {
    const { team, project } = await openAssets(page);

    const breadcrumb = byTest(page, 'assets-breadcrumb');

    await expect(breadcrumb.getByRole('link')).toHaveText([
      'Home',
      'Studio',
      project.name,
      'Assets',
    ]);
    await expect(
      breadcrumb.getByRole('link', { name: 'Assets' }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      breadcrumb.getByRole('link', { name: 'Home' }),
    ).toHaveAttribute('href', `/home/${team.slug}`);
    await expect(breadcrumb.getByText('Assets')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('the description sits below the title', async ({ page }) => {
    await openAssets(page);

    const title = page.getByRole('heading', { name: 'Cast', level: 1 });
    const description = page
      .getByText('Characters in your story world')
      .filter({ visible: true });

    await expect(description).toBeVisible();

    const titleBox = await title.boundingBox();
    const descriptionBox = await description.boundingBox();

    expect(descriptionBox!.y).toBeGreaterThanOrEqual(
      titleBox!.y + titleBox!.height,
    );
  });

  test('only the active tab loads its assets', async ({ page }) => {
    const requests: string[] = [];

    page.on('request', (request) => {
      if (request.method() === 'POST') {
        requests.push(request.postData() ?? '');
      }
    });

    const { team, project } = await openAssets(page);

    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/assets?tab=location`,
    );
    await expect(
      page.getByText('No locations yet').filter({ visible: true }),
    ).toBeVisible();

    const projectRequests = () =>
      requests.filter((body) => body.includes(project.id));

    // The empty state is what the gallery shows before its fetch has gone out,
    // so it being visible says nothing about the requests: wait for the
    // locations request itself, then for the page to go quiet, and only then
    // read what was asked for.
    await expect.poll(() => projectRequests().length).toBeGreaterThan(0);
    await page.waitForLoadState('networkidle');

    expect(
      projectRequests().every((body) => body.includes('"type":"location"')),
    ).toBe(true);
  });

  test('a rejected drop says why, with a message per reason', async ({
    page,
  }) => {
    await openAssets(page);

    await page.getByRole('button', { name: 'Create Character' }).click();

    const input = byTest(page, 'image-dropzone-input');
    const error = byTest(page, 'image-dropzone-error');

    await input.setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    });

    await expect(error).toBeVisible();
    await expect(error).toContainText('not supported');
    await expect(error).toHaveAttribute('role', 'alert');

    await input.setInputFiles({
      name: 'huge.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(11 * 1024 * 1024),
    });

    await expect(error).toContainText('too large');
  });
});
