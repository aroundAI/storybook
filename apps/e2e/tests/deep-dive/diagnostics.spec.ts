import { expect, test } from '@playwright/test';

import {
  seedAdditionalPublish,
  seedProject,
  seedPublishedEpisode,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * Weekly diagnostics and the retention drill-down (FILM-1616).
 *
 * ClickHouse is off in CI, so every figure here is an empty state. What a
 * browser proves is the wiring — that both surfaces mount, that the
 * drill-down reaches an action, and that the ownership check refuses
 * another account's publish.
 *
 * That last one is the reason this spec exists in CI rather than only in
 * the evidence half: it is Postgres-only, so it runs fully with ClickHouse
 * disabled, and it is the difference between a drill-down and a
 * cross-tenant read. KB-9 removed the Hook Lab for exactly this, on this
 * table.
 */
test.describe('FILM-1616 — weekly diagnostics', () => {
  test('mounts the diagnostics section below the strategy cards', async ({
    page,
  }) => {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const connection = await seedYouTubeConnection(team.accountId, 'Channel');

    await seedPublishedEpisode(project.id, connection, { number: 1 });
    await signInAs(page, team);

    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/analytics?tab=deep-dive`,
    );

    await page.locator('[data-test="analytics-tab-deep-dive"]').click();

    const section = page.locator('[data-test="weekly-diagnostics-section"]');

    await expect(section).toBeVisible();

    // §8: with ClickHouse off the table renders no rows. A row here would
    // carry `views: 0` for a video nobody has measured, which reads as
    // nobody watched.
    await expect(page.locator('[data-test="diagnostic-row"]')).toHaveCount(0);
    await expect(section).toContainText('Nothing to diagnose yet');

    // Outside the card grid, not one of its cards. The framing is the
    // point: these cards answer "what should we make next", and a low-CTR
    // flag read as a content verdict is the opposite of a breakage check.
    await expect(
      page.locator('[data-test="deep-dive-tab"] .grid'),
    ).not.toContainText("This week's uploads");
  });

  test("refuses another account's publish where its own is allowed", async ({
    page,
  }) => {
    // Two tenants. The second's publish id is a perfectly well-formed uuid
    // — guessing one is the whole attack, and nothing about it looks wrong.
    const mine = await seedTeamAccount();
    const myProject = await seedProject(mine);
    const myConnection = await seedYouTubeConnection(mine.accountId, 'Mine');
    const myVideo = await seedPublishedEpisode(myProject.id, myConnection, {
      number: 1,
    });

    const theirs = await seedTeamAccount();
    const theirProject = await seedProject(theirs);
    const theirConnection = await seedYouTubeConnection(
      theirs.accountId,
      'Theirs',
    );
    const theirVideo = await seedPublishedEpisode(
      theirProject.id,
      theirConnection,
      { number: 1 },
    );

    await signInAs(page, mine);

    // The episode page, not the Deep Dive drill-down: it resolves its
    // publish from Postgres, so the retention section renders with
    // ClickHouse off — where the diagnostics table has no rows to click
    // (§8).
    const url = `/home/${mine.slug}/studio/${myProject.slug}/episodes/${myVideo.episodeSlug}/analytics`;

    /**
     * Loads the page, optionally rewriting the publish id the retention
     * action receives.
     *
     * A server action's request body is its argument list, so swapping the
     * id there is what a rewritten request does. Driving the UI alone could
     * never ask for a publish the page does not know about.
     */
    const load = async (swapTo?: string) => {
      if (swapTo) {
        await page.route('**/*', async (route) => {
          const request = route.request();
          const body = request.postData() ?? '';

          if (
            request.method() === 'POST' &&
            request.headers()['next-action'] &&
            body.includes('publishId')
          ) {
            await route.continue({
              postData: body.replace(
                /"publishId":"[^"]+"/,
                `"publishId":"${swapTo}"`,
              ),
            });

            return;
          }

          await route.continue();
        });
      }

      await page.goto(url);

      await expect(
        page.locator('[data-test="episode-retention"]'),
      ).toBeVisible();
    };

    // Own publish: the curve area renders and reports no failure. With
    // ClickHouse off the curve itself is empty, which is the point — the
    // difference under test is refusal, not data.
    await load();
    await expect(page.locator('[data-test="episode-retention"]')).toContainText(
      'No retention curve available',
    );

    // The same page, with another tenant's publish id in the request.
    await page.unroute('**/*');
    await load(theirVideo.publishId);

    await expect(
      page.locator('[data-test="episode-retention-error"]'),
    ).toBeVisible();

    await page.unroute('**/*');
  });

  test('still finds the video when an episode is on two channels', async ({
    page,
  }) => {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const first = await seedYouTubeConnection(team.accountId, 'First');
    const second = await seedYouTubeConnection(team.accountId, 'Second');

    const video = await seedPublishedEpisode(project.id, first, { number: 1 });

    // The same episode published to a second YouTube channel. Nothing in
    // the schema forbids it — `idx_publishes_episode_id` is not unique and
    // there is no (episode_id, platform) constraint — and a project holding
    // several YouTube channels is ordinary.
    await seedAdditionalPublish(video.episodeId, second);

    await signInAs(page, team);

    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${video.episodeSlug}/analytics`,
    );

    // A resolver that assumes at most one row errors here, and an error
    // that is discarded reads as "this episode has no video" — the section
    // disappears with nothing said.
    await expect(page.locator('[data-test="episode-retention"]')).toBeVisible();
  });

  test('reports a failed video lookup rather than rendering nothing', async ({
    page,
  }) => {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const connection = await seedYouTubeConnection(team.accountId, 'Channel');
    const video = await seedPublishedEpisode(project.id, connection, {
      number: 1,
    });

    await signInAs(page, team);

    // Corrupt the episode id the lookup receives, so the action fails. The
    // page cannot tell one failure from another — what matters is that it
    // does not render a failure as "this episode has no video", which is
    // what gating solely on the resolved publish id did.
    await page.route('**/*', async (route) => {
      const request = route.request();
      const body = request.postData() ?? '';

      if (
        request.method() === 'POST' &&
        request.headers()['next-action'] &&
        body.includes('episodeId')
      ) {
        await route.continue({
          postData: body.replace(
            /"episodeId":"[^"]+"/,
            '"episodeId":"not-a-uuid"',
          ),
        });

        return;
      }

      await route.continue();
    });

    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${video.episodeSlug}/analytics`,
    );

    await expect(
      page.locator('[data-test="episode-retention-error"]'),
    ).toBeVisible();

    await page.unroute('**/*');
  });

  test('the episode page loads its analytics through an action', async ({
    page,
  }) => {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const connection = await seedYouTubeConnection(team.accountId, 'Channel');
    const video = await seedPublishedEpisode(project.id, connection, {
      number: 1,
    });

    await signInAs(page, team);

    const requests: string[] = [];

    page.on('request', (request) => {
      if (request.url().includes('/api/analytics/episode/')) {
        requests.push(request.url());
      }
    });

    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${video.episodeSlug}/analytics`,
    );

    await expect(
      page.getByRole('heading', { name: 'Episode Analytics' }),
    ).toBeVisible();

    // The route it used to fetch was never built, so every episode rendered
    // the empty state. Nothing should ask for it again.
    expect(requests).toEqual([]);
  });
});
