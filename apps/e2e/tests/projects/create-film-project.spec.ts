import { expect, test } from '@playwright/test';

import { readRows, seedTeamAccount, uniqueStamp } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * KB-58: creating a project goes through `createFilmProjectAction`, an
 * `enhanceAction` now rather than a plain export of a `'use server'` module.
 * The form must still create the project, and a second submission with the
 * same name must still show the refusal as written (KB-6), through the UI
 * only.
 *
 * Screenshots are written only with CAPTURE_EVIDENCE=1.
 */

const OUT = process.env.EVIDENCE_DIR ?? '/tmp/kb58-evidence';
const capture = process.env.CAPTURE_EVIDENCE === '1';

test('the create-project form creates a project, then refuses the same name', async ({
  page,
}) => {
  const team = await seedTeamAccount({ emailPrefix: 'kb58-create' });
  const name = `Night Ferry ${uniqueStamp()}`;

  await signInAs(page, team);

  const submit = async () => {
    await page.goto(`/home/${team.slug}/studio/projects/new`);
    await byTest(page, 'project-name-input').fill(name);
    await byTest(page, 'create-project-submit').click();
  };

  await submit();
  await page.waitForURL(`**/home/${team.slug}/studio/night-ferry-*`);

  const rows = await readRows<{ id: string; name: string; slug: string }>(
    'projects',
    `account_id=eq.${team.accountId}&select=id,name,slug`,
  );
  expect(rows.map((row) => row.name)).toEqual([name]);

  if (capture) {
    await page.screenshot({ path: `${OUT}/01-project-created.png` });
  }

  await submit();

  const toast = page.locator('[data-sonner-toast][data-type="error"]').first();
  await expect(toast).toContainText(
    'A project with this name already exists in this workspace. Choose a different name.',
  );
  await expect(page).toHaveURL(/\/studio\/projects\/new$/);

  const after = await readRows<{ id: string }>(
    'projects',
    `account_id=eq.${team.accountId}&select=id`,
  );
  expect(after).toHaveLength(1);

  if (capture) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(toast).toHaveCSS('opacity', '1');
    await page.screenshot({ path: `${OUT}/02-same-name-refused.png` });
  }
});
