import { Page, expect, test } from '@playwright/test';

import {
  SeededProject,
  SeededTeam,
  insertRow,
  seedProject,
  seedTeamAccount,
  uniqueStamp,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * Another account's episode cannot be used to build a prompt (KB-31).
 *
 * The LLM worker runs on the service-role key and builds story ideas from
 * whatever episode the job names — its characters, locations, season premise
 * and facts — then sends the result to whoever asked. Reproduced before the
 * fix with two real users: user B, on B's own ideation page, rewrote the
 * request to name A's episode, and the action queued it. It is now refused
 * unless the caller can write to the episode's project (KB-28's
 * `can_write_project`), and the refusal reaches the page as written in a
 * production build.
 *
 * A public project is the sharper case: its episodes are readable by anyone
 * (through public_episodes since KB-85/88), so "the row came back" is no
 * proof of anything.
 */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:55321';

// Local Supabase's published demo keys, as in `utils/seed.ts`
const ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const PREMISE = 'A lighthouse keeper finds a message in a bottle.';

interface SeededEpisode {
  id: string;
  slug: string;
}

async function seedEpisode(project: SeededProject): Promise<SeededEpisode> {
  const slug = `kb31-episode-${uniqueStamp().slice(0, 8)}`;

  const row = await insertRow<{ id: string }>(
    'episodes',
    { project_id: project.id, number: 1, title: 'KB-31 episode', slug },
    { key: SERVICE_ROLE_KEY },
  );

  return { id: row.id, slug };
}

async function patchAsServiceRole(path: string, body: unknown) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  expect(response.status).toBe(204);
}

/** Public as a public page sees it: a public team, and a public slug. */
async function makePublic(team: SeededTeam, projectId: string) {
  await patchAsServiceRole(`accounts?id=eq.${team.accountId}`, {
    public_profile: { is_public: true },
  });
  await patchAsServiceRole(`projects?id=eq.${projectId}`, {
    visibility: 'public',
    public_slug: `kb31-${projectId.slice(0, 8)}`,
  });
}

/**
 * How many rows with this id `user` can read: from `episodes` through RLS,
 * or from `public_episodes`, where anyone reads public episodes.
 */
async function readableEpisodes(
  user: SeededTeam,
  episodeId: string,
  table: 'episodes' | 'public_episodes' = 'episodes',
) {
  const session = (await (
    await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: user.password }),
    })
  ).json()) as { access_token: string };

  const rows = (await (
    await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?id=eq.${episodeId}&select=id`,
      {
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
      },
    )
  ).json()) as unknown[];

  return rows.length;
}

/**
 * Rewrites the ideation action's request from B's own page so that it names
 * `victim` instead — the forged request an attacker would send.
 */
async function forgeIdeationRequest(page: Page, own: string, victim: string) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const body = request.postData() ?? '';

    if (
      request.method() === 'POST' &&
      request.headers()['next-action'] &&
      body.includes(own)
    ) {
      await route.continue({ postData: body.replaceAll(own, victim) });
      return;
    }

    await route.continue();
  });
}

async function openIdeation(
  page: Page,
  user: SeededTeam,
  project: SeededProject,
  episode: SeededEpisode,
) {
  await signInAs(page, user);
  await page.goto(
    `/home/${user.slug}/studio/${project.slug}/episodes/${episode.slug}/ideation`,
  );
  // The page can briefly render the form twice while it hydrates; wait for
  // the one that stays, rather than filling whichever comes first.
  await expect(byTest(page, 'ideation-premise')).toHaveCount(1);
  await expect(byTest(page, 'ideation-premise')).toBeVisible();
}

async function generate(page: Page) {
  await byTest(page, 'ideation-premise').fill(PREMISE);
  await byTest(page, 'ideation-generate').click();
}

const toast = (page: Page) => page.locator('[data-sonner-toast]').first();

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  await page.screenshot({
    path: `${process.env.EVIDENCE_DIR ?? 'evidence'}/${name}.png`,
    fullPage: false,
  });
}

test.describe('LLM jobs name only what the caller may write (KB-31)', () => {
  let attacker: SeededTeam;
  let attackerProject: SeededProject;
  let attackerEpisode: SeededEpisode;
  let victim: SeededTeam;
  let victimProject: SeededProject;
  let victimEpisode: SeededEpisode;

  test.beforeEach(async () => {
    attacker = await seedTeamAccount({ emailPrefix: 'kb31-attacker' });
    attackerProject = await seedProject(attacker);
    attackerEpisode = await seedEpisode(attackerProject);

    victim = await seedTeamAccount({ emailPrefix: 'kb31-victim' });
    victimProject = await seedProject(victim);
    victimEpisode = await seedEpisode(victimProject);
  });

  test('a writer’s own episode gets past the check', async ({ page }) => {
    await openIdeation(page, attacker, attackerProject, attackerEpisode);
    await generate(page);

    // Whatever happens next depends on a queue this environment may not
    // have; what matters is that it is not the refusal.
    await expect(toast(page)).toBeVisible();
    await expect(toast(page)).not.toContainText('Episode not found');
    await capture(page, 'kb31-01-own-episode');
  });

  test('another account’s episode is refused, as written', async ({ page }) => {
    expect(await readableEpisodes(attacker, victimEpisode.id)).toBe(0);

    await openIdeation(page, attacker, attackerProject, attackerEpisode);
    await forgeIdeationRequest(page, attackerEpisode.id, victimEpisode.id);
    await generate(page);

    await expect(toast(page)).toContainText('Episode not found');
    await capture(page, 'kb31-02-foreign-episode-refused');
  });

  test('another account’s public episode is refused, though it is readable', async ({
    page,
  }) => {
    await makePublic(victim, victimProject.id);

    // The premise of the attack: B can read the episode.
    expect(
      await readableEpisodes(attacker, victimEpisode.id, 'public_episodes'),
    ).toBe(1);

    await openIdeation(page, attacker, attackerProject, attackerEpisode);
    await forgeIdeationRequest(page, attackerEpisode.id, victimEpisode.id);
    await generate(page);

    await expect(toast(page)).toContainText('Episode not found');
    await capture(page, 'kb31-03-public-episode-refused');
  });
});
