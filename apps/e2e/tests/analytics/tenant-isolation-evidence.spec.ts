import { Page, expect, test } from '@playwright/test';

import {
  seedProject,
  seedPublishedEpisode,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * Another account cannot read a public project's analytics (FILM-1615 EDD,
 * Step 0, finding F-0).
 *
 * A public or unlisted project's row is readable by any signed-in user, and
 * the analytics actions used to accept "the row is readable" as proof of
 * access. Reproduced before the fix: account A's owner rewrote the project
 * id in their own Deep Dive request to account B's public project and got
 * B's median views back from ClickHouse, which has no row-level security.
 * `assertProjectAccess` now requires `has_account_access`.
 *
 * Needs ClickHouse rows to show a leak at all, so it is gated like the
 * other ClickHouse evidence specs and runs in the 🧬 E2E job.
 */

/** A figure only account B's project has. */
const B_VIEWS = 777777;

async function insertClickHouse(table: string, rows: object[]) {
  const auth = Buffer.from(
    `${process.env.CLICKHOUSE_USER ?? 'default'}:${process.env.CLICKHOUSE_PASSWORD ?? ''}`,
  ).toString('base64');
  const response = await fetch(
    `${process.env.CLICKHOUSE_HOST ?? 'http://localhost:8123'}/?query=${encodeURIComponent(`INSERT INTO ${table} FORMAT JSONEachRow`)}`,
    {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}` },
      body: rows.map((row) => JSON.stringify(row)).join('\n'),
    },
  );

  if (!response.ok) {
    throw new Error(
      `ClickHouse insert into ${table} failed: ${await response.text()}`,
    );
  }
}

async function makePublic(projectId: string) {
  const service =
    process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ??
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
  const response = await fetch(
    `${process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:55321'}/rest/v1/projects?id=eq.${projectId}`,
    {
      method: 'PATCH',
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ visibility: 'public' }),
    },
  );

  expect(response.status).toBe(204);
}

/**
 * Collects the bodies of every server-action response whose request named
 * `projectId`. The caller polls the returned array.
 */
function collectActionResponses(page: Page, projectId: string) {
  const bodies: string[] = [];

  page.on('response', async (response) => {
    const request = response.request();

    if (
      request.method() === 'POST' &&
      request.headers()['next-action'] &&
      (request.postData() ?? '').includes(projectId)
    ) {
      bodies.push(await response.text().catch(() => ''));
    }
  });

  return bodies;
}

test.describe('Analytics tenant isolation (FILM-1615 Step 0)', () => {
  test.skip(
    !process.env.CLICKHOUSE_EVIDENCE,
    'Set CLICKHOUSE_EVIDENCE=1 with a server reading the local ClickHouse.',
  );

  test("another account's user cannot read a public project's analytics", async ({
    browser,
  }) => {
    const attacker = await seedTeamAccount();
    const attackerProject = await seedProject(attacker);

    const victim = await seedTeamAccount();
    const connection = await seedYouTubeConnection(victim.accountId, 'Victim');
    const victimProject = await seedProject(victim);
    const { publishId } = await seedPublishedEpisode(
      victimProject.id,
      connection,
    );
    await makePublic(victimProject.id);

    // Five days ago: inside the dashboard's default 30-day window as well as
    // the Deep Dive's cohort median.
    const day = new Date(Date.now() - 5 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    await insertClickHouse('video_dim', [
      {
        video_id: publishId,
        project_id: victimProject.id,
        account_id: victim.accountId,
        episode_id: '00000000-0000-4000-8000-000000000000',
        connection_id: connection,
        platform: 'youtube',
        content_type: 'full',
        language: 'en',
        title: 'Victim video',
        published_at: `${day} 00:00:00`,
        duration_seconds: 600,
        tags: [],
      },
    ]);
    await insertClickHouse('video_metrics', [
      {
        project_id: victimProject.id,
        video_id: publishId,
        platform: 'youtube',
        metric_date: day,
        views: B_VIEWS,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        watch_time_seconds: 0,
        revenue_cents: 0,
        subscribers_gained: 0,
        subscribers_lost: 0,
        metric_source: 'analytics_api',
        extra_metrics: '{}',
      },
    ]);

    // Positive control: the victim's own owner sees the figure, so the
    // attacker seeing nothing below means refusal, not missing data.
    const victimPage = await (await browser.newContext()).newPage();
    const victimBodies = collectActionResponses(victimPage, victimProject.id);
    await signInAs(victimPage, victim);
    await victimPage.goto(
      `/home/${victim.slug}/studio/${victimProject.slug}/analytics`,
    );
    await victimPage.locator('[data-test="analytics-tab-deep-dive"]').click();
    await expect
      .poll(() => victimBodies.some((body) => body.includes(String(B_VIEWS))), {
        timeout: 30_000,
      })
      .toBe(true);

    // The attacker opens their own dashboard and Deep Dive, with every
    // server-action request rewritten to name the victim's public project —
    // the Overview's project analytics and daily metrics, and the Deep
    // Dive's scope-checked actions.
    const page = await (await browser.newContext()).newPage();
    await page.route('**/*', async (route) => {
      const request = route.request();
      const body = request.postData() ?? '';

      if (
        request.method() === 'POST' &&
        request.headers()['next-action'] &&
        body.includes(attackerProject.id)
      ) {
        await route.continue({
          postData: body.split(attackerProject.id).join(victimProject.id),
        });
        return;
      }

      await route.continue();
    });

    const attackerBodies = collectActionResponses(page, victimProject.id);
    await signInAs(page, attacker);
    await page.goto(
      `/home/${attacker.slug}/studio/${attackerProject.slug}/analytics`,
    );
    await page.locator('[data-test="analytics-tab-deep-dive"]').click();

    // Wait until the rewritten requests — dashboard and Deep Dive — have
    // all been answered, then look for the victim's figure in any of them.
    await expect
      .poll(() => attackerBodies.length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(5);

    expect(
      attackerBodies.filter((body) => body.includes(String(B_VIEWS))),
    ).toEqual([]);
  });
});
