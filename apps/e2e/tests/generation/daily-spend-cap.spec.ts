import { type Page, expect, test } from '@playwright/test';

import {
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
 * A team's daily cap on Gemini spend through the web app (owner decision
 * 2026-10-03, under FILM-1910 and FILM-1902). Owners set it under Team
 * settings → AI, members read it; past it, Generate is refused in words
 * before a run exists. MCP work and renders are never capped (unit tests
 * in packages/ai-gateway/__tests__/daily-spend-cap.test.ts).
 *
 * Today's spend is seeded as llm_usage_analytics rows of a server run,
 * written while the run is open (the run lock refuses them otherwise),
 * then the run is committed. Screenshots only under CAPTURE_EVIDENCE=1.
 */
const EVIDENCE = process.env.CAPTURE_EVIDENCE
  ? (process.env.EVIDENCE_DIR ?? 'evidence')
  : null;

async function capture(page: Page, name: string) {
  if (EVIDENCE) {
    await page.screenshot({ path: `${EVIDENCE}/${name}.png`, fullPage: false });
  }
}

async function readCap(accountId: string) {
  const [row] = await readRows<{ daily_llm_spend_cap_usd: number | null }>(
    'account_ai_settings',
    `account_id=eq.${accountId}&select=daily_llm_spend_cap_usd`,
  );
  return row ? row.daily_llm_spend_cap_usd : undefined;
}

test.describe('Team settings → AI: the daily spend cap', () => {
  test('an owner sets the cap, changes it, refuses zero, and clears it', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'spendcap-owner' });

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/settings/ai`);

    const cap = byTest(page, 'ai-settings-spend-cap');
    const save = byTest(page, 'ai-settings-save');

    await expect(cap).toHaveValue('');
    await expect(byTest(page, 'ai-settings-spend-cap-scope')).toContainText(
      'never capped',
    );

    // First save; a pasted amount with a thousands separator keeps its value
    await cap.fill('1,250.00');
    await save.click();
    await expect(page.getByText('AI settings saved')).toBeVisible();
    await expect.poll(() => readCap(team.accountId)).toBe(1250);

    await page.reload();
    await expect(cap).toHaveValue('1250.00');
    await cap.scrollIntoViewIfNeeded();
    await capture(page, 'spend-cap-01-saved');

    // Second save: the field and the row move together
    await cap.fill('5');
    await save.click();
    await expect.poll(() => readCap(team.accountId)).toBe(5);
    await expect(cap).toHaveValue('5.00');

    // Zero is refused under the field, and nothing is written
    await cap.fill('0');
    await save.click();
    await expect(byTest(page, 'ai-settings-spend-cap-error')).toHaveText(
      'A daily spend cap is an amount in US dollars above $0, such as 5 or 12.50. Leave it empty for no cap.',
    );
    await cap.scrollIntoViewIfNeeded();
    await capture(page, 'spend-cap-02-zero-refused');
    expect(await readCap(team.accountId)).toBe(5);

    // Empty is no cap
    await cap.fill('');
    await save.click();
    await expect.poll(() => readCap(team.accountId)).toBeNull();
    await page.reload();
    await expect(cap).toHaveValue('');
  });

  test('a member sees the cap read-only', async ({ page }) => {
    const team = await seedTeamAccount({ emailPrefix: 'spendcap-team' });
    await insertRow(
      'account_ai_settings',
      { account_id: team.accountId, daily_llm_spend_cap_usd: 12.5 },
      serviceRoleAuth(),
    );
    const member = await seedUser('spendcap-member');
    await seedMembership(member.userId, team.accountId, 'member');

    await signInAs(page, member);
    await page.goto(`/home/${team.slug}/settings/ai`);

    const cap = byTest(page, 'ai-settings-spend-cap');
    await expect(byTest(page, 'ai-settings-read-only')).toBeVisible();
    await expect(cap).toHaveValue('12.50');
    await expect(cap).toBeDisabled();
    await expect(byTest(page, 'ai-settings-save')).toHaveCount(0);
    await cap.scrollIntoViewIfNeeded();
    await capture(page, 'spend-cap-03-member-read-only');
  });
});

test.describe('Generate past the daily spend cap', () => {
  // With no model key the server refuses every server run with
  // LLM_NOT_CONFIGURED (FILM-1911) before it reads the cap, as it should;
  // CI's E2E servers carry GEMINI_API_KEY=e2e-not-a-real-key and the flag
  // below; locally, start the server with both. The refusal comes before
  // any call, so the fake key is never sent anywhere.
  test.skip(
    !process.env.E2E_SERVER_HAS_MODEL_KEY,
    'needs a server started with a model key: set E2E_SERVER_HAS_MODEL_KEY=1',
  );

  test('Convert to Screenplay is refused with the cap, twice, and opens no run', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'spendcap-generate' });
    const project = await seedProject(team);
    const slug = `spendcap-${uniqueStamp().slice(0, 8)}`;
    const episode = await insertRow<{ id: string }>(
      'episodes',
      {
        project_id: project.id,
        number: 1,
        title: 'The Lighthouse',
        slug,
        status: 'story',
        story_data: {
          title: 'The Lighthouse',
          fullStory: 'Mara climbs the lighthouse as the storm arrives.',
        },
      },
      serviceRoleAuth(),
    );

    await insertRow(
      'account_ai_settings',
      { account_id: team.accountId, daily_llm_spend_cap_usd: 1 },
      serviceRoleAuth(),
    );

    // Today's spend: $1.50 priced, one embedding of unknown cost
    const run = await insertRow<{ id: string }>(
      'generation_runs',
      {
        account_id: team.accountId,
        project_id: project.id,
        target_type: 'episode',
        target_id: episode.id,
        stage: 'story',
        mode: 'server',
        status: 'in_progress',
        created_by: team.userId,
      },
      serviceRoleAuth(),
    );
    for (const row of [
      { llm_provider: 'gemini', llm_model: 'gemini-2.5-pro', total_cost: 1.5 },
      { llm_provider: 'voyage', llm_model: 'voyage-3-large', total_cost: null },
    ]) {
      await insertRow(
        'llm_usage_analytics',
        {
          ...row,
          account_id: team.accountId,
          status: 'success',
          run_id: run.id,
        },
        serviceRoleAuth(),
      );
    }
    await updateRows('generation_runs', `id=eq.${run.id}`, {
      status: 'committed',
      finalized_at: new Date().toISOString(),
    });

    const resetDay = new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate() + 1,
      ),
    )
      .toISOString()
      .slice(0, 10);
    const refusalText = `This team has reached its daily Gemini spend cap of $1.00: $1.50 spent today (UTC), not counting 1 call whose cost is unknown. The cap resets at 00:00 UTC (${resetDay}). Ask Claude to write it through the MCP connector, or raise the cap in Team settings under AI.`;

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/story`,
    );

    const convert = byTest(page, 'convert-to-screenplay');
    const refusal = page.getByText(refusalText, { exact: true });

    await convert.click();
    await expect(refusal.first()).toBeVisible();
    await capture(page, 'spend-cap-04-generate-refused');

    // The second press is refused the same way: no run holds the stage
    await expect(convert).toBeEnabled();
    await convert.click();
    await expect(refusal).toHaveCount(2);

    expect(
      await readRows(
        'generation_runs',
        `target_id=eq.${episode.id}&stage=eq.screenplay&select=id`,
      ),
    ).toEqual([]);
  });
});
