import { type Page, expect, test } from '@playwright/test';

import {
  insertRow,
  readRows,
  seedExperiment,
  seedTeamAccount,
  serviceRoleAuth,
  uniqueStamp,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import { ExperimentsPageObject } from './experiments.po';

/**
 * Managing a Change log entry (KB-7) and the two FILM-1509 items that live
 * in the same UI: tags and the status filter.
 *
 * The edit form is the FILM-1609 shape again — a form reused across records
 * — so the guard edits one change and then another, and reads both rows
 * back: a form that kept the first change's values would save them onto
 * the second. Refusals are asserted by their wording, which ⚫️ Test checks
 * on a production build (a thrown message would be replaced there).
 */

interface ChangeRow {
  id: string;
  title: string;
  status: string;
  category: string | null;
  metric_watched: string | null;
  review_window_days: number;
  notes: string | null;
  actual_outcome: string | null;
  outcome_status: string;
  ended_at: string | null;
  baseline_metrics: unknown;
}

const COLUMNS =
  'id,title,status,category,metric_watched,review_window_days,notes,actual_outcome,outcome_status,ended_at,baseline_metrics';

async function readChange(id: string) {
  const [row] = await readRows<ChangeRow>(
    'analytics_experiments',
    `select=${COLUMNS}&id=eq.${id}`,
  );
  return row;
}

async function linkedTags(id: string) {
  const rows = await readRows<{ tag_id: string }>(
    'experiment_tags',
    `select=tag_id&experiment_id=eq.${id}`,
  );
  return rows.map((row) => row.tag_id).sort();
}

async function linkedVideos(id: string) {
  const rows = await readRows<{ publish_id: string }>(
    'experiment_publishes',
    `select=publish_id&experiment_id=eq.${id}`,
  );
  return rows.map((row) => row.publish_id).sort();
}

async function seedTag(accountId: string, label: string) {
  const row = await insertRow<{ id: string }>(
    'content_tags',
    {
      account_id: accountId,
      dimension: 'topic',
      slug: `${label.toLowerCase().replace(/\W+/g, '-')}-${uniqueStamp()}`,
      label,
    },
    serviceRoleAuth(),
  );
  return row.id;
}

/** A change seeded with its wording, links and tags, as a user left it. */
async function seedChange(
  accountId: string,
  options: {
    title: string;
    status?: 'planned' | 'running' | 'concluded' | 'abandoned';
    startedAt?: string;
    metricWatched?: string;
    reviewWindowDays?: number;
    fields?: Record<string, unknown>;
    publishIds?: string[];
    tagIds?: string[];
  },
) {
  const id = await seedExperiment(accountId, options);

  if (options.fields) {
    await updateRows('analytics_experiments', `id=eq.${id}`, options.fields);
  }
  for (const publishId of options.publishIds ?? []) {
    await insertRow(
      'experiment_publishes',
      { experiment_id: id, publish_id: publishId },
      serviceRoleAuth(),
    );
  }
  for (const tagId of options.tagIds ?? []) {
    await insertRow(
      'experiment_tags',
      { experiment_id: id, tag_id: tagId },
      serviceRoleAuth(),
    );
  }

  return id;
}

/**
 * Waits for an abandon to land: the confirmation closes and the dialog's
 * badge reads abandoned. Not the toast — an earlier one may still be up.
 */
async function expectAbandoned(page: Page) {
  await expect(byTest(page, 'experiment-abandon-dialog')).toHaveCount(0);
  await expect(
    page.locator('[role="dialog"]').getByText('abandoned', { exact: true }),
  ).toBeVisible();
}

function daysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

test.describe('Editing a change (KB-7)', () => {
  test("editing one change and then another saves each its own values, not the first one's", async ({
    page,
  }) => {
    const log = new ExperimentsPageObject(page);
    const team = await log.setup();
    const [firstVideo, secondVideo] = team.publishIds;
    const cooking = await seedTag(team.accountId, 'Cooking');
    const travel = await seedTag(team.accountId, 'Travel');

    const a = await seedChange(team.accountId, {
      title: 'Change A',
      metricWatched: 'ctr',
      reviewWindowDays: 30,
      fields: { category: 'packaging', notes: 'a notes' },
      publishIds: [firstVideo],
      tagIds: [cooking],
    });
    const b = await seedChange(team.accountId, {
      title: 'Change B',
      publishIds: [secondVideo],
      tagIds: [travel],
    });
    await page.reload();

    // A: the form shows A's stored values; change the title, window and tags.
    await log.edit(a);
    await expect(log.editField('experiment-title')).toHaveValue('Change A');
    await expect(log.editField('experiment-metric')).toHaveText(
      'Impressions click-through rate',
    );
    await expect(log.editField('experiment-category')).toHaveText(
      'Packaging (title, thumbnail)',
    );
    await expect(log.editField('experiment-review-window')).toHaveValue('30');
    // A linked video shows as linked even though the form opened on it.
    await expect(log.editField('video-picker-trigger')).not.toHaveText(
      'Choose videos',
    );
    // Nothing changed yet, so there is nothing to save.
    await expect(log.editField('experiment-edit-save')).toBeDisabled();

    await log.editField('experiment-title').fill('Change A, edited');
    await log.editField('experiment-review-window').fill('45');
    await log.linkTag(travel, log.editForm());
    await log.saveEdit();
    await expect(
      page.getByRole('heading', { name: 'Change A, edited' }),
    ).toBeVisible();
    await log.closeDialog();

    // B, second: every field must be B's, none left over from A.
    await log.edit(b);
    await expect(log.editField('experiment-title')).toHaveValue('Change B');
    await expect(log.editField('experiment-metric')).toHaveText(
      'No specific metric',
    );
    await expect(log.editField('experiment-category')).toHaveText(
      'No category',
    );
    await expect(log.editField('experiment-review-window')).toHaveValue('60');
    await expect(log.editField('experiment-notes')).toHaveValue('');

    await log.editField('experiment-notes').fill('b notes');
    await log.editField('experiment-category').click();
    await page
      .locator('[data-test="experiment-category-option-format"]')
      .click();
    await log.saveEdit();

    expect(await readChange(a)).toMatchObject({
      title: 'Change A, edited',
      category: 'packaging',
      metric_watched: 'ctr',
      review_window_days: 45,
      notes: 'a notes',
    });
    expect(await readChange(b)).toMatchObject({
      title: 'Change B',
      category: 'format',
      metric_watched: null,
      review_window_days: 60,
      notes: 'b notes',
    });
    expect(await linkedTags(a)).toEqual([cooking, travel].sort());
    expect(await linkedTags(b)).toEqual([travel]);
    expect(await linkedVideos(a)).toEqual([firstVideo]);
    expect(await linkedVideos(b)).toEqual([secondVideo]);
  });

  test('a started change locks what its baseline measured, and still saves its wording', async ({
    page,
  }) => {
    const log = new ExperimentsPageObject(page);
    const team = await log.setup();
    const baseline = { capturedAt: '2026-09-01T00:00:00Z', publishCount: 1 };
    const id = await seedChange(team.accountId, {
      title: 'Running change',
      status: 'running',
      startedAt: daysAgo(5),
      metricWatched: 'ctr',
      fields: { hypothesis: 'Faces lift CTR', baseline_metrics: baseline },
      publishIds: [team.publishIds[0]],
    });
    await page.reload();

    await log.edit(id);
    await expect(log.editField('experiment-frozen-note')).toBeVisible();
    for (const locked of [
      'experiment-metric',
      'experiment-review-window',
      'video-picker-trigger',
      'experiment-hypothesis',
      'experiment-expected',
    ]) {
      await expect(log.editField(locked)).toBeDisabled();
    }
    for (const open of [
      'experiment-title',
      'experiment-change',
      'experiment-notes',
    ]) {
      await expect(log.editField(open)).toBeEnabled();
    }

    await log.editField('experiment-title').fill('Running change, retitled');
    await log.saveEdit();

    expect(await readChange(id)).toMatchObject({
      title: 'Running change, retitled',
      status: 'running',
      metric_watched: 'ctr',
      review_window_days: 60,
      baseline_metrics: baseline,
    });
  });

  test('an edit refused because the change started in another tab says why', async ({
    page,
  }) => {
    const log = new ExperimentsPageObject(page);
    const team = await log.setup();
    const id = await seedChange(team.accountId, { title: 'Stale edit' });
    await page.reload();

    await log.edit(id);
    await log.editField('experiment-metric').click();
    await byTest(page, 'experiment-metric-option-ctr').click();

    // Another tab starts it while this form still believes it is planned.
    await updateRows('analytics_experiments', `id=eq.${id}`, {
      status: 'running',
      started_at: daysAgo(0),
    });

    await log.editField('experiment-edit-save').click();
    await expect(log.editField('experiment-form-error')).toHaveText(
      'metricWatched cannot change once the change has started: the baseline was measured over them, and the expectation was recorded before the result.',
    );
    expect((await readChange(id))?.metric_watched).toBeNull();
  });
});

test.describe('Abandoning a change (KB-7)', () => {
  test('a planned and a running change are abandoned with the reason and the local date', async ({
    page,
  }) => {
    const log = new ExperimentsPageObject(page);
    const team = await log.setup();
    const planned = await seedChange(team.accountId, { title: 'Planned' });
    const running = await seedChange(team.accountId, {
      title: 'Running, overdue',
      status: 'running',
      startedAt: daysAgo(90),
      reviewWindowDays: 30,
    });
    await page.reload();
    await expect(byTest(page, `experiment-due-${running}`)).toBeVisible();
    const today = await log.localToday();

    await log.open(planned);
    await log.dialogButton('experiment-abandon').click();
    await page
      .locator('[data-test="experiment-abandon-reason"]')
      .fill('Logged by mistake');
    await byTest(page, 'experiment-abandon-confirm').click();
    await expectAbandoned(page);
    // Once abandoned: no Abandon, but Delete is offered (planned or abandoned).
    await expect(log.dialogButton('experiment-abandon')).toHaveCount(0);
    await expect(log.dialogButton('experiment-delete')).toBeVisible();
    await log.closeDialog();

    expect(await readChange(planned)).toMatchObject({
      status: 'abandoned',
      actual_outcome: 'Logged by mistake',
      outcome_status: 'inconclusive',
      ended_at: today,
    });

    // The second abandon, with no reason, must not carry the first's.
    await log.open(running);
    await log.dialogButton('experiment-abandon').click();
    await expect(byTest(page, 'experiment-abandon-reason')).toHaveValue('');
    await byTest(page, 'experiment-abandon-confirm').click();
    await expectAbandoned(page);
    await log.closeDialog();

    expect(await readChange(running)).toMatchObject({
      status: 'abandoned',
      actual_outcome: null,
      outcome_status: 'inconclusive',
      ended_at: today,
    });
    // It is no longer waiting for review.
    await expect(byTest(page, `experiment-due-${running}`)).toHaveCount(0);
    await expect(byTest(page, `experiment-row-${running}`)).toContainText(
      'abandoned',
    );
  });
});

test.describe('Deleting a change (KB-7, only while planned or abandoned)', () => {
  test('a planned change is deleted after confirming, and kept on cancel', async ({
    page,
  }) => {
    const log = new ExperimentsPageObject(page);
    const team = await log.setup();
    const id = await seedChange(team.accountId, {
      title: 'Logged twice',
      publishIds: [team.publishIds[0]],
    });
    await page.reload();

    await log.open(id);
    await log.dialogButton('experiment-delete').click();
    await byTest(page, 'experiment-delete-cancel').click();
    expect(await readChange(id)).toBeDefined();

    await log.dialogButton('experiment-delete').click();
    await byTest(page, 'experiment-delete-confirm').click();
    await expect(page.getByText('Change deleted')).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expect(byTest(page, `experiment-row-${id}`)).toHaveCount(0);

    expect(await readChange(id)).toBeUndefined();
    expect(await linkedVideos(id)).toEqual([]);
  });

  test('a running or concluded change offers no Delete', async ({ page }) => {
    const log = new ExperimentsPageObject(page);
    const team = await log.setup();
    const running = await seedChange(team.accountId, {
      title: 'Running',
      status: 'running',
      startedAt: daysAgo(3),
    });
    const concluded = await seedChange(team.accountId, {
      title: 'Concluded',
      status: 'concluded',
      startedAt: daysAgo(40),
      fields: { ended_at: daysAgo(1), outcome_status: 'confirmed' },
    });
    const abandoned = await seedChange(team.accountId, {
      title: 'Abandoned',
      status: 'abandoned',
      fields: { ended_at: daysAgo(1), outcome_status: 'inconclusive' },
    });
    await page.reload();

    for (const [id, deletable] of [
      [running, false],
      [concluded, false],
      [abandoned, true],
    ] as const) {
      await log.open(id);
      await expect(log.dialogButton('experiment-delete')).toHaveCount(
        deletable ? 1 : 0,
      );
      await log.closeDialog();
    }
  });

  test('a delete refused because the change started in another tab says why, and keeps it', async ({
    page,
  }) => {
    const log = new ExperimentsPageObject(page);
    const team = await log.setup();
    const id = await seedChange(team.accountId, { title: 'Started elsewhere' });
    await page.reload();

    await log.open(id);
    await log.dialogButton('experiment-delete').click();

    await updateRows('analytics_experiments', `id=eq.${id}`, {
      status: 'running',
      started_at: daysAgo(0),
    });

    await byTest(page, 'experiment-delete-confirm').click();
    await expect(byTest(page, 'experiment-confirm-error')).toHaveText(
      'Only a planned or abandoned change can be deleted; this one is running. Abandon it first to stop it and keep its record.',
    );
    expect((await readChange(id))?.status).toBe('running');

    // The refusal says the change moved on; the dialog must show where to,
    // not keep offering the planned change's Start and Delete.
    await page.keyboard.press('Escape');
    await expect(byTest(page, 'experiment-delete-dialog')).toHaveCount(0);
    await expect(
      page.locator('[role="dialog"]').getByText('running', { exact: true }),
    ).toBeVisible();
    await expect(log.dialogButton('experiment-delete')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Start', exact: true }),
    ).toHaveCount(0);
  });
});

test.describe('Filtering by status (FILM-1509 → FILM-1610)', () => {
  test('lists only the chosen status, keeps it across a reload, and says when none match', async ({
    page,
  }) => {
    const team = await seedTeamAccount();
    const ids = {
      planned: await seedChange(team.accountId, { title: 'P' }),
      running: await seedChange(team.accountId, {
        title: 'R',
        status: 'running',
        startedAt: daysAgo(2),
      }),
      concluded: await seedChange(team.accountId, {
        title: 'C',
        status: 'concluded',
        startedAt: daysAgo(40),
        fields: { ended_at: daysAgo(1), outcome_status: 'confirmed' },
      }),
    };

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/analytics/experiments`);
    const row = (id: string) => byTest(page, `experiment-row-${id}`);
    await expect(row(ids.planned)).toBeVisible();

    await byTest(page, 'experiment-status-filter').click();
    await page
      .locator('[data-test="experiment-status-option-running"]')
      .click();
    await expect(page).toHaveURL(/[?&]status=running\b/);
    await expect(row(ids.running)).toBeVisible();
    await expect(row(ids.planned)).toHaveCount(0);
    await expect(row(ids.concluded)).toHaveCount(0);

    await page.reload();
    await expect(byTest(page, 'experiment-status-filter')).toHaveText(
      /running/i,
    );
    await expect(row(ids.running)).toBeVisible();
    await expect(row(ids.planned)).toHaveCount(0);

    // Filtered to a status with no changes: not "No changes logged yet".
    await byTest(page, 'experiment-status-filter').click();
    await page
      .locator('[data-test="experiment-status-option-abandoned"]')
      .click();
    await expect(byTest(page, 'experiment-list-filtered-empty')).toHaveText(
      /No abandoned changes/,
    );
    await expect(page.getByText('No changes logged yet')).toHaveCount(0);

    await byTest(page, 'experiment-list-show-all').click();
    await expect(page).not.toHaveURL(/status=/);
    for (const id of Object.values(ids)) await expect(row(id)).toBeVisible();
  });
});

test.describe('Tags on a change (FILM-1509 → FILM-1610)', () => {
  test('the second change logged links only its own tags', async ({ page }) => {
    const log = new ExperimentsPageObject(page);
    const team = await log.setup();
    const cooking = await seedTag(team.accountId, 'Cooking');
    const travel = await seedTag(team.accountId, 'Travel');
    await page.reload();
    await expect(log.form()).toBeVisible();

    await log.field('experiment-title').fill('First, tagged');
    await log.field('experiment-change').fill('New thumbnails');
    await log.linkTag(cooking);
    await log.submitAndWaitForReset();
    // After the reset the picker must look empty too.
    await expect(
      byTest(log.field('experiment-tags'), 'tag-picker-trigger'),
    ).toHaveText('Add tags');

    await log.field('experiment-title').fill('Second, tagged');
    await log.field('experiment-change').fill('New titles');
    await log.linkTag(travel);
    await log.submitAndWaitForReset();

    const rows = await readRows<{ id: string; title: string }>(
      'analytics_experiments',
      `select=id,title&account_id=eq.${team.accountId}&order=created_at.asc`,
    );
    expect(rows.map((row) => row.title)).toEqual([
      'First, tagged',
      'Second, tagged',
    ]);
    expect(await linkedTags(rows[0]!.id)).toEqual([cooking]);
    expect(await linkedTags(rows[1]!.id)).toEqual([travel]);

    await log.open(rows[1]!.id);
    await expect(
      page.locator('[role="dialog"] [data-test="experiment-detail-tags"]'),
    ).toHaveText('Travel');
  });
});
