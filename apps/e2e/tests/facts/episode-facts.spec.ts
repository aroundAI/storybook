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
 * The episode's Facts tab (FILM-1142) and the rules behind it (KB-48).
 *
 * Before: the panel expected the action to return an array, the action had
 * returned `{ facts, totalCount }` since June, so the tab said "No facts
 * linked" whatever was linked, the badge never showed and Unlink was on cards
 * that never rendered. The empty panel also handed the link dialog no linked
 * ids, so it offered linked facts again — and re-linking one was refused
 * whole (R8). The database rules are proven in
 * apps/web/supabase/tests/database/studio-owner-access.test.sql.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const evidence = Boolean(process.env.CAPTURE_EVIDENCE);

const UNLINK_REFUSAL =
  "This fact wasn't unlinked: it is no longer linked, or you can't edit this project. Reload the page.";
const LINK_REFUSAL =
  "These facts can't be linked: only facts from this episode's project can be, by someone who can edit it.";

let team: SeededTeam;
let project: SeededProject;
let episodeId: string;
let episodeSlug: string;
let viewer: SeededUser;
const claims: string[] = [];

test.beforeAll(async () => {
  team = await seedTeamAccount({ emailPrefix: 'kb48-owner' });
  project = await seedProject(team, { name: 'KB-48 facts' });

  await updateRows('projects', `id=eq.${project.id}`, {
    metadata: { projectType: 'documentary', canon: { enabled: true } },
  });

  const episode = await seedEpisodeWithShot(project.id);
  episodeId = episode.episodeId;
  episodeSlug = episode.slug;
  await updateRows('episodes', `id=eq.${episodeId}`, {
    status: 'story',
    story_data: { fullStory: 'The keeper lit the lamp for the last time.' },
  });

  for (const n of [1, 2, 3]) {
    const claim = `KB-48 fact ${n}: the lamp burned whale oil until 18${60 + n}`;
    claims.push(claim);
    await insertRow(
      'verified_facts',
      {
        project_id: project.id,
        claim,
        source_type: 'historical_record',
        source_citation: `Keeper's log, volume ${n}`,
      },
      serviceRoleAuth(),
    );
  }

  viewer = await seedUser('kb48-viewer');
  await seedMembership(viewer.userId, team.accountId);
  await seedProjectMember(project.id, viewer.userId, 'viewer');
});

async function openFacts(
  page: Page,
  user: { email: string; password: string },
) {
  await signInAs(page, user);
  await page.goto(
    `/home/${team.slug}/studio/${project.slug}/episodes/${episodeSlug}/story`,
  );
  await page.locator('[data-test="story-sidebar-toggle"]').click();
  await page.locator('[data-test="story-canon-tab"]').click();
  await page.getByRole('tab', { name: /Facts/ }).click();
}

const cards = (page: Page) => page.locator('[data-test="episode-fact-card"]');

async function linkFacts(page: Page, which: string[]) {
  await page.locator('[data-test="episode-facts-link"]').click();
  for (const claim of which) {
    await page
      .locator('[data-test="link-fact-option"]')
      .filter({ hasText: claim })
      .click();
  }
  await page.locator('[data-test="link-facts-submit"]').click();
}

function linksOf(id: string) {
  return readRows<{ fact_id: string }>(
    'episode_facts',
    `episode_id=eq.${id}&select=fact_id`,
  );
}

test.describe('Episode facts (FILM-1142, KB-48)', () => {
  test.describe.configure({ mode: 'serial' });

  test('the owner links facts twice, sees them after a reload, and unlinks one', async ({
    page,
  }) => {
    await openFacts(page, team);

    await expect(
      page.locator('[data-test="episode-facts-empty"]'),
    ).toBeVisible();

    await linkFacts(page, [claims[0]!, claims[1]!]);
    await expect(page.getByText('Linked 2 fact(s) to episode')).toBeVisible();
    await expect(cards(page)).toHaveCount(2);
    await expect(page.locator('[data-test="episode-facts-count"]')).toHaveText(
      '2 facts linked',
    );
    await expect(page.getByRole('tab', { name: /Facts/ })).toContainText('2');

    if (evidence) {
      await page.screenshot({ path: `${OUT}/kb48-01-two-facts-linked.png` });
    }

    // The second link: the dialog must now offer only the fact not yet linked.
    await page.locator('[data-test="episode-facts-link"]').click();
    const options = page.locator('[data-test="link-fact-option"]');
    await expect(options).toHaveCount(1);
    await expect(options).toContainText(claims[2]!);

    if (evidence) {
      await page.screenshot({
        path: `${OUT}/kb48-02-dialog-offers-the-rest.png`,
      });
    }

    await options.click();
    await page.locator('[data-test="link-facts-submit"]').click();
    await expect(page.getByText('Linked 1 fact(s) to episode')).toBeVisible();
    await expect(cards(page)).toHaveCount(3);

    await page.reload();
    await page.locator('[data-test="story-sidebar-toggle"]').click();
    await page.locator('[data-test="story-canon-tab"]').click();
    await page.getByRole('tab', { name: /Facts/ }).click();
    await expect(cards(page)).toHaveCount(3);
    await expect(page.getByRole('tab', { name: /Facts/ })).toContainText('3');

    if (evidence) {
      await page.screenshot({ path: `${OUT}/kb48-03-after-reload.png` });
    }

    const first = cards(page).filter({ hasText: claims[0]! });
    await first.hover();
    await first.locator('[data-test="episode-fact-unlink"]').click();
    await expect(page.getByText('Fact unlinked from episode')).toBeVisible();
    await expect(cards(page)).toHaveCount(2);
    await expect(cards(page).filter({ hasText: claims[0]! })).toHaveCount(0);

    expect(await linksOf(episodeId)).toHaveLength(2);

    if (evidence) {
      await page.screenshot({ path: `${OUT}/kb48-04-after-unlink.png` });
    }
  });

  test('a project viewer sees the links and is told no, in words, when they change them', async ({
    page,
  }) => {
    await openFacts(page, viewer);
    await expect(cards(page)).toHaveCount(2);

    const card = cards(page).first();
    await card.hover();
    await card.locator('[data-test="episode-fact-unlink"]').click();
    await expect(page.getByText(UNLINK_REFUSAL)).toBeVisible();
    await expect(cards(page)).toHaveCount(2);

    if (evidence) {
      await page.screenshot({
        path: `${OUT}/kb48-05-viewer-unlink-refused.png`,
      });
    }

    await linkFacts(page, [claims[0]!]);
    await expect(page.getByText(LINK_REFUSAL)).toBeVisible();

    if (evidence) {
      await page.screenshot({ path: `${OUT}/kb48-06-viewer-link-refused.png` });
    }

    expect(await linksOf(episodeId)).toHaveLength(2);
  });
});
