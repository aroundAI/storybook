import { Page, expect } from '@playwright/test';

import {
  insertRow,
  seedProject,
  seedTeamAccount,
  seedYouTubeConnection,
  serviceRoleAuth,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:55321';

/**
 * Channel experiments (FILM-1724).
 *
 * The create form has a field array, two controlled selects and a
 * checkbox group; the assignment form has two controlled selects whose
 * default is the table's suggestion and changes after every assignment.
 * Both are the shapes FILM-1609 found broken only on the *second*
 * submission, so the specs here always submit twice and read the rows back.
 */
export class ChannelExperimentsPage {
  constructor(private readonly page: Page) {}

  /** A team with one YouTube channel and a project, signed in, on the page. */
  async setup() {
    const team = await seedTeamAccount();
    const connectionId = await seedYouTubeConnection(
      team.accountId,
      'Styles Channel',
    );
    const project = await seedProject(team);

    await signInAs(this.page, team);
    await this.goTo(team.slug);

    return { ...team, connectionId, projectId: project.id };
  }

  async goTo(slug: string, experimentId?: string) {
    await this.page.goto(
      `/home/${slug}/studio/analytics/channel-experiments${experimentId ? `?experiment=${experimentId}` : ''}`,
    );
    await expect(byTest(this.page, 'ce-form')).toBeVisible();

    if (experimentId) {
      await expect(byTest(this.page, 'ce-detail')).toBeVisible();
    }
  }

  form() {
    return byTest(this.page, 'ce-form');
  }

  field(testId: string) {
    return byTest(this.form(), testId);
  }

  async choose(trigger: ReturnType<typeof byTest>, option: string) {
    await trigger.click();
    await byTest(this.page, option).click();
  }

  async fillStyles(names: string[]) {
    for (let index = 2; index < names.length; index++) {
      await this.field('ce-style-add').click();
    }

    for (const [index, name] of names.entries()) {
      await this.field(`ce-style-name-${index}`).fill(name);
    }
  }

  async submitAndWaitForReset() {
    await this.field('ce-submit').click();
    await expect(this.page.getByText('Experiment created')).toBeVisible();
    await expect(this.field('ce-title')).toHaveValue('');
  }

  detail() {
    return byTest(this.page, 'ce-detail');
  }

  inDetail(testId: string) {
    return byTest(this.detail(), testId);
  }

  async open(experimentId: string) {
    await byTest(this.page, `ce-row-${experimentId}`).click();
    await expect(this.detail()).toBeVisible();
  }

  /** Assigns through the form; `styleId` omitted keeps the suggestion. */
  async assign(publishId: string, styleId?: string) {
    const form = byTest(this.page, 'ce-assign-form');

    await this.choose(
      byTest(form, 'ce-assign-video'),
      `ce-assign-video-option-${publishId}`,
    );

    if (styleId) {
      await this.choose(
        byTest(form, 'ce-assign-style'),
        `ce-assign-style-option-${styleId}`,
      );
    }

    await byTest(form, 'ce-assign-submit').click();
  }

  /** The browser's own calendar day, which the page records dates in. */
  localToday() {
    return this.page.evaluate(() => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    });
  }
}

/** Midnight UTC `days` ago, as ISO. */
export function daysAgoIso(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(0, 0, 0, 0);

  return date.toISOString();
}

/**
 * A running experiment written with the service role: created by the same
 * function the page uses (so the 2–8 rule holds), then started on a past
 * date, which the page cannot do — it always starts today.
 */
export async function seedRunningChannelExperiment(input: {
  accountId: string;
  connectionId: string;
  title: string;
  styles: string[];
  measures: string[];
  startedAt: string;
}): Promise<{ id: string; styleIds: string[] }> {
  const key = serviceRoleAuth().key;
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/create_channel_experiment`,
    {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_account_id: input.accountId,
        p_connection_id: input.connectionId,
        p_format_family: 'long_horizontal',
        p_title: input.title,
        p_hypothesis: null,
        p_expected_outcome: null,
        p_measures: input.measures,
        p_time_zone: 'UTC',
        p_styles: input.styles.map((name) => ({ name })),
      }),
    },
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`create_channel_experiment failed: ${text}`);
  }

  const id = JSON.parse(text) as string;

  await updateRows('channel_experiments', `id=eq.${id}`, {
    status: 'running',
    started_at: input.startedAt,
  });

  const stylesResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/channel_experiment_styles?select=id&experiment_id=eq.${id}&order=sort_order`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  const styles = (await stylesResponse.json()) as Array<{ id: string }>;

  return { id, styleIds: styles.map((style) => style.id) };
}

/** An assignment written with the service role; the table still checks it. */
export async function seedAssignment(input: {
  experimentId: string;
  styleId: string;
  publishId: string;
  connectionId: string;
}) {
  await insertRow(
    'channel_experiment_videos',
    {
      experiment_id: input.experimentId,
      style_id: input.styleId,
      publish_id: input.publishId,
      connection_id: input.connectionId,
    },
    serviceRoleAuth(),
  );
}
