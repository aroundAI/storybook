import { Page, expect, test } from '@playwright/test';

import { insertClickHouse } from '../utils/clickhouse';
import {
  seedProject,
  seedPublishedEpisode,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

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

interface ActionResponse {
  /** The `next-action` id: which action answered, not merely how many did. */
  action: string;
  status: number;
  body: string;
}

/**
 * The data a server-action response carried, or null when it carried none.
 *
 * The two refusals look nothing alike and both have to count as "nothing".
 * A scope-checked read throws, which is a 500 whose flight payload is an
 * `E{...}` error; the dashboard reads return 200 with `null` or `[]`,
 * indistinguishable from a project that really is empty. Asserting on the
 * figure instead of on this is what let the guards below pass in CI: which
 * reads happen to produce a given number varies by environment, so a
 * mutation that opened one path leaked nothing the assertion was looking
 * at. Any 200 carrying a payload is a leak here, because every request
 * being watched names the victim's project.
 */
function payloadOf(response: ActionResponse): string | null {
  if (response.status !== 200) return null;

  const line = response.body
    .split('\n')
    .find((candidate) => candidate.startsWith('1:'));

  if (!line) return null;

  const data = line.slice(2).trim();

  if (data.startsWith('E{')) return null;

  // A refusal returned as a value (KB-6) carries no data: `{ ok: false,
  // error }` and nothing else, with no figure in the message
  try {
    const value: unknown = JSON.parse(data);
    if (
      typeof value === 'object' &&
      value !== null &&
      (value as { ok?: unknown }).ok === false &&
      typeof (value as { error?: unknown }).error === 'string' &&
      !(value as { error: string }).error.includes(String(B_VIEWS)) &&
      Object.keys(value).length === 2
    ) {
      return null;
    }
  } catch {
    // Not JSON: treat it as data
  }

  return ['', 'null', '[]', '{}'].includes(data) ? null : data;
}

/**
 * Collects every server-action response whose request named `projectId`,
 * keeping the action each one came from.
 *
 * The action id is what makes the negative assertion below safe. Counting
 * responses cannot: the read that leaks is one of several the page makes,
 * and on a slow machine it can answer *after* a count is satisfied — so
 * "none of the bodies carried the figure" would be measuring the responses
 * that happened to have arrived. Waiting for the same actions that carried
 * it for the victim measures the read under test.
 */
function collectActionResponses(page: Page, projectId: string) {
  const responses: ActionResponse[] = [];

  page.on('response', async (response) => {
    const request = response.request();
    const action = request.headers()['next-action'];

    if (
      request.method() === 'POST' &&
      action &&
      (request.postData() ?? '').includes(projectId)
    ) {
      responses.push({
        action,
        status: response.status(),
        body: await response.text().catch(() => ''),
      });
    }
  });

  return responses;
}

const carryingData = (responses: ActionResponse[]) =>
  responses.filter((response) => payloadOf(response) !== null);

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
        episode_duration_seconds: 600,
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
    const victimResponses = collectActionResponses(
      victimPage,
      victimProject.id,
    );
    await signInAs(victimPage, victim);
    await victimPage.goto(
      `/home/${victim.slug}/studio/${victimProject.slug}/analytics`,
    );
    await byTest(victimPage, 'analytics-tab-deep-dive').click();
    await expect
      .poll(
        () =>
          victimResponses.some((response) =>
            response.body.includes(String(B_VIEWS)),
          ),
        { timeout: 30_000 },
      )
      .toBe(true);

    // The reads that answered the owner with data. The attacker must be
    // shown to have run *these* and got nothing back, not merely to have
    // run several reads of some kind.
    const carrying = [
      ...new Set(carryingData(victimResponses).map((one) => one.action)),
    ];

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

    const attackerResponses = collectActionResponses(page, victimProject.id);
    await signInAs(page, attacker);
    await page.goto(
      `/home/${attacker.slug}/studio/${attackerProject.slug}/analytics`,
    );
    await byTest(page, 'analytics-tab-deep-dive').click();

    // Wait until every read that carried the figure for the victim has
    // answered the attacker too, then look for the figure in any response.
    await expect
      .poll(
        () =>
          carrying.filter((action) =>
            attackerResponses.some((response) => response.action === action),
          ).length,
        { timeout: 30_000 },
      )
      .toBe(carrying.length);

    // Printed unconditionally: when this guard's mutation was applied in CI
    // the test kept passing, and a passing test prints nothing to explain
    // why. One line of what each side actually got is the difference
    // between diagnosing that and guessing at it.
    const summarise = (one: ActionResponse) =>
      `${one.action.slice(0, 8)} ${one.status} ${payloadOf(one) === null ? 'nothing' : `DATA ${payloadOf(one)!.slice(0, 60)}`}`;

    console.log(
      [
        `TENANT victim carrying: ${carrying.map((a) => a.slice(0, 8)).join()}`,
        ...victimResponses.map((one) => `TENANT victim   ${summarise(one)}`),
        ...attackerResponses.map((one) => `TENANT attacker ${summarise(one)}`),
      ].join('\n'),
    );

    // Not "no response contained 777777": every one of these requests names
    // the victim's project, so a payload of any kind is data this caller
    // may not have.
    expect(
      carryingData(attackerResponses).map((one) => ({
        action: one.action,
        payload: payloadOf(one)!.slice(0, 200),
      })),
    ).toEqual([]);
  });
});
