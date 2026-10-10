import { type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import {
  type SeededTeam,
  episodeVideoUrl,
  readRows,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  seedYouTubeConnection,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * KB-195. The Publish screen listed every channel connected to the team, and
 * Publish Now and Schedule sent each video to every one of them in its
 * language: a team with ten YouTube channels across four projects could not
 * keep one project's episodes off another project's channels.
 *
 * An episode now publishes only to its project's channels, chosen on the
 * Publish screen (or in the project's settings). A project with none
 * publishes nowhere. Each channel still receives its own language version.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== 'running'),
  );
  await page.screenshot({ path: `${OUT}/kb-195-${name}.png` });
}

async function channel(team: SeededTeam, name: string, language: string) {
  const id = await seedYouTubeConnection(team.accountId, name, {
    platformAccountId: `UC-kb195-${name.replace(/\W/g, '')}-${team.accountId.slice(0, 8)}`,
  });
  await updateRows('platform_connections', `id=eq.${id}`, { language });
  return id;
}

async function publishScreen(team: SeededTeam, name: string) {
  const project = await seedProject(team, { name });
  const { episodeId, slug } = await seedEpisodeWithShot(project.id);

  await updateRows('episodes', `id=eq.${episodeId}`, {
    localized_videos: {
      en: episodeVideoUrl(episodeId, 'en'),
      hi: episodeVideoUrl(episodeId, 'hi'),
    },
  });

  return {
    project,
    url: `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/publish`,
  };
}

/** The channel names the sidebar lists under one language */
function sidebarChannels(page: Page, language: string) {
  return page.locator(
    `[data-test="project-channels-language"][data-lang="${language}"] [data-test="channel-badge"]`,
  );
}

async function chooseChannels(page: Page, ids: Record<string, boolean>) {
  await byTest(page, 'choose-project-channels').first().click();

  const picker = byTest(page, 'project-channel-picker');
  await expect(picker).toBeVisible();

  for (const [id, wanted] of Object.entries(ids)) {
    const box = picker.locator(
      `[data-test="project-channel-checkbox"][data-channel-id="${id}"]`,
    );
    if (
      (await box.getAttribute('data-state')) !==
      (wanted ? 'checked' : 'unchecked')
    ) {
      await box.click();
    }
    await expect(box).toHaveAttribute(
      'data-state',
      wanted ? 'checked' : 'unchecked',
    );
  }

  return picker;
}

test.describe("An episode publishes only to its project's channels (KB-195)", () => {
  test('none until chosen; chosen on the Publish screen; changed again', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb195' });
    const enOne = await channel(team, 'Story EN One', 'en');
    const enTwo = await channel(team, 'Story EN Two', 'en');
    const hiOne = await channel(team, 'Story HI One', 'hi');
    const hiTwo = await channel(team, 'Story HI Two', 'hi');

    const a = await publishScreen(team, 'Project A');
    const b = await publishScreen(team, 'Project B');

    await signInAs(page, team);

    // --- A project with no channels publishes nowhere.
    await page.goto(a.url);
    await expect(byTest(page, 'project-channels-empty')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-test="channel-badge"]')).toHaveCount(0);
    await byTest(page, 'project-channels-empty').scrollIntoViewIfNeeded();
    await capture(page, '01-no-channels');

    // --- Choose one English and one Hindi channel.
    const picker = await chooseChannels(page, {
      [enOne]: true,
      [hiOne]: true,
    });
    await expect(picker).toContainText('4 channels');
    await capture(page, '02-picker');
    await byTest(picker, 'project-channels-save').click();
    await expect(picker).toBeHidden();

    await expect(sidebarChannels(page, 'en')).toHaveText([/Story EN One$/]);
    await expect(sidebarChannels(page, 'hi')).toHaveText([/Story HI One$/]);
    await expect(page.getByText('Story EN Two')).toHaveCount(0);
    await expect(page.getByText('Story HI Two')).toHaveCount(0);
    await sidebarChannels(page, 'en').scrollIntoViewIfNeeded();
    await capture(page, '03-after-first-save');

    // --- The second save: the picker opens on what was saved, and a change
    //     to it is what the screen shows next.
    const again = await chooseChannels(page, {
      [enOne]: false,
      [enTwo]: true,
      [hiOne]: true,
      [hiTwo]: false,
    });
    await byTest(again, 'project-channels-save').click();
    await expect(again).toBeHidden();

    await expect(sidebarChannels(page, 'en')).toHaveText([/Story EN Two$/]);
    await expect(sidebarChannels(page, 'hi')).toHaveText([/Story HI One$/]);
    await sidebarChannels(page, 'en').scrollIntoViewIfNeeded();
    await capture(page, '04-after-second-save');

    // --- Kept: a reload reads the same two from the database.
    await page.reload();
    await expect(sidebarChannels(page, 'en')).toHaveText([/Story EN Two$/], {
      timeout: 60_000,
    });
    await expect(sidebarChannels(page, 'hi')).toHaveText([/Story HI One$/]);

    const rows = await readRows<{ platform_connection_id: string }>(
      'project_publishing_configs',
      `project_id=eq.${a.project.id}&select=platform_connection_id`,
    );
    expect(rows.map((row) => row.platform_connection_id).sort()).toEqual(
      [enTwo, hiOne].sort(),
    );

    // --- Another project's choice is its own.
    await page.goto(b.url);
    await expect(byTest(page, 'project-channels-empty')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-test="channel-badge"]')).toHaveCount(0);
  });
});
