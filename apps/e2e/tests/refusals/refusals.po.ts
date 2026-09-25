import { Locator, Page, expect } from '@playwright/test';

import {
  SeededTeam,
  insertRow,
  seedProject,
  seedTeamAccount,
  seedYouTubeConnection,
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
  {
    // KB-6, the remainder: one of the ten actions that threw a refusal
    // unwrapped until now (convertToScreenplayAction). Its text reaches the
    // page through triggerLlm's error state, not the generic sentence.
    area: 'episodes',
    name: 'converting a story to a screenplay after another tab deleted the episode',
    message: 'Episode not found',
    run: async (page) => {
      const { team, project } = await teamWithProject(page);
      const episode = await seedEpisode(project.id, {
        story_data: {
          title: 'The Lighthouse',
          fullStory: 'Ava climbs the lighthouse stairs as the storm arrives.',
        },
      });

      await page.goto(
        `${studio(team, project.slug)}/episodes/${episode.slug}/story`,
      );
      const convert = page.getByRole('button', {
        name: /Convert to Screenplay/,
      });
      await convert.waitFor();

      // The other tab: the episode goes while this page still shows it.
      await updateRows('episodes', `id=eq.${episode.id}`, {
        deleted_at: new Date().toISOString(),
      });

      await convert.click();
    },
  },
  {
    area: 'assets',
    name: 'renaming a location to a name already taken',
    message:
      'Another asset of the same type in this project is already named "The Old Library". Choose a different name.',
    run: async (page) => {
      const { team, project } = await teamWithProject(page);

      for (const name of ['The Old Library', 'The Harbour']) {
        await insertRow(
          'assets',
          { project_id: project.id, type: 'location', name },
          service,
        );
      }

      await page.goto(`${studio(team, project.slug)}/assets`);
      await page.getByRole('tab', { name: /Locations/ }).click();

      const card = page
        .locator('[data-test="asset-card"]')
        .filter({ hasText: 'The Harbour' });

      await card.hover();
      await card.locator('[data-test="asset-card-menu"]').click();
      await page.locator('[data-test="asset-card-edit"]').click();

      await page
        .locator('[data-test="location-name-input"]')
        .fill('The Old Library');
      await page.locator('[data-test="location-submit"]').click();
    },
  },
  {
    area: 'audio',
    name: 'generating dialogue for a character with no voice',
    message:
      'Missing voice assignments for 1 character(s). Please assign voices or create voice profiles.',
    run: async (page) => {
      const { team, project } = await teamWithProject(page);

      const episode = await seedEpisode(project.id, {
        screenplay_data: {
          title: 'The Lighthouse',
          scenes: [
            {
              sceneNumber: 1,
              heading: 'INT. LIGHTHOUSE - NIGHT',
              action: 'Ava climbs the stairs.',
              dialogue: [{ character: 'Ava', text: 'Is anyone up there?' }],
            },
          ],
        },
      });

      const character = await insertRow<{ id: string }>(
        'assets',
        { project_id: project.id, type: 'character', name: 'Ava' },
        service,
      );

      await insertRow(
        'dialogue_lines',
        {
          episode_id: episode.id,
          character_asset_id: character.id,
          text: 'Is anyone up there?',
          sequence_number: 1,
        },
        service,
      );

      await page.goto(
        `${studio(team, project.slug)}/episodes/${episode.slug}/audio-studio`,
      );
      await page.locator('[data-test="generate-all-dialogue"]').click();
    },
  },
  {
    area: 'publishing',
    name: 'approving a post whose text another tab cleared',
    message:
      'Cannot approve a post without content. Please generate or write post text first.',
    run: async (page) => {
      const team = await seedTeamAccount({ emailPrefix: 'kb6' });

      await seedYouTubeConnection(team.accountId, 'Seeded LinkedIn', {
        platform: 'linkedin',
      });

      const post = await insertRow<{ id: string }>(
        'social_posts',
        {
          account_id: team.accountId,
          raw_notes: 'Notes on the lighthouse shoot',
          final_text: 'We wrapped the lighthouse shoot today.',
          status: 'ready_to_review',
          created_by: team.userId,
        },
        service,
      );

      await signInAs(page, team);
      await page.goto(`/home/${team.slug}/social-posts/${post.id}`);

      const publish = page.getByRole('button', { name: 'Approve & Publish' });

      // Enabled means the post and its connection have loaded into the page.
      await expect(publish).toBeEnabled();

      // The other tab: the text goes while this page still shows it.
      await updateRows('social_posts', `id=eq.${post.id}`, { final_text: '' });

      await publish.click();
    },
  },
  {
    area: 'analytics',
    name: 'adding the same tag twice',
    message: 'A tag with this label already exists in this dimension.',
    run: async (page) => {
      const team = await seedTeamAccount({ emailPrefix: 'kb6' });

      await signInAs(page, team);
      await page.goto(`/home/${team.slug}/studio/analytics/tags`);

      const form = page.locator('[data-test="create-tag-form"]');
      const label = form.getByPlaceholder('e.g. Process explainer');
      const submit = form.getByRole('button', { name: 'Add tag' });

      await label.fill('Process explainer');
      await submit.click();
      await page.getByText('Added "Process explainer"').waitFor();

      // The second submission is the refusal.
      await label.fill('Process explainer');
      await submit.click();
    },
  },
];
