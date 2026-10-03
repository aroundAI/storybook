import { type Page, expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';

import {
  insertRow,
  seedProject,
  seedTeamAccount,
  serviceRoleAuth,
  uniqueStamp,
} from '../utils/seed';
import { SUPER_ADMIN_STORAGE_STATE } from '../utils/super-admin';
import { byTest } from '../utils/visible';

/**
 * FILM-1911, criterion 2: the super admin's MCP panels, read off the page
 * after seeding rows whose figures are computed by hand.
 *
 * The panels aggregate across every team, so the tool panel is checked on a
 * tool name only this run uses, and the run panels by how much they move
 * when this run adds two expired external runs.
 *
 * Seeded calls for the tool: ok 10, 20, 30, 40, 100 ms and one
 * VALIDATION_FAILED at 7 ms now, and ok 5 ms three days ago.
 *   7 days:   7 calls, 1 error, p95 over (5, 7, 10, 20, 30, 40, 100)
 *             = 40 + 0.7 * 60 = 82 ms
 *   24 hours: 6 calls, 1 error, p95 over (7, 10, 20, 30, 40, 100)
 *             = 40 + 0.75 * 60 = 85 ms
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE_EVIDENCE) return;

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({
    path: `${OUT}/film-1911-${name}.png`,
    fullPage: true,
  });
}

function rowCells(page: Page, panel: string, text: string) {
  return byTest(page, `${panel}-row`).filter({ hasText: text }).locator('td');
}

async function cellTexts(page: Page, panel: string, text: string) {
  return rowCells(page, panel, text).allInnerTexts();
}

/** The runs panel's count for a mode and status, 0 when it has no row. */
async function runCount(page: Page, mode: string, status: string) {
  await expect(byTest(page, 'mcp-panel-runs')).toBeVisible();

  const rows = await byTest(page, 'mcp-panel-runs-row').evaluateAll(
    (elements) =>
      elements.map((row) =>
        Array.from(row.querySelectorAll('td')).map((cell) => cell.innerText),
      ),
  );
  const row = rows.find(([m, s]) => m === mode && s === status);

  return row ? Number(row[2]) : 0;
}

/** Today's (the last row's) expired-lease count. */
async function expiredToday(page: Page) {
  const cells = await byTest(page, 'mcp-panel-expired-leases-row')
    .last()
    .locator('td')
    .allInnerTexts();

  return Number(cells[1]);
}

test.describe('the MCP connector panels', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('show calls, errors and p95 per tool, runs by mode and status, and expired leases, for the chosen window', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'mcp-monitoring' });
    const project = await seedProject(team);
    const tool = `spec_tool_${uniqueStamp().slice(0, 8)}`;
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();

    const calls: Array<[string, number, string | null, string?]> = [
      ['ok', 10, null],
      ['ok', 20, null],
      ['ok', 30, null],
      ['ok', 40, null],
      ['ok', 100, null],
      ['error', 7, 'VALIDATION_FAILED'],
      ['ok', 5, null, threeDaysAgo],
    ];

    for (const [status, duration, code, at] of calls) {
      await insertRow(
        'mcp_tool_calls',
        {
          account_id: team.accountId,
          user_id: team.userId,
          tool,
          status,
          error_code: code,
          duration_ms: duration,
          ...(at ? { created_at: at } : {}),
        },
        serviceRoleAuth(),
      );
    }

    await page.goto('/admin/mcp?days=7');

    await expect(byTest(page, 'mcp-guard-status')).toHaveText('None');
    expect(await cellTexts(page, 'mcp-panel-tools', tool)).toEqual([
      tool,
      '7',
      '1',
      '82 ms',
    ]);
    await expect(
      byTest(page, 'mcp-panel-error-codes-row').filter({
        hasText: 'VALIDATION_FAILED',
      }),
    ).toBeVisible();

    const runsBefore = await runCount(page, 'external', 'expired');
    const expiredBefore = await expiredToday(page);

    // Two external runs whose lease ran out today
    for (let index = 0; index < 2; index++) {
      await insertRow(
        'generation_runs',
        {
          account_id: team.accountId,
          project_id: project.id,
          target_type: 'episode',
          target_id: randomUUID(),
          stage: 'story',
          mode: 'external',
          status: 'expired',
          created_by: team.userId,
          finalized_at: new Date().toISOString(),
        },
        serviceRoleAuth(),
      );
    }

    await page.reload();

    await expect
      .poll(() => runCount(page, 'external', 'expired'))
      .toBe(runsBefore + 2);
    expect(await expiredToday(page)).toBe(expiredBefore + 2);

    await capture(page, '01-mcp-panels-7-days');

    // The second window: the call from three days ago drops out
    await byTest(page, 'mcp-window-1').click();
    await expect(page).toHaveURL(/\/admin\/mcp\?days=1$/);

    await expect(rowCells(page, 'mcp-panel-tools', tool).nth(1)).toHaveText(
      '6',
    );
    expect(await cellTexts(page, 'mcp-panel-tools', tool)).toEqual([
      tool,
      '6',
      '1',
      '85 ms',
    ]);
    await expect(byTest(page, 'mcp-panel-expired-leases-row')).toHaveCount(2);

    await capture(page, '02-mcp-panels-24-hours');
  });

  test('are reached from the admin sidebar', async ({ page }) => {
    await page.goto('/admin');
    await byTest(page, 'admin-nav-mcp').click();

    await page.waitForURL('**/admin/mcp');
    await expect(byTest(page, 'mcp-monitoring')).toBeVisible();
  });
});
