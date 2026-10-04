import { type Page, expect, test } from '@playwright/test';

import {
  type SeededTeam,
  insertRow,
  readRows,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  serviceRoleAuth,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-2005: "Open in Studio". An owner turns StorybookStudio on in the
 * team's AI settings; the episode header and Visual Studio then show the
 * button on an episode in storyboard, generating, ready or published. A
 * click hands `velorn://open?api=<origin>&episode=<id>` to the browser,
 * and with no app to answer (as here), the download sheet opens after 2 s.
 *
 * Screenshots: CAPTURE_EVIDENCE=1 EVIDENCE_DIR=<dir>.
 */
const EVIDENCE = process.env.CAPTURE_EVIDENCE
  ? (process.env.EVIDENCE_DIR ?? 'evidence')
  : null;

async function capture(page: Page, name: string) {
  if (EVIDENCE) {
    await page.screenshot({ path: `${EVIDENCE}/${name}.png`, fullPage: false });
  }
}

async function readDesktopSetting(accountId: string) {
  const [row] = await readRows<{ desktop_integration_enabled: boolean }>(
    'account_ai_settings',
    `account_id=eq.${accountId}&select=desktop_integration_enabled`,
  );

  return row?.desktop_integration_enabled ?? null;
}

/** Seeded through the API: the toggle has its own test above. */
async function turnStudioOn(accountId: string) {
  await insertRow(
    'account_ai_settings',
    { account_id: accountId, desktop_integration_enabled: true },
    serviceRoleAuth(),
  );
}

async function seedReadyEpisode(team: SeededTeam) {
  const project = await seedProject(team);
  const episode = await seedEpisodeWithShot(project.id);

  await updateRows('episodes', `id=eq.${episode.episodeId}`, {
    status: 'ready',
  });

  return {
    episodeId: episode.episodeId,
    url: `/home/${team.slug}/studio/${project.slug}/episodes/${episode.slug}`,
  };
}

test.describe('Open in Studio (FILM-2005)', () => {
  test('an owner turns the Studio on and off in AI settings, and the button follows', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'studio-flag' });
    const episode = await seedReadyEpisode(team);

    await signInAs(page, team);

    // Off by default: no settings row, and no button
    await page.goto(`${episode.url}/story`);
    await expect(byTest(page, 'episode-back-link')).toBeVisible();
    await expect(byTest(page, 'open-in-studio-button')).toHaveCount(0);
    await capture(page, '01-episode-header-studio-off');

    await page.goto(`/home/${team.slug}/settings/ai`);
    const toggle = byTest(page, 'ai-settings-desktop-integration');
    const save = byTest(page, 'ai-settings-save');

    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(await readDesktopSetting(team.accountId)).toBeNull();

    // First save: on
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await save.click();
    await expect(page.getByText('AI settings saved')).toBeVisible();
    await expect.poll(() => readDesktopSetting(team.accountId)).toBe(true);

    await page.reload();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await capture(page, '02-ai-settings-studio-on');

    await page.goto(`${episode.url}/story`);
    await expect(byTest(page, 'open-in-studio-button')).toBeVisible();
    await capture(page, '03-episode-header-studio-on');

    // Second save: off again, and the button is gone
    await page.goto(`/home/${team.slug}/settings/ai`);
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await save.click();
    await expect.poll(() => readDesktopSetting(team.accountId)).toBe(false);

    await page.goto(`${episode.url}/story`);
    await expect(byTest(page, 'episode-back-link')).toBeVisible();
    await expect(byTest(page, 'open-in-studio-button')).toHaveCount(0);
  });

  test('a click with no app to answer opens the download sheet; the link carries no token', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'studio-open' });
    const episode = await seedReadyEpisode(team);

    await turnStudioOn(team.accountId);

    await signInAs(page, team);
    await page.goto(`${episode.url}/visual-studio`);

    // Visual Studio shows it next to the export, and the header shows it
    const buttons = byTest(page, 'open-in-studio-button');
    await expect(buttons).toHaveCount(2);

    const pageUrl = page.url();
    await buttons.first().click();

    // The page stays here: an unknown scheme is not a navigation away
    const sheet = byTest(page, 'studio-download-sheet');
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    expect(page.url()).toBe(pageUrl);

    const link = await buttons.first().getAttribute('data-deep-link');
    const origin = new URL(pageUrl).origin;
    expect(link).toBe(
      `velorn://open?api=${encodeURIComponent(origin)}&episode=${episode.episodeId}`,
    );
    expect(link).not.toMatch(/sbk_|token|session|sb-/i);

    await expect(byTest(page, 'studio-download-macos')).toHaveAttribute(
      'href',
      /^https:\/\//,
    );
    await expect(byTest(page, 'studio-download-windows')).toHaveAttribute(
      'href',
      /^https:\/\//,
    );
    await expect(byTest(page, 'studio-download-learn-more')).toHaveAttribute(
      'href',
      /^https:\/\//,
    );
    await expect(byTest(page, 'studio-download-token')).toHaveAttribute(
      'href',
      `/home/${team.slug}/settings/connected-apps`,
    );
    await capture(page, '04-studio-download-sheet');

    // Closed and clicked again: the second attempt behaves as the first
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await buttons.first().click();
    await expect(byTest(page, 'studio-download-sheet')).toBeVisible({
      timeout: 10_000,
    });

    // The token alternative leads to Connected apps
    await byTest(page, 'studio-download-token').click();
    await page.waitForURL(`**/home/${team.slug}/settings/connected-apps`);
  });

  test('an episode still in draft does not offer it, even with the Studio on', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'studio-draft' });
    const project = await seedProject(team);
    const episode = await seedEpisodeWithShot(project.id);

    await turnStudioOn(team.accountId);

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${episode.slug}/story`,
    );
    await expect(byTest(page, 'episode-back-link')).toBeVisible();
    await expect(byTest(page, 'open-in-studio-button')).toHaveCount(0);
  });
});
