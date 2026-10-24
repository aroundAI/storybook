import { type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import {
  episodeVideoUrl,
  readRows,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * KB-215. The Publish screen's title, description and tags lived only in
 * the open page: a reload put the episode's own values back and the tags
 * came back empty. Save now stores them, and the title and description
 * rename the episode itself.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/kb-215-${name}.png` });
}

async function storedEpisode(episodeId: string) {
  const [row] = await readRows<{
    title: string;
    description: string | null;
    metadata: { tags?: string[] } | null;
  }>('episodes', `id=eq.${episodeId}&select=title,description,metadata`);

  return row;
}

async function fill(
  page: Page,
  values: { title: string; description: string; tags: string },
) {
  await page.locator('#title').fill(values.title);
  await page.locator('#description').fill(values.description);
  await page.locator('#tags').fill(values.tags);
}

async function expectFields(
  page: Page,
  values: { title: string; description: string; tags: string },
) {
  await expect(page.locator('#title')).toHaveValue(values.title);
  await expect(page.locator('#description')).toHaveValue(values.description);
  await expect(page.locator('#tags')).toHaveValue(values.tags);
}

test.describe('Publish Settings saves (KB-215)', () => {
  test('Save renames the episode and keeps the tags, across reloads and a second save', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb215' });
    const project = await seedProject(team);
    const { episodeId, slug } = await seedEpisodeWithShot(project.id);

    await updateRows('episodes', `id=eq.${episodeId}`, {
      localized_videos: { en: episodeVideoUrl(episodeId) },
      metadata: { themes: ['ecology'] },
    });

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/publish`,
    );

    const save = byTest(page, 'publish-details-save');
    const unsaved = byTest(page, 'publish-details-unsaved');

    await expect(page.locator('#title')).toHaveValue('Seeded Episode 1');
    await expect(save).toBeDisabled();
    await expect(unsaved).toHaveCount(0);

    const first = {
      title: 'Why India Has So Many Stray Dogs and So Few Vultures',
      description: 'Every day, dead cattle are brought to a carcass dump.',
      tags: 'vultures, india, ecology',
    };

    await fill(page, first);
    await expect(unsaved).toBeVisible();
    await capture(page, '01-unsaved');

    await save.click();
    await expect(unsaved).toHaveCount(0);
    await expect(save).toBeDisabled();
    await expect(
      page.getByRole('heading', { level: 1, name: first.title }),
    ).toBeVisible();
    await capture(page, '02-saved');

    expect(await storedEpisode(episodeId)).toMatchObject({
      title: first.title,
      description: first.description,
      metadata: { themes: ['ecology'], tags: ['vultures', 'india', 'ecology'] },
    });

    await page.reload();
    await expectFields(page, first);
    await expect(save).toBeDisabled();
    await capture(page, '03-after-reload');

    // The second save is where a stale baseline or version would show
    const second = {
      title: 'The Vultures Are Gone. The Dogs Took Their Place',
      description: 'Bikaner, then and now.',
      tags: 'vultures',
    };

    await fill(page, second);
    await save.click();
    await expect(unsaved).toHaveCount(0);

    await page.reload();
    await expectFields(page, second);
    expect(await storedEpisode(episodeId)).toMatchObject({
      title: second.title,
      description: second.description,
      metadata: { themes: ['ecology'], tags: ['vultures'] },
    });

    await page.locator('#title').fill('   ');
    await expect(byTest(page, 'publish-details-title-required')).toBeVisible();
    await expect(save).toBeDisabled();
    await capture(page, '04-title-required');
  });
});
