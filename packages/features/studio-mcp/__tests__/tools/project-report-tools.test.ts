import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type FakeDb,
  callTool,
  contextFor,
  fakeClient,
} from '../helpers/fake-postgrest';

/**
 * FILM-1735. The morning report's three tools: the first save of a
 * project's day is kept, a later save changes nothing and hands back the
 * saved text, and the reads return it. Another team's project is refused
 * in analytics-forbidden.test.ts.
 */

vi.mock('server-only', () => ({}));

const TEAM = '00000000-0000-4000-8000-0000000000a1';
const PROJECT = '00000000-0000-4000-8000-0000000000b1';
const SAVED = '00000000-0000-4000-8000-000000000d01';

const savedRow = {
  id: SAVED,
  account_id: TEAM,
  project_id: PROJECT,
  report_date: '2026-10-17',
  timezone: 'Asia/Kolkata',
  digest_hash: 'a'.repeat(64),
  body_md: '# The first job’s report',
  summary: { headline: 'Two videos out', dataThrough: { youtube: '2026-10-15' } },
  model: 'claude-opus-5-5',
  mcp_connection_id: null,
  created_by: '00000000-0000-4000-8000-00000000u001',
  created_at: '2026-10-18T02:00:00.000Z',
};

function database(reports: Array<typeof savedRow> = []): FakeDb {
  return {
    projects: [{ id: PROJECT, account_id: TEAM, name: 'P', status: 'active' }],
    project_daily_reports: reports,
  };
}

let tools: Awaited<
  typeof import('../../src/server/tools/analytics')
>['analyticsTools'];

beforeEach(async () => {
  ({ analyticsTools: tools } = await import(
    '../../src/server/tools/analytics'
  ));
});

function setup(db: FakeDb) {
  const client = fakeClient(db, {
    rpc: {
      has_account_access: (args: Record<string, unknown>) =>
        args.p_account_id === TEAM,
    },
  });

  return { client, context: contextFor(client, { id: TEAM, slug: 'team' }) };
}

const save = {
  projectId: PROJECT,
  date: '2026-10-17',
  timezone: 'Asia/Kolkata',
  digestHash: 'b'.repeat(64),
  bodyMd: '# A second job’s report',
  model: 'other-model',
};

describe('save_project_report', () => {
  it('saves the day’s first report as the team’s, over this connection', async () => {
    const { client, context } = setup(database());

    const result = await callTool(tools, 'save_project_report', save, context);

    expect(result.structuredContent).toMatchObject({
      status: 'saved',
      report: { date: '2026-10-17', bodyMd: save.bodyMd },
    });
    const insert = client.writes.find(
      (w) => w.table === 'project_daily_reports' && w.op === 'insert',
    );
    expect(insert?.payload).toEqual({
      account_id: TEAM,
      project_id: PROJECT,
      report_date: '2026-10-17',
      timezone: 'Asia/Kolkata',
      digest_hash: save.digestHash,
      body_md: save.bodyMd,
      summary: {},
      model: 'other-model',
      mcp_connection_id: context.principal.connectionId,
    });
  });

  it('a second save of the day writes nothing and returns the first report unchanged', async () => {
    const { client, context } = setup(database([savedRow]));

    const result = await callTool(tools, 'save_project_report', save, context);

    expect(result.structuredContent).toEqual({
      status: 'exists',
      report: {
        id: SAVED,
        projectId: PROJECT,
        date: '2026-10-17',
        timezone: 'Asia/Kolkata',
        digestHash: 'a'.repeat(64),
        bodyMd: '# The first job’s report',
        summary: {
          headline: 'Two videos out',
          dataThrough: { youtube: '2026-10-15' },
        },
        model: 'claude-opus-5-5',
        createdAt: '2026-10-18T02:00:00.000Z',
        mcpConnectionId: null,
      },
    });
    expect(result.text).toMatch(/already saved.*unchanged/);
    expect(client.writes).toEqual([]);
  });

  it('refuses what the table would: a zone it cannot read, an oversized text, an unknown summary field', async () => {
    const { client, context } = setup(database());

    for (const bad of [
      { timezone: 'Mars/Olympus' },
      { bodyMd: 'x'.repeat(40_001) },
      { digestHash: 'not-a-hash' },
      { date: '2026-13-01' },
      { summary: { score: 9 } },
    ]) {
      await expect(
        callTool(tools, 'save_project_report', { ...save, ...bad }, context),
        JSON.stringify(bad).slice(0, 60),
      ).rejects.toThrow();
    }
    expect(client.writes).toEqual([]);
  });

  it('is a write, idempotent: a repeat changes nothing', () => {
    const tool = tools.find((t) => t.name === 'save_project_report')!;

    expect(tool.scope).toBe('studio:write');
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
  });
});

describe('get_project_report and list_project_reports', () => {
  it('reads the saved report, and null for a day with none', async () => {
    const { context } = setup(database([savedRow]));

    const found = await callTool(
      tools,
      'get_project_report',
      { projectId: PROJECT, date: '2026-10-17' },
      context,
    );
    const none = await callTool(
      tools,
      'get_project_report',
      { projectId: PROJECT, date: '2026-10-16' },
      context,
    );

    expect(
      (found.structuredContent as { report: { bodyMd: string } }).report
        .bodyMd,
    ).toBe('# The first job’s report');
    expect(none.structuredContent).toEqual({ report: null });
  });

  it('lists the days without their text, and refuses a reversed or too-long span', async () => {
    const { context } = setup(database([savedRow]));

    const listed = await callTool(
      tools,
      'list_project_reports',
      { projectId: PROJECT, from: '2026-10-01', to: '2026-10-18' },
      context,
    );
    const reports = (
      listed.structuredContent as { reports: Array<Record<string, unknown>> }
    ).reports;

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ date: '2026-10-17', chars: 24 });
    expect(reports[0]).not.toHaveProperty('bodyMd');

    await expect(
      callTool(
        tools,
        'list_project_reports',
        { projectId: PROJECT, from: '2026-10-18', to: '2026-10-01' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      callTool(
        tools,
        'list_project_reports',
        { projectId: PROJECT, from: '2026-01-01', to: '2026-10-18' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
