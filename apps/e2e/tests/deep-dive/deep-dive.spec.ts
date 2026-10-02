import { Page, Request, expect, test } from '@playwright/test';

import { actionIdOf } from '../utils/action-ids';
import {
  seedMembership,
  seedProject,
  seedPublishedEpisode,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import { DeepDivePageObject } from './deep-dive.po';

type ActionArgs = {
  scope?: Record<string, unknown>;
  accountId?: string;
  windowDays?: number;
  [key: string]: unknown;
};

/**
 * Records the arguments of every server action the page calls.
 *
 * A server action's request body is its serialized argument list, so this is
 * the scope that actually reached the server — the thing the filter exists to
 * change, and nothing on screen shows it while ClickHouse is off.
 */
function recordActionCalls(page: Page) {
  const calls: ActionArgs[] = [];

  page.on('request', (request: Request) => {
    const action = request.headers()['next-action'];

    if (request.method() !== 'POST' || !action) {
      return;
    }

    try {
      const [args] = JSON.parse(request.postData() ?? '[]') as ActionArgs[];

      if (args) {
        actionOf.set(args, action);
        calls.push(args);
      }
    } catch {
      // Multipart bodies (uploads) are not action calls this test inspects.
    }
  });

  return calls;
}

/**
 * Which action each recorded call was, by id. Beside the arguments rather
 * than in them, so their keys and serialisation stay exactly what was sent.
 * An action is recognised by id, never by its input's shape: Deep Dive's
 * coverage request (FILM-1704) takes `{ scope, from, to }`, exactly as the
 * subscriber series does.
 */
const actionOf = new WeakMap<ActionArgs, string>();

const callsOf = (calls: ActionArgs[], exportedName: string) => {
  const id = actionIdOf(exportedName);

  return calls.filter((call) => actionOf.get(call) === id);
};

/** The cards' own actions: everything scoped except the coverage request. */
const deepDiveCalls = (calls: ActionArgs[]) => {
  const coverage = actionIdOf('getCoverageMatrixAction');

  return calls.filter(
    (call) => call.scope !== undefined && actionOf.get(call) !== coverage,
  );
};

const yppCalls = (calls: ActionArgs[]) =>
  calls.filter((call) => call.windowDays !== undefined && call.accountId);

test.describe('Deep Dive channel filter', () => {
  test('defaults to All channels and lists inactive channels, marked', async ({
    page,
  }) => {
    const deepDive = new DeepDivePageObject(page);
    const fixture = await deepDive.setup();

    await expect(deepDive.channelFilter()).toHaveText('All channels');

    await deepDive.channelFilter().click();

    const active = page.locator(
      `[data-test="channel-filter-option-${fixture.activeChannelId}"]`,
    );
    const inactive = page.locator(
      `[data-test="channel-filter-option-${fixture.inactiveChannelId}"]`,
    );

    await expect(active).toContainText('Active Channel');
    await expect(byTest(active, 'channel-filter-inactive-badge')).toHaveCount(
      0,
    );

    // A disconnected channel still owns the history the figures are built
    // from, so it is listed — and says it is disconnected.
    await expect(inactive).toContainText('Retired Channel');
    await expect(byTest(inactive, 'channel-filter-inactive-badge')).toHaveText(
      'Inactive',
    );
  });

  test('a selected channel reaches every action, and All channels sends none', async ({
    page,
  }) => {
    const calls = recordActionCalls(page);
    const deepDive = new DeepDivePageObject(page);
    const fixture = await deepDive.setup();

    // The first render: eight deep-dive calls with the plain project scope —
    // median, traffic, back catalog, cohorts, the subscriber series, the
    // weekly diagnostics (FILM-1616), rolling-90 and the returning-viewer
    // proxy (FILM-1511) — and a YPP call with no channel.
    await expect
      .poll(() => deepDiveCalls(calls).length)
      .toBeGreaterThanOrEqual(8);
    await expect.poll(() => yppCalls(calls).length).toBeGreaterThanOrEqual(1);

    for (const call of [...deepDiveCalls(calls), ...yppCalls(calls)]) {
      expect(call.scope ?? call).not.toHaveProperty('connectionId');
    }

    const beforeSelect = calls.length;

    await deepDive.chooseChannel(fixture.activeChannelId);

    // Every action on the tab asks again, each carrying the channel. A query
    // key without the channel would have served the cached all-channel
    // answer and made no request at all.
    //
    // Eight since FILM-1511: the weekly diagnostics (FILM-1616), the rolling-90
    // card and the returning-viewer card are three of them, and the loop below
    // is what holds each to carrying the channel rather than quietly
    // answering for the whole project.
    await expect
      .poll(() => deepDiveCalls(calls.slice(beforeSelect)).length)
      .toBe(8);
    await expect.poll(() => yppCalls(calls.slice(beforeSelect)).length).toBe(1);

    for (const call of deepDiveCalls(calls.slice(beforeSelect))) {
      expect(call.scope).toMatchObject({
        projectId: fixture.project.id,
        connectionId: fixture.activeChannelId,
      });
    }

    expect(yppCalls(calls.slice(beforeSelect))[0]).toMatchObject({
      connectionId: fixture.activeChannelId,
    });

    // The tab's coverage (FILM-1704) follows the channel too, once.
    await expect
      .poll(
        () =>
          callsOf(calls.slice(beforeSelect), 'getCoverageMatrixAction').length,
      )
      .toBe(1);
    expect(
      callsOf(calls.slice(beforeSelect), 'getCoverageMatrixAction')[0]?.scope,
    ).toEqual({
      projectId: fixture.project.id,
      connectionId: fixture.activeChannelId,
    });

    const beforeReset = calls.length;

    await deepDive.chooseChannel('all');
    await expect(deepDive.channelFilter()).toHaveText('All channels');

    // Whatever is requested again after returning to All channels carries no
    // channel at all — not an empty string, not a serialized undefined.
    await page.waitForLoadState('networkidle');

    for (const call of calls.slice(beforeReset)) {
      expect(call.scope ?? call).not.toHaveProperty('connectionId');
      expect(JSON.stringify(call)).not.toContain('connectionId');
    }
  });

  test('YPP renders one card per active YouTube channel, and explains an inactive selection', async ({
    page,
  }) => {
    const deepDive = new DeepDivePageObject(page);
    const fixture = await deepDive.setup();

    // A second active YouTube channel that this project publishes to. With
    // one active channel a pooled total would also render exactly one card,
    // so this is what lets the test tell per-channel cards from a sum.
    const secondChannelId = await seedYouTubeConnection(
      fixture.team.accountId,
      'Second Channel',
    );

    await seedPublishedEpisode(fixture.project.id, secondChannelId, {
      number: 3,
    });

    // And one on the same account that this project has never published to.
    // Every other card on the tab is project-scoped and the filter cannot
    // select it, so it must not get a YPP card here either.
    await seedYouTubeConnection(fixture.team.accountId, 'Unrelated Channel');

    await page.reload();
    await byTest(page, 'analytics-tab-deep-dive').click();

    // The project's two active channels, two cards — never a pooled total,
    // never the disconnected channel, never the account's unrelated one.
    await expect(deepDive.yppCards()).toHaveCount(2);
    await expect(deepDive.yppCards()).toContainText([
      'Active Channel',
      'Second Channel',
    ]);
    await expect(
      deepDive.yppCards().filter({ hasText: 'Unrelated Channel' }),
    ).toHaveCount(0);

    await deepDive.chooseChannel(fixture.inactiveChannelId);

    await expect(byTest(page, 'ypp-not-applicable')).toBeVisible();
    await expect(deepDive.yppCards()).toHaveCount(0);

    await deepDive.chooseChannel(fixture.activeChannelId);

    await expect(deepDive.yppCards()).toHaveCount(1);
    await expect(deepDive.yppCards()).toContainText(['Active Channel']);
  });
});

test.describe('Deep Dive subscribers (FILM-1617)', () => {
  // ClickHouse is off here, so no channel has a subscriber level. That is
  // exactly the state a hidden count produces, and the one where a surface is
  // most tempted to print 0.
  test('a channel with no subscriber count says so rather than showing zero', async ({
    page,
  }) => {
    const deepDive = new DeepDivePageObject(page);
    await deepDive.setup();

    await expect(deepDive.subscriberEmpty()).toContainText(
      'No subscriber count yet',
    );
    await expect(byTest(page, 'subscriber-series-error')).toHaveCount(0);

    const ypp = deepDive.yppCards().first();

    await expect(byTest(ypp, 'ypp-subscribers-value')).toHaveText(
      'Unavailable',
    );

    // The net figure stays, under a label that says it is movement.
    await expect(ypp).toContainText('Net subscriber movement (365 days)');
  });

  test('the subscriber card follows the channel filter', async ({ page }) => {
    const calls = recordActionCalls(page);
    const deepDive = new DeepDivePageObject(page);
    const fixture = await deepDive.setup();

    // By action id. Matched on its keys — exactly a scope and a date window —
    // it also matched Deep Dive's coverage request, which takes the same.
    const seriesCalls = (from = 0) =>
      callsOf(calls.slice(from), 'getSubscriberSeriesAction');

    await expect.poll(() => seriesCalls().length).toBeGreaterThanOrEqual(1);

    const before = calls.length;

    // The disconnected channel: its history still belongs on this card.
    await deepDive.chooseChannel(fixture.inactiveChannelId);

    await expect.poll(() => seriesCalls(before).length).toBe(1);

    expect(seriesCalls(before)[0]?.scope).toEqual({
      projectId: fixture.project.id,
      connectionId: fixture.inactiveChannelId,
    });

    await expect(deepDive.subscriberEmpty()).toContainText(
      'No subscriber count yet',
    );
  });
});

test.describe('Deep Dive subscribers for an untracked platform (FILM-1617)', () => {
  // Facebook and X are allowed connections that no snapshot is ever
  // taken for. "No count yet" would send someone looking for a missing
  // snapshot that will never come.
  test('a Facebook-only project says counts are not tracked', async ({
    page,
  }) => {
    const deepDive = new DeepDivePageObject(page);
    const team = await seedTeamAccount();
    const project = await seedProject(team);

    const facebook = await seedYouTubeConnection(team.accountId, 'Page', {
      platform: 'facebook',
    });

    await seedPublishedEpisode(project.id, facebook, {
      number: 1,
      platform: 'facebook',
    });

    await signInAs(page, team);
    await deepDive.goToDeepDive(team.slug, project.slug);

    await expect(deepDive.subscriberEmpty()).toContainText(
      'aren’t tracked for Facebook',
    );
    await expect(deepDive.subscriberEmpty()).not.toContainText(
      'No subscriber count yet',
    );
  });
});

test.describe('Project analytics page', () => {
  test('the export dialog asks for reports by account id, not slug', async ({
    page,
  }) => {
    const calls = recordActionCalls(page);
    const deepDive = new DeepDivePageObject(page);
    const fixture = await deepDive.setup();

    await page.getByRole('button', { name: 'Export' }).click();

    const dialog = page.getByRole('dialog');

    await expect(dialog).toBeVisible();

    const beforeScheduled = calls.length;

    // The dialog scrolls (it used to be taller than a short viewport with its
    // tab list above the fold, which this test worked around with arrow keys),
    // so the tab is clicked the way anyone would.
    await dialog.getByRole('tab', { name: 'Scheduled Reports' }).click();

    await expect(
      dialog.getByRole('tab', { name: 'Scheduled Reports' }),
    ).toHaveAttribute('data-state', 'active');

    // The dialog was handed the account *slug* as `accountId`. Every report
    // schema requires a uuid, so this read failed validation — and the
    // failure went only to the console, which is why it is asserted on the
    // call rather than on the screen.
    const scheduledReads = () =>
      calls
        .slice(beforeScheduled)
        .filter((call) => Object.keys(call).join() === 'accountId');

    // At least one read — React may run the effect twice in development —
    // and every one of them by id.
    await expect.poll(() => scheduledReads().length).toBeGreaterThan(0);

    for (const call of scheduledReads()) {
      expect(call).toEqual({ accountId: fixture.team.accountId });
    }
  });

  test("a user in two teams sees each team's project under the same slug", async ({
    page,
  }) => {
    const deepDive = new DeepDivePageObject(page);
    const fixture = await deepDive.setup();

    // A second team with a project under the *same* slug, and the fixture
    // user made a member of it. Slugs are unique per account, not globally,
    // so both projects are visible to this user through RLS.
    const otherTeam = await seedTeamAccount();
    await seedMembership(fixture.team.userId, otherTeam.accountId);

    const otherProject = await seedProject(otherTeam, {
      name: 'Other Team Project',
      slug: fixture.project.slug,
    });

    // Looked up by slug alone, both rows match: `.single()` errors and the
    // page 404s under *either* team's URL. Scoped to the URL's account, each
    // URL resolves to its own team's project.
    await page.goto(
      `/home/${fixture.team.slug}/studio/${fixture.project.slug}/analytics`,
    );

    await expect(
      page
        .getByRole('main')
        .getByRole('heading', { name: fixture.project.name }),
    ).toBeVisible();

    await page.goto(
      `/home/${otherTeam.slug}/studio/${otherProject.slug}/analytics`,
    );

    await expect(
      page
        .getByRole('main')
        .getByRole('heading', { name: 'Other Team Project' }),
    ).toBeVisible();
  });
});
