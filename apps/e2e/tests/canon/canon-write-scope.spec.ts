import { type Page, expect, test } from '@playwright/test';

import {
  type SeededProject,
  type SeededTeam,
  type SeededUser,
  insertRow,
  readRows,
  seedEpisodeWithShot,
  seedMembership,
  seedProject,
  seedProjectMember,
  seedTeamAccount,
  seedUser,
  serviceRoleAuth,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * KB-76, KB-77, KB-63: canon is written by the project's writers, and
 * resetting an episode clears all of its canon.
 *
 * The database rules are proven in
 * apps/web/supabase/tests/database/canon-write-scope.test.sql. This drives
 * the two product paths they changed:
 *
 *   Add Thread (Story, Canon, Threads): a viewer is told no, in words, and
 *   no thread is saved; a member adds two.
 *
 *   Reset to Story (the episode's actions menu): a viewer is told no and
 *   nothing is deleted (before, their reset deleted the episode's threads
 *   and summary, then failed); a member's reset removes the episode's
 *   character states, state deltas, summary, the threads it opened, and its
 *   id from the threads it touched (before, the first two and the last were
 *   left behind, because a client could not delete them).
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const evidence = Boolean(process.env.CAPTURE_EVIDENCE);

const CANON_REFUSAL = "You can't change this project's canon.";
const RESET_REFUSAL = "You can't reset this episode.";

let team: SeededTeam;
let project: SeededProject;
let member: SeededUser;
let viewer: SeededUser;

const seeded = {
  episodeId: '',
  episodeSlug: '',
  otherEpisodeId: '',
  touchedThreadId: '',
  openedThreadId: '',
};

test.beforeAll(async () => {
  const service = serviceRoleAuth();

  team = await seedTeamAccount({ emailPrefix: 'kb76-owner' });
  project = await seedProject(team, { name: 'KB-76 canon' });

  await updateRows('projects', `id=eq.${project.id}`, {
    metadata: { canon: { enabled: true } },
  });

  // E is the episode under test, in storyboard so "Reset to Story" is
  // offered. E2 opened a thread that E later touched.
  const episode = await seedEpisodeWithShot(project.id, { number: 1 });
  const other = await seedEpisodeWithShot(project.id, { number: 2 });
  seeded.episodeId = episode.episodeId;
  seeded.episodeSlug = episode.slug;
  seeded.otherEpisodeId = other.episodeId;

  await updateRows('episodes', `id=eq.${episode.episodeId}`, {
    status: 'storyboard',
    story_data: { fullStory: 'Mara held the gate until the last light.' },
    screenplay_data: { scenes: [] },
  });

  const character = await insertRow<{ id: string }>(
    'assets',
    { project_id: project.id, type: 'character', name: 'Mara' },
    service,
  );

  const touched = await insertRow<{ id: string }>(
    'narrative_threads',
    {
      project_id: project.id,
      thread_name: 'The northern gate',
      opened_at: other.episodeId,
      episodes_touched: [other.episodeId, episode.episodeId],
    },
    service,
  );
  const opened = await insertRow<{ id: string }>(
    'narrative_threads',
    {
      project_id: project.id,
      thread_name: 'Who opened the gate',
      opened_at: episode.episodeId,
      episodes_touched: [episode.episodeId],
    },
    service,
  );
  seeded.touchedThreadId = touched.id;
  seeded.openedThreadId = opened.id;

  await insertRow(
    'character_states',
    {
      character_id: character.id,
      episode_id: episode.episodeId,
      state_type: 'emotional',
      state_value: { mood: 'resolute' },
      trigger_event: 'She takes the gate',
      created_by: team.userId,
    },
    service,
  );
  await insertRow(
    'state_deltas',
    {
      episode_id: episode.episodeId,
      entity_type: 'character',
      entity_id: character.id,
      change_reason: 'She takes the gate',
    },
    service,
  );
  await insertRow(
    'episode_summaries',
    { episode_id: episode.episodeId, plot_summary: 'Mara holds the gate.' },
    service,
  );

  member = await seedUser('kb76-member');
  await seedMembership(member.userId, team.accountId);
  await seedProjectMember(project.id, member.userId, 'member');

  viewer = await seedUser('kb76-viewer');
  await seedMembership(viewer.userId, team.accountId);
  await seedProjectMember(project.id, viewer.userId, 'viewer');
});

function storyUrl() {
  return `/home/${team.slug}/studio/${project.slug}/episodes/${seeded.episodeSlug}/story`;
}

async function openThreads(page: Page, user: SeededUser) {
  await signInAs(page, user);
  await page.goto(storyUrl());
  await page.locator('[data-test="story-sidebar-toggle"]').click();
  await page.locator('[data-test="story-canon-tab"]').click();
  await page.locator('[data-test="canon-threads-tab"]').click();
}

async function addThread(page: Page, name: string) {
  await page.locator('[data-test="canon-add-thread"]').first().click();
  await page.locator('[data-test="canon-thread-name"]').fill(name);
  await page
    .locator('[data-test="canon-thread-description"]')
    .fill(`${name}, carried across the season.`);
  await page.locator('[data-test="canon-thread-submit"]').click();
}

async function resetToStory(page: Page, user: SeededUser) {
  await signInAs(page, user);
  await page.goto(storyUrl());
  await page.locator('[data-test="episode-actions-trigger"]').first().click();
  await page.locator('[data-test="episode-reset-menu"]').click();
  await page.locator('[data-test="episode-reset-story"]').click();
  await page.locator('[data-test="episode-reset-confirm"]').click();
}

function threadNames() {
  return readRows<{ thread_name: string }>(
    'narrative_threads',
    `project_id=eq.${project.id}&select=thread_name&order=created_at`,
  ).then((rows) => rows.map((row) => row.thread_name));
}

async function canonOfEpisode() {
  const [states, deltas, summaries, opened, touched] = await Promise.all([
    readRows('character_states', `episode_id=eq.${seeded.episodeId}&select=id`),
    readRows('state_deltas', `episode_id=eq.${seeded.episodeId}&select=id`),
    readRows(
      'episode_summaries',
      `episode_id=eq.${seeded.episodeId}&select=id`,
    ),
    readRows('narrative_threads', `id=eq.${seeded.openedThreadId}&select=id`),
    readRows<{ episodes_touched: string[] }>(
      'narrative_threads',
      `id=eq.${seeded.touchedThreadId}&select=episodes_touched`,
    ),
  ]);

  return {
    characterStates: states.length,
    stateDeltas: deltas.length,
    summaries: summaries.length,
    openedThread: opened.length,
    touchedBy: touched[0]?.episodes_touched ?? [],
  };
}

test.describe('Canon write scope (KB-76, KB-77, KB-63)', () => {
  test.describe.configure({ mode: 'serial' });

  test('a project viewer is refused when adding a thread, and nothing is saved', async ({
    page,
  }) => {
    await openThreads(page, viewer);

    // Reads are on account membership: the viewer sees both threads.
    await expect(page.locator('[data-test="canon-thread"]')).toHaveCount(2);

    await addThread(page, 'A viewer thread');

    await expect(page.getByText(CANON_REFUSAL).first()).toBeVisible();
    await expect(page.locator('[data-test="canon-thread-name"]')).toHaveValue(
      'A viewer thread',
    );

    if (evidence) {
      await page.screenshot({
        path: `${OUT}/01-viewer-add-thread-refused.png`,
      });
    }

    expect(await threadNames()).toEqual([
      'The northern gate',
      'Who opened the gate',
    ]);
  });

  test('a project member adds two threads', async ({ page }) => {
    await openThreads(page, member);

    const threads = page.locator('[data-test="canon-thread"]');
    await expect(threads).toHaveCount(2);

    await addThread(page, 'The traitor at the gate');
    await expect(
      page.getByText('Narrative thread created successfully').first(),
    ).toBeVisible();
    await expect(threads).toHaveCount(3);

    // The second submission, after the form reset.
    await addThread(page, 'The lost key');
    await expect(threads).toHaveCount(4);

    if (evidence) {
      await page.screenshot({
        path: `${OUT}/02-member-after-second-thread.png`,
      });
    }

    expect(await threadNames()).toEqual([
      'The northern gate',
      'Who opened the gate',
      'The traitor at the gate',
      'The lost key',
    ]);
  });

  test('a project viewer is refused when resetting the episode, and no canon is deleted', async ({
    page,
  }) => {
    await resetToStory(page, viewer);

    await expect(page.getByText(RESET_REFUSAL).first()).toBeVisible();

    if (evidence) {
      await page.screenshot({ path: `${OUT}/03-viewer-reset-refused.png` });
    }

    expect(await canonOfEpisode()).toEqual({
      characterStates: 1,
      stateDeltas: 1,
      summaries: 1,
      openedThread: 1,
      touchedBy: [seeded.otherEpisodeId, seeded.episodeId],
    });

    const [episode] = await readRows<{ status: string }>(
      'episodes',
      `id=eq.${seeded.episodeId}&select=status`,
    );
    expect(episode?.status).toBe('storyboard');
  });

  test('a project member resets the episode to Story, and all of its canon goes with it', async ({
    page,
  }) => {
    await resetToStory(page, member);

    await expect(
      page.getByText('Episode reset to Story').first(),
    ).toBeVisible();

    if (evidence) {
      await page.screenshot({ path: `${OUT}/04-member-reset-done.png` });
    }

    expect(await canonOfEpisode()).toEqual({
      characterStates: 0,
      stateDeltas: 0,
      summaries: 0,
      openedThread: 0,
      touchedBy: [seeded.otherEpisodeId],
    });

    const [episode] = await readRows<{ status: string }>(
      'episodes',
      `id=eq.${seeded.episodeId}&select=status`,
    );
    expect(episode?.status).toBe('draft');
  });
});
