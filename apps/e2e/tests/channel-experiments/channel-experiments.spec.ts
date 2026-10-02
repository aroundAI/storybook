import { expect, test } from '@playwright/test';

import {
  readRows,
  seedPublishedEpisode,
  seedPublishedVideos,
  updateRows,
} from '../utils/seed';
import { byTest } from '../utils/visible';
import { ChannelExperimentsPage, daysAgoIso } from './channel-experiments.po';
import { EXPECTED, cell, seedResultsScenario } from './results-scenario';

interface ExperimentRow {
  id: string;
  title: string;
  format_family: string;
  measures: string[];
  status: string;
  hypothesis: string | null;
  channel_experiment_styles: Array<{ name: string; sort_order: number }>;
}

async function experimentsOf(accountId: string) {
  return readRows<ExperimentRow>(
    'channel_experiments',
    `select=id,title,format_family,measures,status,hypothesis,channel_experiment_styles(name,sort_order)&account_id=eq.${accountId}&order=created_at.asc`,
  );
}

test.describe('Channel experiments (FILM-1724)', () => {
  test('creates an experiment, resets, and creates a second with other values', async ({
    page,
  }) => {
    const po = new ChannelExperimentsPage(page);
    const team = await po.setup();

    await po.field('ce-title').fill('Mouth open or closed');
    await po.choose(
      po.field('ce-channel'),
      `ce-channel-option-${team.connectionId}`,
    );
    await po.fillStyles(['Mouth open', 'Mouth closed']);
    await po.field('ce-measure-ctr').click();
    await po.field('ce-hypothesis').fill('Open mouths get more clicks');
    await po.submitAndWaitForReset();

    // The state after the save: every field back to its default, the
    // selects included (Radix keeps a label across reset()).
    await expect(po.field('ce-style-name-0')).toHaveValue('');
    await expect(po.field('ce-style-name-2')).toHaveCount(0);
    await expect(po.field('ce-channel')).toHaveText('Choose a channel');
    await expect(po.field('ce-family')).toHaveText('Long-form (horizontal)');
    await expect(po.field('ce-measure-ctr')).toBeChecked();
    await expect(po.field('ce-hypothesis')).toHaveValue('');

    // Second submission: three styles, short-form, the hook measure.
    await po.field('ce-title').fill('Five thumbnail styles');
    await po.choose(
      po.field('ce-channel'),
      `ce-channel-option-${team.connectionId}`,
    );
    await po.choose(po.field('ce-family'), 'ce-family-option-short_vertical');
    await po.fillStyles(['Faces', 'Text', 'Product']);
    await po.field('ce-measure-hook_retention_3s').click();
    await po.submitAndWaitForReset();

    const rows = await experimentsOf(team.accountId);
    const byOrder = (row: ExperimentRow) =>
      [...row.channel_experiment_styles]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((style) => style.name);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: 'Mouth open or closed',
      format_family: 'long_horizontal',
      status: 'planned',
      hypothesis: 'Open mouths get more clicks',
    });
    expect(rows[0]!.measures.sort()).toEqual(
      ['avg_view_percentage', 'subscribers_per_1000_views', 'views'].sort(),
    );
    expect(byOrder(rows[0]!)).toEqual(['Mouth open', 'Mouth closed']);

    expect(rows[1]).toMatchObject({
      title: 'Five thumbnail styles',
      format_family: 'short_vertical',
      hypothesis: null,
    });
    expect(rows[1]!.measures).toContain('hook_retention_3s');
    expect(byOrder(rows[1]!)).toEqual(['Faces', 'Text', 'Product']);
  });

  test('refuses a blank or repeated style name, and writes nothing', async ({
    page,
  }) => {
    const po = new ChannelExperimentsPage(page);
    const team = await po.setup();

    await po.field('ce-title').fill('Bad styles');
    await po.choose(
      po.field('ce-channel'),
      `ce-channel-option-${team.connectionId}`,
    );
    await po.fillStyles(['Same', 'same']);
    await po.field('ce-submit').click();
    await expect(
      po.form().getByText('Each style needs its own name'),
    ).toBeVisible();

    await po.field('ce-style-name-1').fill('');
    await po.field('ce-submit').click();
    await expect(po.form().getByText('Name the style')).toBeVisible();

    expect(await experimentsOf(team.accountId)).toHaveLength(0);
  });

  test('starts, keeps the styles balanced, and records an override', async ({
    page,
  }) => {
    const po = new ChannelExperimentsPage(page);
    const team = await po.setup();

    await po.field('ce-title').fill('Mouth open or closed');
    await po.choose(
      po.field('ce-channel'),
      `ce-channel-option-${team.connectionId}`,
    );
    await po.fillStyles(['Mouth open', 'Mouth closed']);
    await po.submitAndWaitForReset();

    const [created] = await experimentsOf(team.accountId);
    const styles = await readRows<{ id: string; name: string }>(
      'channel_experiment_styles',
      `select=id,name&experiment_id=eq.${created!.id}&order=sort_order`,
    );
    const [open, closed] = styles as [
      { id: string; name: string },
      { id: string; name: string },
    ];

    // Uploads from today, which the start makes eligible.
    const { publishId: first } = await seedPublishedEpisode(
      team.projectId,
      team.connectionId,
      { number: 1, title: 'New upload 1' },
    );
    const { publishId: second } = await seedPublishedEpisode(
      team.projectId,
      team.connectionId,
      { number: 2, title: 'New upload 2' },
    );
    // Published before today: never offered, and refused by the table.
    const [old] = await seedPublishedVideos(
      team.projectId,
      team.connectionId,
      ['Older upload'],
      daysAgoIso(3),
    );

    await po.open(created!.id);
    await po.inDetail('ce-start').click();
    await expect(po.inDetail('ce-status')).toHaveText('running');

    const row = await readRows<{ started_at: string }>(
      'channel_experiments',
      `select=started_at&id=eq.${created!.id}`,
    );
    expect(row[0]!.started_at).toBe(await po.localToday());

    // The suggestion is the first style while both are empty.
    const assign = byTest(page, 'ce-assign-form');
    await expect(byTest(assign, 'ce-assign-style')).toHaveText(/Mouth open/);
    await byTest(assign, 'ce-assign-video').click();
    await expect(byTest(page, `ce-assign-video-option-${old}`)).toHaveCount(0);
    await page.keyboard.press('Escape');

    await po.assign(first);
    await expect(
      page.getByText('Assigned to the suggested style'),
    ).toBeVisible();

    // After the first assignment the form shows the new suggestion, not
    // the last choice, and no video chosen.
    await expect(byTest(assign, 'ce-assign-style')).toHaveText(/Mouth closed/);
    await expect(byTest(assign, 'ce-assign-video')).toHaveText(
      'Choose a video',
    );
    await expect(byTest(assign, 'ce-suggestion')).toContainText('Mouth closed');

    // Second submission: against the suggestion.
    await po.choose(
      byTest(assign, 'ce-assign-video'),
      `ce-assign-video-option-${second}`,
    );
    await po.choose(
      byTest(assign, 'ce-assign-style'),
      `ce-assign-style-option-${open.id}`,
    );
    await expect(byTest(assign, 'ce-override-note')).toBeVisible();
    await byTest(assign, 'ce-assign-submit').click();
    await expect(
      page.getByText('Assigned — recorded as chosen over the suggestion'),
    ).toBeVisible();
    await expect(po.inDetail(`ce-video-overridden-${second}`)).toBeVisible();

    const assigned = await readRows<{
      publish_id: string;
      style_id: string;
      suggested_style_id: string;
      overridden: boolean;
    }>(
      'channel_experiment_videos',
      `select=publish_id,style_id,suggested_style_id,overridden&experiment_id=eq.${created!.id}`,
    );
    const byPublish = new Map(assigned.map((a) => [a.publish_id, a]));

    expect(byPublish.get(first)).toMatchObject({
      style_id: open.id,
      suggested_style_id: open.id,
      overridden: false,
    });
    expect(byPublish.get(second)).toMatchObject({
      style_id: open.id,
      suggested_style_id: closed.id,
      overridden: true,
    });
    await expect(po.inDetail(`ce-style-count-${open.id}`)).toHaveText('(2)');

    // A video younger than its first checkpoint can still come out.
    await po.inDetail(`ce-video-remove-${second}`).click();
    await expect(po.inDetail(`ce-video-${second}`)).toHaveCount(0);
    await expect(po.inDetail(`ce-style-count-${open.id}`)).toHaveText('(1)');
  });

  test('a refusal from the table reaches the user in a production build', async ({
    page,
  }) => {
    const po = new ChannelExperimentsPage(page);
    const team = await po.setup();

    await po.field('ce-title').fill('Concluded elsewhere');
    await po.choose(
      po.field('ce-channel'),
      `ce-channel-option-${team.connectionId}`,
    );
    await po.fillStyles(['A', 'B']);
    await po.submitAndWaitForReset();

    const [created] = await experimentsOf(team.accountId);
    const { publishId: video } = await seedPublishedEpisode(
      team.projectId,
      team.connectionId,
      { number: 1, title: 'Upload' },
    );

    await po.open(created!.id);
    await po.inDetail('ce-start').click();
    await expect(po.inDetail('ce-status')).toHaveText('running');

    // Another tab concludes it while this one still offers assignment.
    await updateRows('channel_experiments', `id=eq.${created!.id}`, {
      status: 'concluded',
      ended_at: await po.localToday(),
      conclusion: 'Concluded in another tab',
      outcome_status: 'inconclusive',
      result_snapshot: {
        version: 1,
        asOf: new Date().toISOString(),
        results: [],
      },
    });

    await po.assign(video);

    await expect(byTest(page, 'ce-assign-error')).toHaveText(
      'Videos are assigned only while the experiment is running; this one is concluded',
    );
  });

  test('shows each style at the same age, with no verdict until each has enough', async ({
    page,
  }) => {
    test.skip(
      !process.env.CLICKHOUSE_EVIDENCE,
      'Set CLICKHOUSE_EVIDENCE=1 with a server reading the local ClickHouse.',
    );

    const po = new ChannelExperimentsPage(page);
    const scenario = await seedResultsScenario(page, po);
    const { open, closed } = scenario;

    await expect(byTest(page, 'ce-evidence')).toHaveAttribute(
      'data-evidence',
      'association',
    );

    // Four "open" videos measured: no verdict, and the shortfall named.
    await expect(byTest(page, 'ce-verdict-views-7')).toContainText(
      'Mouth open needs 1 more',
    );
    await expect(cell(page, 'views', 7, open, 'median')).toHaveText(
      EXPECTED.thinOpenMedian,
    );
    await expect(cell(page, 'views', 7, open, 'measured')).toHaveText('4');
    // The two-day-old video is pending, not a zero.
    await expect(cell(page, 'views', 7, closed, 'pending')).toHaveText('1');
    await expect(cell(page, 'views', 7, closed, 'measured')).toHaveText('5');
    await expect(cell(page, 'views', 7, open, 'confidence')).toHaveText(
      'too few',
    );

    // The table suggests "open" (fewest videos); assign the fifth there.
    await expect(byTest(page, 'ce-assign-style')).toHaveText(/Mouth open/);
    await po.assign(scenario.fifthOpen);
    await expect(
      page.getByText('Assigned to the suggested style'),
    ).toBeVisible();

    await expect(cell(page, 'views', 7, open, 'median')).toHaveText(
      EXPECTED.open7.median,
    );
    await expect(cell(page, 'views', 7, open, 'range')).toHaveText(
      EXPECTED.open7.range,
    );
    await expect(cell(page, 'views', 7, closed, 'median')).toHaveText(
      EXPECTED.closed7.median,
    );
    await expect(cell(page, 'views', 7, closed, 'range')).toHaveText(
      EXPECTED.closed7.range,
    );
    await expect(byTest(page, 'ce-verdict-views-7')).toContainText(
      'Mouth closed is ahead of Mouth open',
    );

    // At 30 days the medians differ but the ranges overlap.
    await expect(cell(page, 'views', 30, open, 'median')).toHaveText(
      EXPECTED.open30.median,
    );
    await expect(cell(page, 'views', 30, closed, 'range')).toHaveText(
      EXPECTED.closed30.range,
    );
    await expect(byTest(page, 'ce-verdict-views-30')).toContainText(
      'No clear difference yet',
    );

    await expect(cell(page, 'ctr', 7, open, 'median')).toHaveText(
      EXPECTED.openCtr,
    );
    await expect(cell(page, 'ctr', 7, closed, 'median')).toHaveText(
      EXPECTED.closedCtr,
    );

    // Conclude: the results freeze and the page may now speak of cause.
    await po
      .inDetail('ce-conclusion-input')
      .fill('Closed mouths win at 7 days');
    await po.inDetail('ce-conclude-confirmed').click();
    await expect(po.inDetail('ce-status')).toHaveText('concluded');
    await expect(byTest(page, 'ce-evidence')).toHaveAttribute(
      'data-evidence',
      'concluded_experiment',
    );
    await expect(cell(page, 'views', 7, closed, 'median')).toHaveText(
      EXPECTED.closed7.median,
    );

    const [row] = await readRows<{ result_snapshot: { results: unknown[] } }>(
      'channel_experiments',
      `select=result_snapshot&id=eq.${scenario.experimentId}`,
    );
    expect(row!.result_snapshot.results).toHaveLength(3);
  });
});
