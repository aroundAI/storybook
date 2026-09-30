import { expect, test } from '@playwright/test';

import {
  type SeededVideo,
  daysAgo,
  seedVideoDim,
  seedVideoMetrics,
} from '../utils/clickhouse';
import {
  insertRow,
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
 * Screenshots for FILM-1507's content table: the rows before, a selection
 * with the bulk bar, and the rows after tagging. `content-table-tagging.spec`
 * holds the guards; this produces what a reviewer looks at.
 *
 * Skipped unless CAPTURE_EVIDENCE is set. Needs ClickHouse for the rows.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('FILM-1507 — content table evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE || !process.env.CLICKHOUSE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 and CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  test.describe.configure({ timeout: 180_000 });

  test('captures the table, a selection, and the tagged rows', async ({
    page,
  }) => {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const connection = await seedYouTubeConnection(team.accountId, 'Channel');

    for (const number of [1, 2, 3]) {
      const title = `Evidence video ${number}`;
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
    }

    const tag = await insertRow<{ id: string }>(
      'content_tags',
      {
        account_id: team.accountId,
        dimension: 'topic',
        slug: `volcanoes-${uniqueStamp()}`,
        label: 'Volcanoes',
      },
      serviceRoleAuth(),
    );

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/${project.slug}/analytics`);
    await byTest(page, 'analytics-tab-content').click();
    await byTest(page, 'content-view-table').click();

    const table = byTest(page, 'content-table');

    await expect(byTest(page, 'content-row')).toHaveCount(3);
    await table.screenshot({ path: `${OUT}/01-content-table.png` });

    await byTest(page, 'content-select-all').click();
    await byTest(page, 'tag-picker-trigger').click();
    await byTest(page, `tag-picker-option-${tag.id}`).click();
    await page.keyboard.press('Escape');
    await table.screenshot({ path: `${OUT}/02-selection-bulk-bar.png` });

    await byTest(page, 'content-tag-selected').click();
    await expect(byTest(page, 'content-bulk-done')).toBeVisible();
    await expect(byTest(page, 'content-row-tags')).toHaveText([
      'Volcanoes',
      'Volcanoes',
      'Volcanoes',
    ]);
    await table.screenshot({ path: `${OUT}/03-after-tagging.png` });

    const measured = await byTest(page, 'content-row-tags').allInnerTexts();

    // eslint-disable-next-line no-console
    console.log('MEASURED_CONTENT_TAGS', JSON.stringify(measured));
  });
});
