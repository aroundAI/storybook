import { Locator, Page } from '@playwright/test';

import {
  SeededTeam,
  insertRow,
  seedProject,
  seedTeamAccount,
  uniqueStamp,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';

const SERVICE_ROLE_KEY =
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const service = { key: SERVICE_ROLE_KEY };

/**
 * What a production build puts in an error thrown from a server action. A
 * spec that only checks an error is *visible* passes on this too, which is
 * how KB-6 survived every E2E run.
 */
export const PRODUCTION_SENTENCE =
  'An error occurred in the Server Components render';

/**
 * One expected refusal per feature area (KB-6): a rule the action raises on
 * purpose, driven through the page a user would meet it on.
 *
 * Each `run` seeds through the API, signs in, and stops with the refusal on
 * screen. It asserts nothing: the guard spec asserts the wording, and the
 * evidence spec screenshots whatever is there first — which on an unfixed
 * production build is the generic sentence.
 */
export interface RefusalScenario {
  area: string;
  name: string;
  /** The exact text the user must be able to read. */
  message: string;
  run: (page: Page) => Promise<void>;
}

/** The error toast — not the success toast a second submission follows. */
export function refusalToast(page: Page): Locator {
  return page.locator('[data-sonner-toast][data-type="error"]').first();
}

async function teamWithProject(page: Page) {
  const team = await seedTeamAccount({ emailPrefix: 'kb6' });
  const project = await seedProject(team);

  await signInAs(page, team);

  return { team, project };
}

async function seedEpisode(
  projectId: string,
  extra: Record<string, unknown> = {},
) {
  const slug = `kb6-episode-${uniqueStamp().slice(0, 8)}`;

  const episode = await insertRow<{ id: string }>(
    'episodes',
    {
      project_id: projectId,
      number: 1,
      title: 'The Lighthouse',
      slug,
      ...extra,
    },
    service,
  );

  return { id: episode.id, slug };
}

function studio(team: SeededTeam, projectSlug: string) {
  return `/home/${team.slug}/studio/${projectSlug}`;
}

export const SCENARIOS: RefusalScenario[] = [
  {
    area: 'projects',
    name: 'a second film project with the same name',
    message:
      'A project with this name already exists in this workspace. Choose a different name.',
    run: async (page) => {
      const team = await seedTeamAccount({ emailPrefix: 'kb6' });

      await seedProject(team, {
        name: 'Harbour Lights',
        slug: 'harbour-lights',
      });
      await signInAs(page, team);

      await page.goto(`/home/${team.slug}/studio/projects/new`);
      await page
        .locator('[data-test="project-name-input"]')
        .fill('Harbour Lights');
      await page.locator('[data-test="create-project-submit"]').click();
    },
  },
  {
    area: 'episodes',
    name: 'deleting an episode another tab already deleted',
    message: 'Episode not found',
    run: async (page) => {
      const { team, project } = await teamWithProject(page);
      const episode = await seedEpisode(project.id);

      // The stage route itself: the bare episode route redirects to it, and
      // a redirect that lands after the delete below renders a 404 instead.
      await page.goto(
        `${studio(team, project.slug)}/episodes/${episode.slug}/ideation`,
      );
      await page
        .locator('[data-test="episode-actions-trigger"]')
        .first()
        .waitFor();

      // The other tab: the episode goes while this page still shows it.
      await updateRows('episodes', `id=eq.${episode.id}`, {
        deleted_at: new Date().toISOString(),
      });

      await page
        .locator('[data-test="episode-actions-trigger"]')
        .first()
        .click();
      await page.locator('[data-test="episode-delete-item"]').click();
      await page.locator('[data-test="episode-delete-confirm"]').click();
    },
  },
];
