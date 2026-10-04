import { type Page, expect, test } from '@playwright/test';

import {
  insertRow,
  seedEpisodeWorkspace,
  seedProject,
  seedTeamAccount,
  serviceRoleAuth,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * KB-182: canon extraction falls back to a basic summary when no model runs,
 * as it always did, and now also says why. With server generation off the
 * refusal was swallowed and the page looked like a model had written it.
 * Screenshots are written only under CAPTURE_EVIDENCE=1.
 */
const EVIDENCE = process.env.CAPTURE_EVIDENCE
  ? (process.env.EVIDENCE_DIR ?? 'evidence')
  : null;

async function capture(page: Page, name: string) {
  if (EVIDENCE) {
    await page.screenshot({ path: `${EVIDENCE}/${name}.png`, fullPage: false });
  }
}

const SERVER_OFF =
  'This team has server generation turned off. Ask Claude to write it through the MCP connector, or turn server generation on in Team settings under AI.';

const STORY =
  'Ava climbs the lighthouse stairs as the storm reaches the harbour. At the top she finds the lamp dark and the keeper gone, and a letter addressed to her.';

test.describe('Canon extraction when server generation is off (KB-182)', () => {
  test('the basic summary says why no model wrote it, twice', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb182-canon' });
    const project = await seedProject(team);
    // Publish opens once the episode has a shot
    const episode = await seedEpisodeWorkspace(project.id);
    await updateRows('episodes', `id=eq.${episode.episodeId}`, {
      story_data: { title: 'The Lighthouse', fullStory: STORY },
    });

    await insertRow(
      'account_ai_settings',
      {
        account_id: team.accountId,
        server_generation_enabled: false,
        external_generation_enabled: true,
        default_mode: 'external',
      },
      serviceRoleAuth(),
    );

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${episode.slug}/publish`,
    );

    const refusal = byTest(page, 'canon-refusal');
    const analyze = byTest(page, 'canon-analyze');
    const summary = byTest(page, 'canon-episode-summary');

    // The page analyses on load
    await expect(refusal).toHaveText(SERVER_OFF);
    await expect(summary).toHaveValue(/Ava climbs the lighthouse/);
    await capture(page, 'kb182-canon-refused');

    // The second press is refused the same way, and the fallback still shows
    await expect(analyze).toBeEnabled();
    await analyze.click();
    await expect(page.getByText(SERVER_OFF, { exact: true })).toHaveCount(3);
    await expect(refusal).toHaveText(SERVER_OFF);
    await expect(summary).toHaveValue(/Ava climbs the lighthouse/);
    await capture(page, 'kb182-canon-refused-twice');
  });
});
