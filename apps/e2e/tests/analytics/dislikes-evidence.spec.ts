import { expect, test } from '@playwright/test';

import {
  type SeededVideo,
  clickHouseDate,
  daysAgo,
  insertClickHouse,
  seedVideoDim,
} from '../utils/clickhouse';
import {
  seedProject,
  seedPublishedEpisode,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-1734: the content table shows each video's lifetime dislikes beside
 * its likes, and "Not measured" where nothing measured them — never 0.
 *
 * Seeded by hand, so the expected figures are known: the first YouTube
 * video's two days carry 4 and 3 dislikes (7), the second's 0 and 1 (1),
 * and the Instagram post's none, because Instagram has no dislikes.
 *
 * Skipped unless CAPTURE_EVIDENCE and CLICKHOUSE_EVIDENCE are set.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('FILM-1734 — dislikes in the content table', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE || !process.env.CLICKHOUSE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 and CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  test.describe.configure({ timeout: 180_000 });

  test('measured dislikes summed, and Instagram not measured', async ({
    page,
  }) => {
    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const connection = await seedYouTubeConnection(team.accountId, 'Channel');
    const publishedAt = daysAgo(5);

    const videos = [
      { title: 'Dislikes seven', platform: 'youtube', dislikes: [4, 3] },
      { title: 'Dislikes one', platform: 'youtube', dislikes: [0, 1] },
      {
        title: 'Instagram post',
        platform: 'instagram',
        dislikes: [null, null],
      },
    ] as const;

    for (const [index, spec] of videos.entries()) {
      const { publishId } = await seedPublishedEpisode(project.id, connection, {
        number: index + 1,
        title: spec.title,
        platform: spec.platform,
      });
      const video: SeededVideo = {
        videoId: publishId,
        projectId: project.id,
        accountId: team.accountId,
        connectionId: connection,
        title: spec.title,
        publishedAt,
        platform: spec.platform,
      };

      await seedVideoDim(video);
      await insertClickHouse(
        'video_metrics',
        spec.dislikes.map((dislikes, day) => ({
          project_id: project.id,
          video_id: publishId,
          platform: spec.platform,
          metric_date: clickHouseDate(
            new Date(publishedAt.getTime() + day * 86_400_000),
          ),
          views: 100,
          likes: 10,
          comments: 2,
          shares: 1,
          saves: spec.platform === 'instagram' ? 1 : null,
          watch_time_seconds: 6000,
          subscribers_gained: 1,
          dislikes,
          metric_source:
            spec.platform === 'instagram' ? 'snapshot_delta' : 'analytics_api',
        })),
      );
    }

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/${project.slug}/analytics`);
    await byTest(page, 'analytics-tab-content').click();
    await byTest(page, 'content-view-table').click();

    const table = byTest(page, 'content-table');

    await expect(byTest(page, 'content-row')).toHaveCount(3);

    const measured = Object.fromEntries(
      await Promise.all(
        (await byTest(page, 'content-row').all()).map(async (row) => [
          (await row.locator('.font-medium').first().innerText()).trim(),
          (await byTest(row, 'content-dislikes').innerText()).trim(),
        ]),
      ),
    );

    expect(measured).toEqual({
      'Dislikes seven': '7',
      'Dislikes one': '1',
      'Instagram post': 'Not measured',
    });

    await table.screenshot({ path: `${OUT}/film-1734-01-dislikes.png` });

    // eslint-disable-next-line no-console
    console.log('MEASURED_DISLIKES', JSON.stringify(measured));
  });
});
