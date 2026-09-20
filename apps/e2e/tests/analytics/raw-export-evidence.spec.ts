import { expect, test } from '@playwright/test';

import {
  type SeededVideo,
  daysAgo,
  seedVideoDim,
  seedVideoMetrics,
} from '../utils/clickhouse';
import {
  readRows,
  seedProject,
  seedPublishedVideos,
  seedScheduledReport,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';

/**
 * The scheduled raw export, driven end to end (FILM-1615 review 3).
 *
 * The export writes a `Views @30d` column, and until this spec existed
 * nothing in the repository ran the route that fills it — the cell's
 * decision had unit tests and the code that calls it had none. It wrote a
 * `0` for a window that closed before its channel's analytics began, which
 * is the reading FILM-1603 added the honesty flags to prevent, and the fix
 * was verified by reading the call site.
 *
 * So this drives the cron endpoint, takes the CSV out of the delivered
 * mail, and asserts the column in the file a recipient would open.
 *
 * Needs ClickHouse, so it is gated like the other evidence specs.
 */
const MAILPIT = process.env.MAILBOX_URL ?? 'http://127.0.0.1:55324';
const CRON_SECRET = process.env.CRON_SECRET ?? 'dev-secret';

interface MailpitMessage {
  ID: string;
  HTML: string;
}

/**
 * The file a recipient would open.
 *
 * The report is not attached: it is uploaded to storage and the mail
 * carries a signed link, so following that link is what "delivered" means
 * here. Reading the object straight out of the bucket would skip the part
 * a recipient actually does.
 */
async function fetchDeliveredCsv(recipient: string): Promise<string> {
  const search = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${recipient}`)}`,
  );

  expect(search.ok, 'Mailpit search').toBe(true);

  const { messages } = (await search.json()) as {
    messages: Array<{ ID: string }>;
  };

  expect(messages.length, 'the report was delivered').toBeGreaterThan(0);

  const detail = await fetch(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`);
  const message = (await detail.json()) as MailpitMessage;
  const link = /href="([^"]*\/storage\/v1\/object\/sign\/[^"]+)"/.exec(
    message.HTML ?? '',
  );

  expect(link, 'the mail carries a signed link to the report').toBeTruthy();

  const url = link![1]!.replace(/&amp;/g, '&');
  const file = await fetch(url);

  expect(file.ok, `downloading ${url}`).toBe(true);

  return file.text();
}

/** The `Views @30d` cell for each row of a video, in file order. */
function checkpointCells(csv: string, title: string): string[] {
  const [header, ...rows] = csv.trim().split('\n');
  const columns = header!.split(',').map((name) => name.replace(/^"|"$/g, ''));
  const titleAt = columns.indexOf('Title');
  const checkpointAt = columns.indexOf('Views @30d');

  expect(titleAt, 'the CSV has a Title column').toBeGreaterThan(-1);
  expect(checkpointAt, 'the CSV has a Views @30d column').toBeGreaterThan(-1);

  return rows
    .map((row) => row.split(',').map((cell) => cell.replace(/^"|"$/g, '')))
    .filter((cells) => cells[titleAt] === title)
    .map((cells) => cells[checkpointAt] ?? '');
}

test.describe('FILM-1615 — the scheduled raw export', () => {
  test.skip(
    !process.env.CLICKHOUSE_EVIDENCE,
    'Set CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  test('never writes a zero for a figure it does not have', async ({
    request,
  }) => {
    test.setTimeout(180_000);

    const team = await seedTeamAccount();
    const project = await seedProject(team);
    const connection = await seedYouTubeConnection(team.accountId, 'Channel');

    // Four videos, one per state the export can actually reach. A video
    // with no metrics at all cannot appear here: the file is built from
    // daily rows, so a video without any has no row to carry.
    const titles = ['Measured', 'Real zero', 'Late analytics', 'Too young'];
    const [measured, zero, late, young] = await seedPublishedVideos(
      project.id,
      connection,
      titles,
      daysAgo(400).toISOString(),
    );

    const video = (
      videoId: string,
      title: string,
      age: number,
    ): SeededVideo => ({
      videoId,
      projectId: project.id,
      accountId: team.accountId,
      connectionId: connection,
      title,
      publishedAt: daysAgo(age),
    });

    // Each needs a row inside the report's weekly window to appear at all,
    // plus whatever history gives it its state.
    const measuredVideo = video(measured!, 'Measured', 400);
    await seedVideoDim(measuredVideo);
    await seedVideoMetrics(measuredVideo, [
      { ageDays: 0, views: 1_000 },
      { ageDays: 397, views: 5 },
    ]);

    const zeroVideo = video(zero!, 'Real zero', 400);
    await seedVideoDim(zeroVideo);
    await seedVideoMetrics(zeroVideo, [
      { ageDays: 0, views: 0 },
      { ageDays: 397, views: 0 },
    ]);

    // First metric 40 days in: the 30-day window closed before anything
    // was collected, and no API can recover it.
    const lateVideo = video(late!, 'Late analytics', 400);
    await seedVideoDim(lateVideo);
    await seedVideoMetrics(lateVideo, [
      { ageDays: 40, views: 900 },
      { ageDays: 397, views: 4 },
    ]);

    const youngVideo = video(young!, 'Too young', 3);
    await seedVideoDim(youngVideo);
    await seedVideoMetrics(youngVideo, [{ ageDays: 0, views: 300 }]);

    const recipient = `raw-export-${team.accountId}@storybook.dev`;

    const reportId = await seedScheduledReport({
      accountId: team.accountId,
      recipient,
    });

    const response = await request.get('/api/reports/scheduled', {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      timeout: 120_000,
    });

    expect(response.status(), await response.text()).toBe(200);

    // This report's own outcome, not the job's totals. The endpoint runs
    // every report that is due, so `succeeded: 1, failed: 0` was really an
    // assertion that the database held exactly one due report — true of a
    // fresh CI database, false on the second local run, and order-dependent
    // the day any other spec seeds one.
    //
    // The row also says *why* when it fails, which the totals never could.
    const [row] = await readRows<{
      last_run_status: string | null;
      last_error: string | null;
    }>(
      'scheduled_reports',
      `id=eq.${reportId}&select=last_run_status,last_error`,
    );

    expect(row, 'the seeded report still exists').toBeTruthy();
    expect(row!.last_run_status, row!.last_error ?? 'no error recorded').toBe(
      'success',
    );

    const csv = await fetchDeliveredCsv(recipient);

    // Every title must be in the file first. Without this the loops below
    // pass over an empty list, which is how an assertion about "no zeros"
    // becomes an assertion about nothing.
    //
    // One row each: the file covers the report's weekly window, so only the
    // recent day of each video's history is in it — while the checkpoint
    // column it carries is computed over that video's whole life.
    for (const title of titles) {
      expect(checkpointCells(csv, title).length, `${title} is in the CSV`).toBe(
        1,
      );
    }

    // A measurement, and a measured zero. Both are figures and both belong.
    expect(checkpointCells(csv, 'Measured')).not.toContain('');
    expect(checkpointCells(csv, 'Measured')[0]).toBe('1000');
    expect(checkpointCells(csv, 'Real zero')[0]).toBe('0');

    // The two that have no figure. A `0` in either is the defect: it reads
    // as "nobody watched" when it means "this was never collected" and
    // "this can never be known".
    for (const cell of checkpointCells(csv, 'Late analytics')) {
      expect(cell, 'a window that closed before ingest began').toBe('');
    }

    for (const cell of checkpointCells(csv, 'Too young')) {
      expect(cell, 'a video younger than the checkpoint').toBe('');
    }
  });
});
