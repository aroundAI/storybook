import { type Page, expect, test } from '@playwright/test';

import {
  type SeededProject,
  type SeededTeam,
  type SeededUser,
  readRows,
  seedEpisodeWithShot,
  seedMembership,
  seedProject,
  seedProjectMember,
  seedTeamAccount,
  seedUser,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * KB-17: canon events are written by the project's writers, as themselves,
 * and never changed afterwards.
 *
 * The database rules are proven in
 * apps/web/supabase/tests/database/immutable-events-immutable.test.sql. This
 * drives the one place the product writes an event by hand -- Story, Canon,
 * Add Event -- to show that a writer still can (twice: the second submission
 * is where reset bugs live) and that a viewer is told no, in words, instead
 * of the save going through.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const evidence = Boolean(process.env.CAPTURE_EVIDENCE);

const REFUSAL = "You can't change this project's canon.";

let team: SeededTeam;
let project: SeededProject;
let episodeSlug: string;
let member: SeededUser;
let viewer: SeededUser;

type EventRow = {
  event_key: string;
  event_type: string;
  created_by: string | null;
  created_by_name: string | null;
};

test.beforeAll(async () => {
  team = await seedTeamAccount({ emailPrefix: 'kb17-owner' });
  project = await seedProject(team, { name: 'KB-17 canon' });

  // Canon is off unless the project turns it on.
  await updateRows('projects', `id=eq.${project.id}`, {
    metadata: { canon: { enabled: true } },
  });

  // The Story page shows the canon sidebar once the episode has a story.
  const episode = await seedEpisodeWithShot(project.id);
  episodeSlug = episode.slug;
  await updateRows('episodes', `id=eq.${episode.episodeId}`, {
    status: 'story',
    story_data: { fullStory: 'Mara held the gate until the last light.' },
  });

  member = await seedUser('kb17-member');
  await seedMembership(member.userId, team.accountId);
  await seedProjectMember(project.id, member.userId, 'member');

  viewer = await seedUser('kb17-viewer');
  await seedMembership(viewer.userId, team.accountId);
  await seedProjectMember(project.id, viewer.userId, 'viewer');
});

async function openCanon(page: Page, user: SeededUser) {
  await signInAs(page, user);
  await page.goto(
    `/home/${team.slug}/studio/${project.slug}/episodes/${episodeSlug}/story`,
  );
  // The story's sidebar starts collapsed, off the right edge.
  await page.locator('[data-test="story-sidebar-toggle"]').click();
  await page.locator('[data-test="story-canon-tab"]').click();
}

async function addEvent(
  page: Page,
  event: { type?: string; key: string; description: string },
) {
  await page.locator('[data-test="canon-add-event"]').click();

  if (event.type) {
    await page.locator('[data-test="canon-event-type"]').click();
    await page.getByRole('option', { name: new RegExp(event.type) }).click();
  }

  await page.locator('[data-test="canon-event-key"]').fill(event.key);
  await page
    .locator('[data-test="canon-event-description"]')
    .fill(event.description);
  await page.locator('[data-test="canon-event-submit"]').click();
}

function eventsOf(projectId: string) {
  return readRows<EventRow>(
    'immutable_events',
    `project_id=eq.${projectId}&select=event_key,event_type,created_by,created_by_name&order=created_at`,
  );
}

test.describe('Canon events (KB-17)', () => {
  test.describe.configure({ mode: 'serial' });

  test('a project member adds two events, each authored by them', async ({
    page,
  }) => {
    await openCanon(page, member);

    const rows = page.locator('[data-test="canon-event"]');

    await addEvent(page, {
      type: 'Death',
      key: 'mara_death',
      description: 'Mara dies holding the gate at the end of episode one.',
    });
    await expect(
      page.getByText('Immutable event added successfully').first(),
    ).toBeVisible();
    await expect(rows).toHaveCount(1);

    // The second submission, with the type left alone: it must be the
    // default again, not the "Death" the first one chose.
    await addEvent(page, {
      key: 'gate_fallen',
      description: 'The northern gate falls and is never rebuilt.',
    });
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText(
      'The northern gate falls and is never rebuilt.',
    );

    if (evidence) {
      await page.screenshot({
        path: `${OUT}/01-member-after-second-event.png`,
      });
    }

    const saved = await eventsOf(project.id);
    expect(saved).toEqual([
      {
        event_key: 'mara_death',
        event_type: 'death',
        created_by: member.userId,
        created_by_name: member.name,
      },
      {
        event_key: 'gate_fallen',
        event_type: 'world_fact',
        created_by: member.userId,
        created_by_name: member.name,
      },
    ]);
  });

  test('a project viewer sees the canon but is refused when adding to it', async ({
    page,
  }) => {
    await openCanon(page, viewer);

    // Reads are on account membership: the viewer sees the member's events.
    await expect(page.locator('[data-test="canon-event"]')).toHaveCount(2);

    await addEvent(page, {
      key: 'viewer_fact',
      description: 'A viewer should not be able to write this.',
    });

    await expect(page.getByText(REFUSAL).first()).toBeVisible();
    // The dialog stays open with what they typed.
    await expect(page.locator('[data-test="canon-event-key"]')).toHaveValue(
      'viewer_fact',
    );

    if (evidence) {
      await page.screenshot({ path: `${OUT}/02-viewer-refused.png` });
    }

    const saved = await eventsOf(project.id);
    expect(saved.map((row) => row.event_key)).toEqual([
      'mara_death',
      'gate_fallen',
    ]);
  });
});
