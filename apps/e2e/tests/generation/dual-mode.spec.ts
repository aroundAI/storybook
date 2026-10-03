import { type Page, expect, test } from '@playwright/test';

import {
  type SeededProject,
  type SeededTeam,
  insertRow,
  readRows,
  seedMembership,
  seedProject,
  seedTeamAccount,
  seedUser,
  serviceRoleAuth,
  uniqueStamp,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-1910: the studio shows when an MCP client holds a stage, and who
 * wrote each piece; a team chooses which AI modes it allows.
 *
 * Fixtures are seeded through the API. An external run is a
 * `generation_runs` row. One ends by being marked expired, the lease
 * cron's write, which the page must notice on its own, over Realtime or by
 * polling if that is down. Another ends through the banner's Cancel, which
 * goes through the run layer. Screenshots are written only under
 * CAPTURE_EVIDENCE=1.
 */
const EVIDENCE = process.env.CAPTURE_EVIDENCE
  ? (process.env.EVIDENCE_DIR ?? 'evidence')
  : null;

async function capture(page: Page, name: string) {
  if (EVIDENCE) {
    await page.screenshot({ path: `${EVIDENCE}/${name}.png`, fullPage: false });
  }
}

const NEW_STORY =
  'Mara climbs the lighthouse as the storm reaches the harbour.';
const OLD_STORY = 'Mara waits on the quay for a boat that never comes.';

/** The story paragraph a reader sees, not React's hidden streamed copy. */
function storyText(page: Page, text: string) {
  return page.getByText(text, { exact: true }).filter({ visible: true });
}

interface Studio {
  team: SeededTeam;
  project: SeededProject;
  episodeId: string;
  base: string;
}

async function seedStudio(prefix: string): Promise<Studio> {
  const team = await seedTeamAccount({ emailPrefix: prefix });
  const project = await seedProject(team);
  const slug = `${prefix}-${uniqueStamp().slice(0, 8)}`;

  const episode = await insertRow<{ id: string }>(
    'episodes',
    {
      project_id: project.id,
      number: 1,
      title: 'The Lighthouse',
      slug,
      status: 'story',
      story_data: { title: 'The Lighthouse', fullStory: NEW_STORY },
      generation_origin: {
        story: {
          kind: 'external',
          clientName: 'claude-ai',
          model: 'claude-opus-5-5',
          at: '2026-10-03T12:00:00.000Z',
        },
      },
    },
    serviceRoleAuth(),
  );

  return {
    team,
    project,
    episodeId: episode.id,
    base: `/home/${team.slug}/studio/${project.slug}/episodes/${slug}`,
  };
}

async function seedExternalRun(studio: Studio, stage = 'story') {
  return insertRow<{ id: string }>(
    'generation_runs',
    {
      account_id: studio.team.accountId,
      project_id: studio.project.id,
      target_type: 'episode',
      target_id: studio.episodeId,
      stage,
      mode: 'external',
      status: 'in_progress',
      lease_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      origin: {
        kind: 'external',
        clientName: 'claude-ai',
        model: 'claude-opus-5-5',
      },
      created_by: studio.team.userId,
    },
    serviceRoleAuth(),
  );
}

test.describe('Dual-mode studio (FILM-1910)', () => {
  test('an open external run shows the banner and pauses Generate, until it ends', async ({
    page,
  }) => {
    const studio = await seedStudio('film1910-run');
    const run = await seedExternalRun(studio);

    await signInAs(page, studio.team);
    await page.goto(`${studio.base}/story`);

    const banner = byTest(page, 'external-run-banner');
    const convert = byTest(page, 'convert-to-screenplay');

    await expect(banner).toContainText('Claude is working on this');
    await expect(banner).toContainText('Writing the story from claude-ai');
    await expect(convert).toBeDisabled();
    await capture(page, '01-story-banner-generate-disabled');

    // The run ends (the lease cron's write); nothing reloads the page
    await updateRows('generation_runs', `id=eq.${run.id}`, {
      status: 'expired',
      finalized_at: new Date().toISOString(),
    });

    await expect(banner).toHaveCount(0, { timeout: 20_000 });
    await expect(convert).toBeEnabled();
    await capture(page, '02-story-after-run-ends');

    // A second run on the same stage brings the banner back
    const second = await seedExternalRun(studio);

    await expect(banner).toContainText('Claude is working on this', {
      timeout: 20_000,
    });
    await expect(convert).toBeDisabled();
    await capture(page, '03-story-second-run-cancel');

    // Cancel from the banner ends it through the run layer
    await byTest(banner, 'external-run-cancel').click();

    await expect(banner).toHaveCount(0, { timeout: 20_000 });
    await expect(convert).toBeEnabled();
    await expect
      .poll(async () => {
        const [row] = await readRows<{ status: string }>(
          'generation_runs',
          `id=eq.${second.id}&select=status`,
        );
        return row?.status;
      })
      .toBe('cancelled');
    await capture(page, '04-story-after-cancel');
  });

  test('a member who cannot write the project is refused Cancel', async ({
    page,
  }) => {
    const studio = await seedStudio('film1910-cancel-member');
    const run = await seedExternalRun(studio);
    const member = await seedUser('film1910-cancel-member');
    await seedMembership(member.userId, studio.team.accountId, 'member');

    await signInAs(page, member);
    await page.goto(`${studio.base}/story`);

    const banner = byTest(page, 'external-run-banner');
    await byTest(banner, 'external-run-cancel').click();

    await expect(
      page.getByText(
        'You need write access to this project to cancel the run.',
      ),
    ).toBeVisible();
    await expect(banner).toContainText('Claude is working on this');

    const [row] = await readRows<{ status: string }>(
      'generation_runs',
      `id=eq.${run.id}&select=status`,
    );
    expect(row?.status).toBe('in_progress');
  });

  test('a run on the stage Generate would start also pauses it', async ({
    page,
  }) => {
    const studio = await seedStudio('film1910-next');
    await seedExternalRun(studio, 'screenplay');

    await signInAs(page, studio.team);
    await page.goto(`${studio.base}/story`);

    await expect(byTest(page, 'external-run-banner')).toContainText(
      'Writing the screenplay',
    );
    await expect(byTest(page, 'convert-to-screenplay')).toBeDisabled();
  });

  test('a lease that has lapsed shows no banner', async ({ page }) => {
    const studio = await seedStudio('film1910-lapsed');
    const run = await seedExternalRun(studio);
    await updateRows('generation_runs', `id=eq.${run.id}`, {
      lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
    });

    await signInAs(page, studio.team);
    await page.goto(`${studio.base}/story`);

    await expect(byTest(page, 'convert-to-screenplay')).toBeEnabled();
    await expect(byTest(page, 'external-run-banner')).toHaveCount(0);
  });

  test('origin badges name who wrote the story, each shot and each line', async ({
    page,
  }) => {
    const studio = await seedStudio('film1910-badge');

    await updateRows('episodes', `id=eq.${studio.episodeId}`, {
      screenplay_data: {
        scenes: [
          {
            sceneNumber: 1,
            heading: 'INT. LIGHTHOUSE - NIGHT',
            dialogue: [{ character: 'Mara', line: 'Light the lamp.' }],
          },
        ],
      },
    });
    await insertRow(
      'shots',
      {
        episode_id: studio.episodeId,
        sequence_number: 1,
        scene_number: 1,
        shot_number: 1,
        prompt: 'Mara on the stairs',
        generation_origin: {
          kind: 'server',
          model: 'gemini-3.5-flash',
          at: '2026-10-03T12:00:00.000Z',
        },
      },
      serviceRoleAuth(),
    );
    await insertRow(
      'shots',
      {
        episode_id: studio.episodeId,
        sequence_number: 2,
        scene_number: 1,
        shot_number: 2,
        prompt: 'The lamp turns',
      },
      serviceRoleAuth(),
    );
    await insertRow(
      'dialogue_lines',
      {
        episode_id: studio.episodeId,
        sequence_number: 1,
        text: 'Light the lamp.',
        generation_origin: {
          kind: 'external',
          clientName: 'claude-ai',
          model: 'claude-opus-5-5',
          at: '2026-10-03T12:00:00.000Z',
        },
      },
      serviceRoleAuth(),
    );

    await signInAs(page, studio.team);

    await page.goto(`${studio.base}/story`);
    const storyBadge = byTest(byTest(page, 'stage-run-bar'), 'origin-badge');
    await expect(storyBadge).toContainText('Claude via MCP');
    await expect(storyBadge).toContainText('reported: claude-opus-5-5');
    await expect(storyBadge).toHaveAttribute('data-origin-kind', 'external');
    await capture(page, '05-story-origin-badge');

    await page.goto(`${studio.base}/visual-studio`);
    const shotCards = byTest(page, 'shot-card');
    await expect(shotCards).toHaveCount(2);
    await expect(byTest(shotCards.nth(0), 'origin-badge')).toContainText(
      'Gemini',
    );
    await expect(byTest(shotCards.nth(0), 'origin-badge')).toHaveAttribute(
      'data-origin-kind',
      'server',
    );
    // A shot written before FILM-1903 has no origin, and no badge
    await expect(byTest(shotCards.nth(1), 'origin-badge')).toHaveCount(0);
    await capture(page, '06-shot-origin-badges');

    await page.goto(`${studio.base}/audio-studio`);
    const line = byTest(page, 'dialogue-block-0');
    await expect(byTest(line, 'origin-badge')).toHaveAttribute(
      'data-origin-kind',
      'external',
    );
    await expect(byTest(line, 'origin-badge')).toContainText('Claude via MCP');
    await capture(page, '07-dialogue-origin-badge');
  });

  test('restore puts the previous story back, and restoring again undoes it', async ({
    page,
  }) => {
    const studio = await seedStudio('film1910-restore');
    await insertRow(
      'content_revisions',
      {
        account_id: studio.team.accountId,
        target_type: 'episode',
        target_id: studio.episodeId,
        stage: 'story',
        snapshot: {
          episode: {
            story_data: { title: 'The Quay', fullStory: OLD_STORY },
          },
        },
      },
      serviceRoleAuth(),
    );

    await signInAs(page, studio.team);
    await page.goto(`${studio.base}/story`);
    await expect(storyText(page, NEW_STORY)).toBeVisible();

    await byTest(page, 'restore-previous-version').click();
    await capture(page, '08-restore-confirm');
    await byTest(page, 'restore-previous-version-confirm').click();

    await expect(storyText(page, OLD_STORY)).toBeVisible();
    await expect(storyText(page, NEW_STORY)).toHaveCount(0);
    await capture(page, '09-story-restored');

    const [stored] = await readRows<{ story_data: { fullStory: string } }>(
      'episodes',
      `id=eq.${studio.episodeId}&select=story_data`,
    );
    expect(stored?.story_data.fullStory).toBe(OLD_STORY);

    // The restore saved what it replaced; a second restore brings it back
    await byTest(page, 'restore-previous-version').click();
    await byTest(page, 'restore-previous-version-confirm').click();

    await expect(storyText(page, NEW_STORY)).toBeVisible();
    await expect(storyText(page, OLD_STORY)).toHaveCount(0);
  });

  test('restore is paused while an external run holds the stage', async ({
    page,
  }) => {
    const studio = await seedStudio('film1910-restore-run');
    await insertRow(
      'content_revisions',
      {
        account_id: studio.team.accountId,
        target_type: 'episode',
        target_id: studio.episodeId,
        stage: 'story',
        snapshot: { episode: { story_data: { fullStory: OLD_STORY } } },
      },
      serviceRoleAuth(),
    );
    await seedExternalRun(studio);

    await signInAs(page, studio.team);
    await page.goto(`${studio.base}/story`);

    await expect(byTest(page, 'restore-previous-version')).toBeDisabled();
  });
});

test.describe('Team settings → AI (FILM-1910)', () => {
  async function readSettings(accountId: string) {
    const [row] = await readRows<{
      server_generation_enabled: boolean;
      external_generation_enabled: boolean;
      default_mode: string;
    }>(
      'account_ai_settings',
      `account_id=eq.${accountId}&select=server_generation_enabled,external_generation_enabled,default_mode`,
    );
    return row ?? null;
  }

  test('an owner saves the modes, twice, and cannot turn both off', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'film1910-owner' });
    const url = `/home/${team.slug}/settings/ai`;

    await signInAs(page, team);
    await page.goto(url);

    const server = byTest(page, 'ai-settings-server');
    const external = byTest(page, 'ai-settings-external');
    const save = byTest(page, 'ai-settings-save');

    // A team with no row shows the defaults
    await expect(server).toHaveAttribute('aria-checked', 'true');
    await expect(external).toHaveAttribute('aria-checked', 'true');
    await expect(byTest(page, 'ai-settings-default-server')).toBeChecked();
    await capture(page, '10-ai-settings-defaults');

    // First save: Gemini only. The toggle moving proves the form hydrated.
    await external.click();
    await expect(external).toHaveAttribute('aria-checked', 'false');
    await save.click();
    await expect(page.getByText('AI settings saved')).toBeVisible();
    await expect
      .poll(() => readSettings(team.accountId))
      .toEqual({
        server_generation_enabled: true,
        external_generation_enabled: false,
        default_mode: 'server',
      });

    await page.reload();
    await expect(server).toHaveAttribute('aria-checked', 'true');
    await expect(external).toHaveAttribute('aria-checked', 'false');
    await capture(page, '11-ai-settings-after-save');

    // Second save: Claude only; turning server off moves the default
    await external.click();
    await server.click();
    await expect(byTest(page, 'ai-settings-default-external')).toBeChecked();
    await save.click();
    await expect
      .poll(() => readSettings(team.accountId))
      .toEqual({
        server_generation_enabled: false,
        external_generation_enabled: true,
        default_mode: 'external',
      });

    await page.reload();
    await expect(server).toHaveAttribute('aria-checked', 'false');
    await expect(external).toHaveAttribute('aria-checked', 'true');
    await expect(byTest(page, 'ai-settings-default-external')).toBeChecked();

    // Both off is refused, and nothing is written
    await external.click();
    await save.click();
    await expect(byTest(page, 'ai-settings-external-error')).toHaveText(
      'Keep at least one way to generate. Allow server generation, external generation, or both.',
    );
    await capture(page, '12-ai-settings-both-off-refused');

    await page.reload();
    await expect(external).toHaveAttribute('aria-checked', 'true');
    expect(await readSettings(team.accountId)).toEqual({
      server_generation_enabled: false,
      external_generation_enabled: true,
      default_mode: 'external',
    });
  });

  test('a member sees the settings read-only', async ({ page }) => {
    const team = await seedTeamAccount({ emailPrefix: 'film1910-team' });
    const member = await seedUser('film1910-member');
    await seedMembership(member.userId, team.accountId, 'member');

    await signInAs(page, member);
    await page.goto(`/home/${team.slug}/settings/ai`);

    await expect(byTest(page, 'ai-settings-read-only')).toBeVisible();
    await expect(byTest(page, 'ai-settings-server')).toBeDisabled();
    await expect(byTest(page, 'ai-settings-external')).toBeDisabled();
    await expect(byTest(page, 'ai-settings-default-server')).toBeDisabled();
    await expect(byTest(page, 'ai-settings-save')).toHaveCount(0);
    await capture(page, '13-ai-settings-member-read-only');
  });
});
