import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PROJECT_WRITE_REFUSAL } from '../src/lib/server/project-write-access';
import { ExternalContextAggregator } from '../src/lib/server/services/context-aggregator';
import {
  extractFactsFromContentAction,
  uploadSourceContentAction,
} from '../src/server/source-upload-actions';

/**
 * KB-26. Both research actions write into a project through a path RLS does
 * not guard (the admin client, or a queued Lambda job), so the action's own
 * check is the only thing between a caller and someone else's project.
 *
 * That check used to be "can the caller read the project", which every
 * signed-in user passes for a public or unlisted project. These tests pin the
 * replacement: `can_write_project` (an owner/admin/member row) must say yes,
 * and when it says no nothing is written and nothing is queued.
 */

const PROJECT = '550e8400-e29b-41d4-a716-446655440000';

type Call = { table: string; op: string; payload?: unknown; options?: unknown };

const state: {
  canWrite: boolean;
  rpcCalls: Array<{ fn: string; args: unknown }>;
  userWrites: Call[];
  adminCalls: Call[];
  queued: unknown[];
  sourceFilters: Array<[string, string, unknown]>;
} = {
  canWrite: false,
  rpcCalls: [],
  userWrites: [],
  adminCalls: [],
  queued: [],
  sourceFilters: [],
};

function recordingBuilder(calls: Call[], table: string) {
  const result = { data: { id: 'row-1' }, error: null };
  const builder = {
    upsert: (payload: unknown, options?: unknown) => {
      calls.push({ table, op: 'upsert', payload, options });
      return builder;
    },
    insert: (payload: unknown) => {
      calls.push({ table, op: 'insert', payload });
      return builder;
    },
    select: () => builder,
    single: async () => result,
    then: (resolve: (value: typeof result) => unknown) => resolve(result),
  };
  return builder;
}

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown, user: unknown) => unknown,
      options: { schema: { parse: (value: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options.schema.parse(data), { id: 'u1' }),
}));

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: async () => ({ data: { id: 'u1' }, error: null }),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    rpc: async (fn: string, args: unknown) => {
      state.rpcCalls.push({ fn, args });
      return { data: state.canWrite, error: null };
    },
    from: (table: string) => {
      // KB-31's `authorizeProjectTarget` reads the project for its account
      // after this file's gate, then asks `can_write_project` again.
      if (table === 'projects') {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({
            data: { id: PROJECT, account_id: 'account-1' },
            error: null,
          }),
        };
        return query;
      }
      if (table === 'external_sources') {
        const query = {
          select: () => query,
          eq: (column: string, value: unknown) => {
            state.sourceFilters.push(['eq', column, value]);
            return query;
          },
          is: (column: string, value: unknown) => {
            state.sourceFilters.push(['is', column, value]);
            return query;
          },
          then: (resolve: (value: { data: []; error: null }) => unknown) =>
            resolve({ data: [], error: null }),
        };
        return query;
      }
      return recordingBuilder(state.userWrites, table);
    },
  }),
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => ({
    from: (table: string) => recordingBuilder(state.adminCalls, table),
  }),
}));

vi.mock('@kit/prompt-engine/server', () => ({
  queueLlmJob: async (job: unknown) => {
    state.queued.push(job);
  },
}));

const upload = {
  name: 'Interview notes',
  content: 'CONFIDENTIAL draft',
  category: 'research' as const,
  projectId: PROJECT,
};

beforeEach(() => {
  state.canWrite = false;
  state.rpcCalls = [];
  state.userWrites = [];
  state.adminCalls = [];
  state.queued = [];
  state.sourceFilters = [];
});

describe('uploadSourceContentAction', () => {
  it('asks can_write_project about the requested project', async () => {
    await uploadSourceContentAction(upload);

    expect(state.rpcCalls).toEqual([
      { fn: 'can_write_project', args: { target_project_id: PROJECT } },
    ]);
  });

  it('refuses, as a value, a caller without a project_members row, and writes nothing', async () => {
    const result = await uploadSourceContentAction(upload);

    expect(result).toEqual({ ok: false, error: PROJECT_WRITE_REFUSAL });
    expect(state.adminCalls).toEqual([]);
  });

  it('writes both rows owned by the project, keyed per project', async () => {
    state.canWrite = true;

    const result = await uploadSourceContentAction(upload);

    expect(result.ok).toBe(true);

    const [source, content] = state.adminCalls;
    expect(source).toMatchObject({
      table: 'external_sources',
      op: 'upsert',
      payload: { slug: 'interview-notes', project_id: PROJECT },
      options: { onConflict: 'account_id,project_id,slug' },
    });
    expect(content).toMatchObject({
      table: 'external_content',
      op: 'insert',
      payload: { project_id: PROJECT, is_upload: true },
    });
  });
});

describe('extractFactsFromContentAction', () => {
  const short = {
    content: 'In 2024 the WHO reported 12 new cases in Geneva.',
    projectId: PROJECT,
    sourceTitle: 'Notes',
  };
  const long = { ...short, content: 'In 2024 Geneva saw growth. '.repeat(40) };

  it('refuses a reader of a public project: no facts inserted (short content)', async () => {
    const result = await extractFactsFromContentAction(short);

    expect(result).toEqual({ ok: false, error: PROJECT_WRITE_REFUSAL });
    expect(state.userWrites).toEqual([]);
  });

  it('refuses a reader of a public project: no extraction queued (long content)', async () => {
    const result = await extractFactsFromContentAction(long);

    expect(result).toEqual({ ok: false, error: PROJECT_WRITE_REFUSAL });
    expect(state.queued).toEqual([]);
  });

  it('inserts facts for a project member', async () => {
    state.canWrite = true;

    const result = await extractFactsFromContentAction(short);

    expect(result.ok).toBe(true);
    expect(state.userWrites).toMatchObject([
      { table: 'verified_facts', op: 'insert' },
    ]);
  });

  it('queues extraction for a project member', async () => {
    state.canWrite = true;

    await extractFactsFromContentAction(long);

    expect(state.queued.length).toBeGreaterThan(0);
  });
});

describe('ExternalContextAggregator.initialize', () => {
  it('loads built-ins only, never a team, project or pre-fix source (KB-37)', async () => {
    await new ExternalContextAggregator().initialize();

    expect(state.sourceFilters).toContainEqual(['eq', 'is_builtin', true]);
  });
});
