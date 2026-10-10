import { type Locator, type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import {
  type SeededTeam,
  addProjectChannels,
  episodeVideoUrl,
  readRows,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  seedYouTubeConnection,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest, visible } from '../utils/visible';

/**
 * A short is cut differently for YouTube, Instagram and Facebook, so each
 * Shorts group names the platforms its cut goes to (owner, 2026-10-10).
 * Every group's video in a language went to every Shorts channel in that
 * language; a group now goes only to the platforms ticked on it, and one
 * with none ticked goes to all of them, as before.
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
  await page.screenshot({ path: `${OUT}/shorts-platforms-${name}.png` });
}

async function channel(team: SeededTeam, name: string, platform: string) {
  const id = await seedYouTubeConnection(team.accountId, name, {
    platform,
    platformAccountId: `${platform}-sp-${name.replace(/\W/g, '')}-${team.accountId.slice(0, 8)}`,
  });
  await updateRows('platform_connections', `id=eq.${id}`, { language: 'en' });
  return id;
}

function group(page: Page, id: string) {
  return visible(page, `[data-test="shorts-group"][data-group-id="${id}"]`);
}

function chip(groupCard: Locator, platform: string) {
  return visible(
    groupCard,
    `[data-test="shorts-group-platform"][data-platform="${platform}"]`,
  );
}

/** The channel ids the group's "Receives" line names */
function receivers(groupCard: Locator) {
  return byTest(groupCard, 'shorts-group-target');
}

async function receiverIds(groupCard: Locator) {
  return (
    await receivers(groupCard).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-channel-id')),
    )
  ).sort();
}

async function savedPlatforms(episodeId: string) {
  const [row] = await readRows<{
    shorts_groups: Array<{ id: string; platforms?: string[] }>;
  }>('episodes', `id=eq.${episodeId}&select=shorts_groups`);

  return Object.fromEntries(
    (row?.shorts_groups ?? []).map((g) => [
      g.id,
      [...(g.platforms ?? [])].sort(),
    ]),
  );
}

test.describe('Each Shorts group goes only to the platforms chosen for it', () => {
  test('ticked on the Publish screen, changed again, kept after a reload', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'shortsplat' });
    const yt = await channel(team, 'Story YT EN', 'youtube');
    const ig = await channel(team, 'Story IG EN', 'instagram');
    const fb = await channel(team, 'Story FB EN', 'facebook');

    const project = await seedProject(team, { name: 'Shorts platforms' });
    await addProjectChannels(project.id, [yt, ig, fb]);
    const { episodeId, slug } = await seedEpisodeWithShot(project.id);

    await updateRows('episodes', `id=eq.${episodeId}`, {
      // The master video, which goes everywhere in its language
      localized_videos: { en: episodeVideoUrl(episodeId, 'en') },
      shorts_groups: [
        {
          id: 'yt-cut',
          name: 'YT cut',
          title: '',
          description: '',
          tags: [],
          videos: { en: episodeVideoUrl(episodeId, 'en') },
        },
        {
          id: 'ig-cut',
          name: 'IG cut',
          title: '',
          description: '',
          tags: [],
          videos: { en: episodeVideoUrl(episodeId, 'en') },
        },
      ],
    });

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/publish`,
    );

    const ytCut = group(page, 'yt-cut');
    const igCut = group(page, 'ig-cut');
    await expect(ytCut).toBeVisible({ timeout: 60_000 });

    // --- Nothing ticked: every Shorts channel receives each group, as before.
    await expect(receivers(ytCut)).toHaveCount(3);
    expect(await receiverIds(ytCut)).toEqual([yt, ig, fb].sort());
    await ytCut.scrollIntoViewIfNeeded();
    await capture(page, '01-before');

    // --- The YouTube cut to YouTube; the Instagram cut to Instagram and Facebook.
    await chip(ytCut, 'youtube').click();
    await chip(igCut, 'instagram').click();
    await chip(igCut, 'facebook').click();

    await expect(chip(ytCut, 'youtube')).toHaveAttribute('data-state', 'on');
    expect(await receiverIds(ytCut)).toEqual([yt]);
    await expect(receivers(igCut)).toHaveCount(2);
    expect(await receiverIds(igCut)).toEqual([ig, fb].sort());
    await expect
      .poll(() => savedPlatforms(episodeId))
      .toEqual({ 'yt-cut': ['youtube'], 'ig-cut': ['facebook', 'instagram'] });
    await capture(page, '02-each-cut-to-its-platforms');

    // --- The second save: the YouTube cut moves to Instagram.
    await chip(ytCut, 'youtube').click();
    await chip(ytCut, 'instagram').click();

    await expect(chip(ytCut, 'youtube')).toHaveAttribute('data-state', 'off');
    await expect(receivers(ytCut)).toHaveCount(1);
    expect(await receiverIds(ytCut)).toEqual([ig]);
    await expect
      .poll(() => savedPlatforms(episodeId))
      .toEqual({
        'yt-cut': ['instagram'],
        'ig-cut': ['facebook', 'instagram'],
      });

    // --- A platform with no channel of the project says so.
    await chip(ytCut, 'tiktok').click();
    await expect(ytCut).toContainText(
      'No TikTok channel in this project takes English.',
    );
    await capture(page, '03-after-second-save');

    // --- Kept: a reload shows what was saved.
    await page.reload();
    await expect(group(page, 'yt-cut')).toBeVisible({ timeout: 60_000 });
    await expect(chip(group(page, 'yt-cut'), 'instagram')).toHaveAttribute(
      'data-state',
      'on',
    );
    await expect(chip(group(page, 'yt-cut'), 'tiktok')).toHaveAttribute(
      'data-state',
      'on',
    );
    await expect(chip(group(page, 'yt-cut'), 'youtube')).toHaveAttribute(
      'data-state',
      'off',
    );
    await expect(receivers(group(page, 'ig-cut'))).toHaveCount(2);
    expect(await receiverIds(group(page, 'ig-cut'))).toEqual([ig, fb].sort());
  });
});
