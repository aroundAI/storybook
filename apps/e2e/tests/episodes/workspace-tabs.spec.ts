import { Page, expect, test } from '@playwright/test';

import {
  SeededTeam,
  insertRow,
  seedProject,
  seedTeamAccount,
  uniqueStamp,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-607: the Edit Suite is retired. The episode workspace offers the
 * story tabs and Publish, and nothing else. Each remaining tab still reaches
 * its page, and an old link to the Edit Suite is not found.
 *
 * Screenshots for the PR are written only when CAPTURE_EVIDENCE is set.
 */
const SERVICE_ROLE_KEY =
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const EVIDENCE = process.env.CAPTURE_EVIDENCE
  ? (process.env.EVIDENCE_DIR ?? 'evidence')
  : null;

// FILM-2205: the stages are a progress rail (aria-current="step"); Video
// opens Publish, whose step is the one marked; Edit record is a page link
const TABS = [
  { id: 'ideation', path: 'ideation', current: 'step' },
  { id: 'story', path: 'story', current: 'step' },
  { id: 'screenplay', path: 'screenplay', current: 'step' },
  { id: 'shot-list', path: 'visual-studio', current: 'step' },
  { id: 'audio', path: 'audio-studio', current: 'step' },
  { id: 'video', path: 'publish', current: null },
  { id: 'publish', path: 'publish', current: 'step' },
  // FILM-2006: the read-only Edit record, not the retired Edit Suite
  { id: 'edit', path: 'edit', current: 'page' },
];

const NOT_FOUND = 'Sorry, this page does not exist.';

/** An episode far enough along that every tab is unlocked. */
async function seedEpisodeWorkspace(page: Page) {
  const team: SeededTeam = await seedTeamAccount({ emailPrefix: 'film607' });
  const project = await seedProject(team);
  const slug = `film607-episode-${uniqueStamp().slice(0, 8)}`;

  await insertRow(
    'episodes',
    {
      project_id: project.id,
      number: 1,
      title: 'The Lighthouse',
      slug,
      story_data: { title: 'The Lighthouse' },
      screenplay_data: { scenes: [] },
      shot_list: { shots: [] },
    },
    { key: SERVICE_ROLE_KEY },
  );

  await signInAs(page, team);

  return `/home/${team.slug}/studio/${project.slug}/episodes/${slug}`;
}

test.describe('Episode workspace tabs (FILM-607)', () => {
  test('shows the story tabs and Publish, and no Edit Suite', async ({
    page,
  }) => {
    const base = await seedEpisodeWorkspace(page);

    await page.goto(`${base}/ideation`);

    const tabs = page.locator('[data-test^="episode-tab-"]');

    // Polled, not read once: while a production page streams in, the layout
    // can briefly be in the DOM twice.
    await expect
      .poll(() =>
        tabs.evaluateAll((elements) =>
          elements.map((element) =>
            element.getAttribute('data-test')?.replace('episode-tab-', ''),
          ),
        ),
      )
      .toEqual(TABS.map((tab) => tab.id));
    await expect(page.getByText('Edit Suite', { exact: true })).toHaveCount(0);

    if (EVIDENCE) {
      await tabs
        .first()
        .locator('xpath=../../..')
        .screenshot({ path: `${EVIDENCE}/01-workspace-tabs.png` });
    }
  });

  test('every remaining tab reaches its page', async ({ page }) => {
    const base = await seedEpisodeWorkspace(page);

    await page.goto(`${base}/ideation`);

    for (const tab of TABS) {
      const link = byTest(page, `episode-tab-${tab.id}`);

      // A click that lands before the page has hydrated is dropped, and a dev
      // server compiles each route on its first visit: retry the click until
      // the navigation happens, rather than sleeping.
      await expect(async () => {
        await link.click();
        await expect(page).toHaveURL(new RegExp(`/${tab.path}$`), {
          timeout: 5_000,
        });
      }).toPass({ timeout: 60_000 });
      if (tab.current) {
        await expect(link).toHaveAttribute('aria-current', tab.current);
      }
      await expect(page.getByText(NOT_FOUND)).toHaveCount(0);
    }

    if (EVIDENCE) {
      await page.screenshot({ path: `${EVIDENCE}/02-publish-tab.png` });
    }
  });

  test('an old link to the Edit Suite is not found', async ({ page }) => {
    const base = await seedEpisodeWorkspace(page);

    await page.goto(`${base}/edit-suite`);

    await expect(page.getByText(NOT_FOUND)).toBeVisible();

    if (EVIDENCE) {
      await page.screenshot({
        path: `${EVIDENCE}/03-edit-suite-not-found.png`,
      });
    }
  });
});
