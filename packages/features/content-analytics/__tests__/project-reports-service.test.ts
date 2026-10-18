import { describe, expect, it, vi } from 'vitest';

import { saveProjectReport } from '../src/server/project-reports-service';

/**
 * FILM-1735. Two jobs saving one project's day at the same moment: both
 * read "none", both insert, and the unique key refuses the second. It must
 * answer with the first job's report, not an error and not its own text.
 */

vi.mock('server-only', () => ({}));

const first = {
  id: 'r1',
  account_id: 'team',
  project_id: 'project',
  report_date: '2026-10-17',
  timezone: 'UTC',
  digest_hash: 'a'.repeat(64),
  body_md: '# First',
  summary: {},
  model: 'first-model',
  mcp_connection_id: null,
  created_by: 'u',
  created_at: '2026-10-18T02:00:00.000Z',
};

function racingClient() {
  let reads = 0;
  const inserts: unknown[] = [];

  const client = {
    inserts,
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        // First read: nothing yet. After the refused insert: the winner's row
        maybeSingle: async () => ({
          data: reads++ === 0 ? null : first,
          error: null,
        }),
        insert: (row: unknown) => {
          inserts.push(row);
          return {
            select: () => ({
              single: async () => ({
                data: null,
                error: { code: '23505', message: 'duplicate key' },
              }),
            }),
          };
        },
      };
      return chain;
    },
  };

  return client;
}

describe('saveProjectReport', () => {
  it('answers a save that lost the race with the winner’s report', async () => {
    const client = racingClient();

    const result = await saveProjectReport(client as never, {
      accountId: 'team',
      projectId: 'project',
      date: '2026-10-17',
      timezone: 'UTC',
      digestHash: 'b'.repeat(64),
      bodyMd: '# Second',
      summary: {},
      model: 'second-model',
      mcpConnectionId: null,
    });

    expect(client.inserts).toHaveLength(1);
    expect(result).toMatchObject({
      status: 'exists',
      report: { bodyMd: '# First', model: 'first-model' },
    });
  });
});
