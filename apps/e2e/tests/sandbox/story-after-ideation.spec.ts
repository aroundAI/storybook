import { type Page, expect, test } from '@playwright/test';

import { assertSandboxFresh } from '../utils/sandbox-freshness';
import {
  insertRow,
  readRows,
  seedProject,
  seedTeamAccount,
  serviceRoleAuth,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * KB-186 and KB-188: Generate Story right after ideation, on the same page,
 * twice. Storing the ideas moves episodes.version under the open page
 * (KB-186), and the Story Orchestrator used to move it again under its own
 * run (KB-188); either way the story never arrived. Every stage runs for
 * real: enqueued to the local job queue, run by the app's llm-worker and
 * answered by the AI sandbox. The second round is where a stale version
 * shows: the page has been through one ideas commit and one story commit.
 *
 * Needs `./scripts/local-env.sh up` and an app started with local.env, as
 * studio-flow-evidence.spec.ts does. Skipped otherwise, and so in CI:
 *
 *   STUDIO_FLOW_EVIDENCE=1 PLAYWRIGHT_BASE_URL=http://localhost:3250 \
 *     npx playwright test story-after-ideation
 */

const CONTROL = process.env.SANDBOX_CONTROL_URL ?? 'http://127.0.0.1:4100';
const STAGE_TIMEOUT = 120_000;

interface EpisodeRow {
  version: number;
  status: string;
  story_data: { generatedAt?: string; fullStory?: string } | null;
  viral_quality: { overallScore?: number } | null;
  metadata: { ideas?: unknown[] } | null;
}

async function episodeRow(id: string) {
  const [row] = await readRows<EpisodeRow>(
    'episodes',
    `id=eq.${id}&select=version,status,story_data,viral_quality,metadata`,
  );
  return row!;
}

/** Ideas through the worker, then the first one through Generate Story. */
async function ideateThenGenerateStory(page: Page, ideationUrl: string) {
  await page.goto(ideationUrl, { timeout: STAGE_TIMEOUT });
  await byTest(page, 'ideation-premise').fill(
    'Mara finds a sealed letter under the lighthouse floorboards, addressed to someone who has not been born yet.',
  );
  await byTest(page, 'ideation-generate').click();
  await expect(page.getByText(/Generated \d+ story ideas/)).toBeVisible({
    timeout: STAGE_TIMEOUT,
  });

  // The first idea card, then the refine dialog's Generate Story
  await byTest(page, 'idea-card').first().click();
  await expect(page.getByText('Refine Your Story')).toBeVisible();
  await page.getByRole('button', { name: 'Generate Story' }).click();

  await expect(page).toHaveURL(/\/story$/, { timeout: STAGE_TIMEOUT });
  await expect(
    page.getByRole('button', { name: 'Convert to Screenplay' }),
  ).toBeVisible({ timeout: STAGE_TIMEOUT });
}

test.describe('Generate Story after ideation (KB-186, KB-188)', () => {
  test.skip(
    !process.env.STUDIO_FLOW_EVIDENCE,
    'Set STUDIO_FLOW_EVIDENCE=1, with the sandbox, the local job queue and a local.env app running.',
  );
  test.beforeAll(() => assertSandboxFresh(CONTROL));
  test.use({ actionTimeout: 30_000 });

  test('reaches the story after ideas arrive, and again after a second round', async ({
    page,
  }) => {
    test.setTimeout(600_000);

    const team = await seedTeamAccount({ emailPrefix: 'story-after-ideas' });
    const project = await seedProject(team, {
      name: 'Gull Point',
      slug: `gull-point-${Date.now()}`,
    });
    const auth = serviceRoleAuth();
    const character = await insertRow<{ id: string }>(
      'assets',
      {
        project_id: project.id,
        type: 'character',
        name: 'Mara Okafor',
        description: "The lighthouse keeper's granddaughter, twelve years old",
      },
      auth,
    );
    const episodeSlug = `the-letter-${Date.now()}`;
    const episode = await insertRow<{ id: string }>(
      'episodes',
      {
        project_id: project.id,
        number: 1,
        title: 'The Letter Under the Floorboards',
        slug: episodeSlug,
        metadata: { character_ids: [character.id] },
      },
      auth,
    );

    await signInAs(page, team);
    const ideationUrl = `/home/${team.slug}/studio/${project.slug}/episodes/${episodeSlug}/ideation`;

    // Round one: the ideas commit moves the version the page was rendered at
    const rendered = (await episodeRow(episode.id)).version;
    await ideateThenGenerateStory(page, ideationUrl);

    const first = await episodeRow(episode.id);
    expect(first.metadata?.ideas?.length).toBeGreaterThan(0);
    expect(first.status).toBe('story');
    expect(first.story_data?.fullStory?.length).toBeGreaterThan(0);
    // The orchestrator's score, stored by the story's commit (KB-188)
    expect(typeof first.viral_quality?.overallScore).toBe('number');
    expect(first.version).toBeGreaterThan(rendered + 1);

    // Round two, on the same episode: new ideas, a new story
    await ideateThenGenerateStory(page, ideationUrl);

    const second = await episodeRow(episode.id);
    expect(second.version).toBeGreaterThan(first.version);
    expect(second.story_data?.generatedAt).not.toBe(
      first.story_data?.generatedAt,
    );
  });
});
