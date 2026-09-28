import { Page, Request, expect, test } from '@playwright/test';

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
    if (request.method() !== 'POST' || !request.headers()['next-action']) {
      return;
    }

    try {
      const [args] = JSON.parse(request.postData() ?? '[]') as ActionArgs[];

      if (args) calls.push(args);
    } catch {
      // Multipart bodies (uploads) are not action calls this test inspects.
    }
  });

  return calls;
}

const deepDiveCalls = (calls: ActionArgs[]) =>
  calls.filter((call) => call.scope !== undefined);

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

    // The first render: six deep-dive calls with the plain project scope —
    // median, traffic, back catalog, cohorts, the subscriber series and the
    // weekly diagnostics (FILM-1616) — and a YPP call with no channel.
    await expect
      .poll(() => deepDiveCalls(calls).length)
      .toBeGreaterThanOrEqual(6);
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
    // Six since FILM-1616: the weekly diagnostics is one of them, and the
    // loop below is what holds it to carrying the channel rather than
    // quietly answering for the whole project.
    await expect
      .poll(() => deepDiveCalls(calls.slice(beforeSelect)).length)
      .toBe(6);
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

    await expect(
      page.locator('[data-test="ypp-not-applicable"]:visible'),
    ).toBeVisible();
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

    // Exactly a scope and a date window. The traffic breakdown also sends
    // `scope`, `from` and `to`, plus `bucket`, so matching on `to` alone
    // picks it up.
    const seriesCalls = (from = 0) =>
      calls
        .slice(from)
        .filter((call) => Object.keys(call).sort().join() === 'from,scope,to');

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
  // Facebook, X and LinkedIn are allowed connections that no snapshot is ever
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

    // The dialog is taller than the viewport and does not scroll, so its tab
    // list is off-screen and cannot be clicked. Radix tabs follow arrow keys,
    // which is how a keyboard user would reach it too.
    await dialog.getByRole('tab', { name: 'Generate Report' }).focus();
    await page.keyboard.press('ArrowRight');

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
