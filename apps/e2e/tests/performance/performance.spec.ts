import { Page, expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

import {
  SeededTeam,
  ownerToken,
  seedCharacters,
  seedEpisodeWithShot,
  seedProject,
  seedScreenplayWithDialogue,
  seedTeamAccount,
  timedRest,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * Timing budgets the specs state, measured on a production build.
 *
 * Each budget is the number in the spec ("loads within 2 seconds"), measured
 * as the median of three runs so one slow start does not fail the suite, and
 * written to `measured.json` in `EVIDENCE_DIR` so a PR can show the figures
 * rather than "it passed". What is timed is what the spec names: a page load
 * is navigation to the page's heading; a tab switch is a click to the next
 * frames; rendering is a click to every card on screen. The database work
 * behind an action is timed at the REST layer, and is said to be exactly
 * that, since a server action cannot be called without its build-specific id.
 */

const RUNS = 3;

/** Budgets are the specs'. Scaling them down is how the suite is shown to fail. */
const BUDGET_SCALE = Number(process.env.PERF_BUDGET_SCALE ?? '1');
const OUT = process.env.EVIDENCE_DIR;
const measured: Record<string, { ms: number; budgetMs: number }> = {};

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)]!;
}

/** The median of RUNS runs of `measure`, recorded and held to its budget. */
async function withinBudget(
  name: string,
  budgetMs: number,
  measure: () => Promise<number>,
) {
  const runs: number[] = [];

  for (let n = 0; n < RUNS; n += 1) runs.push(await measure());

  const ms = Math.round(median(runs));
  const budget = budgetMs * BUDGET_SCALE;

  measured[name] = { ms, budgetMs: budget };
  console.log(
    `PERF ${name}: ${ms}ms (budget ${budget}ms, runs ${runs.map(Math.round)})`,
  );

  expect(ms, `${name} took ${ms}ms against a ${budget}ms budget`).toBeLessThan(
    budget,
  );
}

async function loadTime(page: Page, url: string) {
  const startedAt = Date.now();

  await page.goto(url, { waitUntil: 'load' });
  await expect(page.getByRole('heading').first()).toBeVisible();

  return Date.now() - startedAt;
}

test.afterAll(() => {
  if (!OUT) return;

  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/measured.json`, JSON.stringify(measured, null, 2));
});

test.describe('Performance budgets', () => {
  let team: SeededTeam;
  let base = '';
  let projectId = '';
  let episodePath = '';

  test.beforeAll(async () => {
    team = await seedTeamAccount({ emailPrefix: 'perf' });

    const project = await seedProject(team);
    const episode = await seedEpisodeWithShot(project.id);

    projectId = project.id;
    base = `/home/${team.slug}/studio/${project.slug}`;
    episodePath = `${base}/episodes/${episode.slug}`;

    await seedScreenplayWithDialogue(episode.episodeId);
  });

  test('the asset library loads within 2 seconds (FILM-208)', async ({
    page,
  }) => {
    await signInAs(page, team);
    await withinBudget('asset library load', 2000, () =>
      loadTime(page, `${base}/assets`),
    );
  });

  test('the episode workspace loads within 1 second (FILM-312)', async ({
    page,
  }) => {
    await signInAs(page, team);
    await withinBudget('episode workspace load', 1000, () =>
      loadTime(page, `${episodePath}/ideation`),
    );
  });

  test('the revenue dashboard loads within 2 seconds (FILM-810)', async ({
    page,
  }) => {
    await signInAs(page, team);
    await withinBudget('revenue dashboard load', 2000, () =>
      loadTime(page, `/home/${team.slug}/studio/analytics`),
    );
  });

  test('the audio studio loads within 1 second and switches tabs within 100ms (FILM-505)', async ({
    page,
  }) => {
    await signInAs(page, team);
    await withinBudget('audio studio load', 1000, () =>
      loadTime(page, `${episodePath}/audio-studio`),
    );

    await expect(byTest(page, 'audio-tab-sfx')).toBeVisible();

    // From the click to two frames later: the new tab's content is on screen.
    await withinBudget('audio studio tab switch', 100, () =>
      page.evaluate(async () => {
        const started = performance.now();

        (
          document.querySelector('[data-test="audio-tab-sfx"]') as HTMLElement
        ).click();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );

        const elapsed = performance.now() - started;

        // Back to the first tab so the next run switches again.
        (
          document.querySelector(
            '[data-test="audio-tab-dialogue"]',
          ) as HTMLElement | null
        )?.click();
        await new Promise((resolve) => setTimeout(resolve, 50));

        return elapsed;
      }),
    );
  });

  test('50 characters render within 500ms (FILM-204)', async ({ page }) => {
    await seedCharacters(team, projectId, 50);
    await signInAs(page, team);

    // Start on Locations, so the characters are loaded but not on screen; then
    // time from the click on Characters until every card is on screen.
    await page.goto(`${base}/assets?tab=location`);
    await expect(byTest(page, 'studio-nav-locations')).toBeVisible();
    await expect(page.getByRole('tab', { name: /Characters/ })).toBeVisible();

    await withinBudget('render 50 characters', 500, async () => {
      await page.getByRole('tab', { name: /Locations/ }).click();
      await expect(
        page.getByRole('tab', { name: /Locations/ }),
      ).toHaveAttribute('aria-selected', 'true');

      return page.evaluate(async () => {
        const tab = [...document.querySelectorAll('[role="tab"]')].find((t) =>
          /Characters/.test(t.textContent ?? ''),
        ) as HTMLElement;
        const started = performance.now();

        // Radix tabs switch on mouse-down, not on click.
        tab.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, button: 0 }),
        );

        while (
          document.querySelectorAll('[data-test="asset-card"]').length < 50
        ) {
          if (performance.now() - started > 5000) break;
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }

        return performance.now() - started;
      });
    });
  });

  test('the database work behind the create and read actions is fast (FILM-201, 202, 301, 303)', async () => {
    const token = await ownerToken(team);

    await withinBudget(
      'create an asset (database work)',
      2000,
      async () =>
        (
          await timedRest('POST', '/rest/v1/assets', token, {
            project_id: projectId,
            type: 'location',
            name: `Place ${Math.random()}`,
          })
        ).ms,
    );

    await withinBudget(
      'create a character (database work)',
      3000,
      async () =>
        (
          await timedRest(
            'POST',
            '/rest/v1/rpc/create_character_with_details',
            token,
            { p_project_id: projectId, p_name: `Someone ${Math.random()}` },
          )
        ).ms,
    );

    await withinBudget(
      'create an episode (database work)',
      3000,
      async () =>
        (
          await timedRest('POST', '/rest/v1/episodes', token, {
            project_id: projectId,
            number: Math.floor(1000 + Math.random() * 100000),
            title: 'Timed episode',
          })
        ).ms,
    );

    const episode = await seedEpisodeWithShot(projectId, { number: 9000 });

    await withinBudget(
      'create a shot (database work)',
      3000,
      async () =>
        (
          await timedRest('POST', '/rest/v1/shots', token, {
            episode_id: episode.episodeId,
            sequence_number: Math.floor(2 + Math.random() * 100000),
            prompt: 'Timed shot',
          })
        ).ms,
    );

    await withinBudget(
      'list the project’s assets (database work)',
      2000,
      async () =>
        (
          await timedRest(
            'GET',
            `/rest/v1/assets?project_id=eq.${projectId}&select=*`,
            token,
          )
        ).ms,
    );
  });
});
