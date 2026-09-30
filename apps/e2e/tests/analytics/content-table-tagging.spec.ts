import { type Page, expect, test } from '@playwright/test';

import {
  type SeededVideo,
  daysAgo,
  seedVideoDim,
  seedVideoMetrics,
} from '../utils/clickhouse';
import {
  insertRow,
  readRows,
  seedProject,
  seedPublishedEpisode,
  seedTeamAccount,
  seedYouTubeConnection,
  serviceRoleAuth,
  uniqueStamp,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * Tagging rows from the Content tab's table (FILM-1507).
 *
 * The form-shaped bugs this repo has shipped lived between the DOM and state
 * (a selection that survived the save, a picker that kept its choice), so the
 * spec drives the table the way a person does and asserts the second
 * submission as well as the first. The rows come from ClickHouse, so it is
 * gated like the other specs that seed it.
 */
test.describe('FILM-1507 — content table tagging', () => {
  test.skip(
    !process.env.CLICKHOUSE_EVIDENCE,
    'Set CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  test.describe.configure({ timeout: 180_000 });

  async function seedTag(accountId: string, label: string) {
    const row = await insertRow<{ id: string }>(
      'content_tags',
      {
        account_id: accountId,
        dimension: 'topic',
        slug: `${label.toLowerCase()}-${uniqueStamp()}`,
        label,
      },
      serviceRoleAuth(),
    );

    return row.id;
  }

  async function setup(page: Page) {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const connection = await seedYouTubeConnection(team.accountId, 'Channel');
    const publishes: Array<{ publishId: string; title: string }> = [];

    for (const number of [1, 2, 3]) {
      const title = `Tagging video ${number}`;
      const { publishId } = await seedPublishedEpisode(project.id, connection, {
        number,
        title,
      });
      const video: SeededVideo = {
        videoId: publishId,
        projectId: project.id,
        accountId: team.accountId,
        connectionId: connection,
        title,
        publishedAt: daysAgo(5),
      };

      await seedVideoDim(video);
      await seedVideoMetrics(video, [{ ageDays: 1, views: 100 * number }]);
      publishes.push({ publishId, title });
    }

    const volcanoes = await seedTag(team.accountId, 'Volcanoes');
    const oceans = await seedTag(team.accountId, 'Oceans');

    await signInAs(page, team);

    return { team, project, publishes, volcanoes, oceans };
  }

  test('tags the selected rows, then a different subset, and the chips follow', async ({
    page: browserPage,
  }) => {
    const { team, project, publishes, volcanoes, oceans } =
      await setup(browserPage);

    await browserPage.goto(
      `/home/${team.slug}/studio/${project.slug}/analytics`,
    );
    await byTest(browserPage, 'analytics-tab-content').click();
    await byTest(browserPage, 'content-view-table').click();

    const rows = byTest(browserPage, 'content-row');

    await expect(rows).toHaveCount(3);
    await expect(byTest(browserPage, 'content-row-tags').first()).toHaveText(
      'Untagged',
    );

    // No bulk bar until something is selected.
    await expect(byTest(browserPage, 'content-tag-selected')).toHaveCount(0);

    await byTest(browserPage, 'content-select-all').click();
    await expect(byTest(browserPage, 'content-selected-count')).toHaveText(
      '3 selected',
    );
    await expect(byTest(browserPage, 'content-tag-selected')).toBeDisabled();

    await byTest(browserPage, 'tag-picker-trigger').click();
    await byTest(browserPage, `tag-picker-option-${volcanoes}`).click();
    await browserPage.keyboard.press('Escape');
    await byTest(browserPage, 'content-tag-selected').click();

    await expect(byTest(browserPage, 'content-bulk-done')).toHaveText(
      'Tagged 3 videos.',
    );
    await expect(byTest(browserPage, 'content-row-tags')).toHaveText([
      'Volcanoes',
      'Volcanoes',
      'Volcanoes',
    ]);
    // The save clears the selection and the picker's choice.
    await expect(byTest(browserPage, 'content-selected-count')).toHaveCount(0);

    // The second submission: one row, another tag. Stale picker or selection
    // state would tag all three again, or re-apply the first tag.
    await rows
      .filter({ hasText: 'Tagging video 2' })
      .locator('[data-test="content-row-select"]')
      .click();
    await expect(byTest(browserPage, 'content-selected-count')).toHaveText(
      '1 selected',
    );
    await expect(byTest(browserPage, 'content-tag-selected')).toBeDisabled();

    await byTest(browserPage, 'tag-picker-trigger').click();
    await byTest(browserPage, `tag-picker-option-${oceans}`).click();
    await browserPage.keyboard.press('Escape');
    await byTest(browserPage, 'content-tag-selected').click();

    await expect(byTest(browserPage, 'content-bulk-done')).toHaveText(
      'Tagged 1 video.',
    );
    await expect(
      rows
        .filter({ hasText: 'Tagging video 2' })
        .locator('[data-test="content-row-tags"]'),
    ).toContainText('Oceans');
    await expect(
      rows
        .filter({ hasText: 'Tagging video 1' })
        .locator('[data-test="content-row-tags"]'),
    ).not.toContainText('Oceans');

    // What is in the database, not what the page says.
    const assigned = await readRows<{ publish_id: string; tag_id: string }>(
      'publish_tags',
      `publish_id=in.(${publishes.map((p) => p.publishId).join(',')})&select=publish_id,tag_id`,
    );

    expect(assigned).toHaveLength(4);
    expect(assigned.filter((row) => row.tag_id === oceans)).toHaveLength(1);
    expect(assigned.filter((row) => row.tag_id === volcanoes)).toHaveLength(3);
  });
});
