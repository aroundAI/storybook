import { type Page, expect, test } from '@playwright/test';

import {
  insertRow,
  readRows,
  seedProject,
  seedTeamAccount,
  serviceRoleAuth,
  uniqueStamp,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * KB-182: a Generate action outside the stages FILM-1910 wrapped refuses in
 * words when the team has server generation off. Story ideation is one of
 * the eighteen that threw the refusal, which a production build replaces
 * with a generic sentence. Screenshots are written only under
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

const SERVER_OFF =
  'This team has server generation turned off. Ask Claude to write it through the MCP connector, or turn server generation on in Team settings under AI.';

test.describe('Generate when server generation is off (KB-182)', () => {
  test('Generate Ideas is refused in words, twice, and opens no run', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb182-ideation' });
    const project = await seedProject(team);
    const slug = `kb182-${uniqueStamp().slice(0, 8)}`;

    const episode = await insertRow<{ id: string }>(
      'episodes',
      {
        project_id: project.id,
        number: 1,
        title: 'The Lighthouse',
        slug,
        status: 'draft',
      },
      serviceRoleAuth(),
    );

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
      `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/ideation`,
    );

    await byTest(page, 'ideation-premise').fill(
      'A keeper climbs the lighthouse as the storm reaches the harbour.',
    );

    const generate = byTest(page, 'ideation-generate');
    const refusal = page.getByText(SERVER_OFF, { exact: true });

    await generate.click();
    await expect(refusal.first()).toBeVisible();
    await capture(page, 'kb182-ideation-refused');

    // The second press is refused the same way: no run was left holding
    // the stage, so it is not "already being generated"
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect(refusal).toHaveCount(2);
    await capture(page, 'kb182-ideation-refused-twice');

    expect(
      await readRows('generation_runs', `target_id=eq.${episode.id}&select=id`),
    ).toEqual([]);
  });
});
