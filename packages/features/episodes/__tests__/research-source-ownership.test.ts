import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PROJECT_SOURCE_REFUSAL,
  SOURCE_EXISTS_REFUSAL,
  SOURCE_REMOVE_REFUSAL,
  TEAM_SOURCE_REFUSAL,
} from '../src/lib/research-source-refusals';
import {
  addExternalSourceAction,
  deleteExternalSourceAction,
} from '../src/server/external-context-actions';

/**
 * KB-37. The research-source actions used to check "is the caller an owner
 * of any account" and then write with the admin client, by bare id, so any
 * signed-in user (one `create_team_account` away from being an owner) could
 * add to, edit or deactivate the registry every team sees, and deactivate
 * another project's source. They now write through the caller's own client,
 * so RLS decides; the action checks first only to say why, as a value.
 */

const PROJECT = '550e8400-e29b-41d4-a716-446655440000';
const TEAM = '660e8400-e29b-41d4-a716-446655440000';
const SOURCE = '770e8400-e29b-41d4-a716-446655440000';

type Write = {
  table: string;
  op: string;
  payload?: unknown;
  filters: Array<[string, unknown]>;
};

const state: {
  canWrite: boolean;
  teamOwner: boolean;
  rpcCalls: Array<{ fn: string; args: unknown }>;
  writes: Write[];
  writeResult: { data: unknown; error: unknown };
  adminUsed: boolean;
} = {
  canWrite: false,
  teamOwner: false,
  rpcCalls: [],
  writes: [],
  writeResult: { data: null, error: null },
  adminUsed: false,
};

vi.mock('@kit/next/actions', () => ({
  enhanceAction:
    (
      handler: (data: unknown, user: unknown) => unknown,
      options: { schema: { parse: (value: unknown) => unknown } },
    ) =>
    (data: unknown) =>
      handler(options.schema.parse(data), { id: 'u1' }),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
    },
    rpc: async (fn: string, args: unknown) => {
      state.rpcCalls.push({ fn, args });
      if (fn === 'can_write_project') {
        return { data: state.canWrite, error: null };
      }
      if (fn === 'has_role_on_account') {
        return { data: state.teamOwner, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
    from: (table: string) => {
      if (table === 'projects') {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({
            data: { id: PROJECT, account_id: TEAM },
            error: null,
          }),
        };
        return query;
      }

      const write: Write = { table, op: 'select', filters: [] };
      state.writes.push(write);
      const builder = {
        insert: (payload: unknown) => {
          write.op = 'insert';
          write.payload = payload;
          return builder;
        },
        update: (payload: unknown) => {
          write.op = 'update';
          write.payload = payload;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          write.filters.push([column, value]);
          return builder;
        },
        select: () => builder,
        single: async () => state.writeResult,
        then: (resolve: (value: unknown) => unknown) =>
          resolve(state.writeResult),
      };
      return builder;
    },
  }),
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => {
    state.adminUsed = true;
    throw new Error('the admin client must not be used for source writes');
  },
}));

vi.mock('../src/lib/server/services/context-aggregator', () => ({
  getContextAggregator: vi.fn(),
  rowToExternalContent: vi.fn(),
}));

const source = {
  projectId: PROJECT,
  name: 'Interview notes',
  slug: 'interview-notes',
  category: 'research' as const,
  providerType: 'manual',
};

beforeEach(() => {
  state.canWrite = false;
  state.teamOwner = false;
  state.rpcCalls = [];
  state.writes = [];
  state.writeResult = { data: { id: 'new' }, error: null };
  state.adminUsed = false;
});

describe('addExternalSourceAction', () => {
  it('refuses, as a value, a project source from someone who cannot write the project, and writes nothing', async () => {
    const result = await addExternalSourceAction({
      ...source,
      scope: 'project',
    });

    expect(result).toEqual({ ok: false, error: PROJECT_SOURCE_REFUSAL });
    expect(state.writes.filter((w) => w.op !== 'select')).toEqual([]);
    expect(state.adminUsed).toBe(false);
  });

  it('adds a project source through the caller’s own client, owned by the project', async () => {
    state.canWrite = true;

    const result = await addExternalSourceAction({
      ...source,
      scope: 'project',
    });

    expect(result.ok).toBe(true);
    expect(state.writes).toMatchObject([
      {
        table: 'external_sources',
        op: 'insert',
        payload: { slug: 'interview-notes', project_id: PROJECT },
      },
    ]);
    expect(state.writes[0]!.payload).not.toHaveProperty('account_id');
    expect(state.adminUsed).toBe(false);
  });

  it('refuses a team-wide source from someone who is not an owner of the project’s team', async () => {
    state.canWrite = true;

    const result = await addExternalSourceAction({ ...source, scope: 'team' });

    expect(result).toEqual({ ok: false, error: TEAM_SOURCE_REFUSAL });
    expect(state.rpcCalls).toContainEqual({
      fn: 'has_role_on_account',
      args: { account_id: TEAM, account_role: 'owner' },
    });
    expect(state.writes.filter((w) => w.op !== 'select')).toEqual([]);
  });

  it('adds a team-wide source for a team owner, owned by the team and no project', async () => {
    state.teamOwner = true;

    const result = await addExternalSourceAction({ ...source, scope: 'team' });

    expect(result.ok).toBe(true);
    expect(state.writes).toMatchObject([
      {
        table: 'external_sources',
        op: 'insert',
        payload: { slug: 'interview-notes', account_id: TEAM },
      },
    ]);
    expect(state.writes[0]!.payload).not.toHaveProperty('project_id');
  });

  it('says so when the name is already taken there', async () => {
    state.canWrite = true;
    state.writeResult = {
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    };

    const result = await addExternalSourceAction({
      ...source,
      scope: 'project',
    });

    expect(result).toEqual({ ok: false, error: SOURCE_EXISTS_REFUSAL });
  });
});

describe('deleteExternalSourceAction', () => {
  it('deactivates through the caller’s own client, never a built-in, and refuses when RLS matched nothing', async () => {
    state.writeResult = { data: [], error: null };

    const result = await deleteExternalSourceAction({ sourceId: SOURCE });

    expect(result).toEqual({ ok: false, error: SOURCE_REMOVE_REFUSAL });
    expect(state.writes).toMatchObject([
      {
        table: 'external_sources',
        op: 'update',
        payload: { is_active: false },
      },
    ]);
    expect(state.writes[0]!.filters).toEqual(
      expect.arrayContaining([
        ['id', SOURCE],
        ['is_builtin', false],
      ]),
    );
    expect(state.adminUsed).toBe(false);
  });

  it('succeeds when the caller may deactivate the source', async () => {
    state.writeResult = { data: [{ id: SOURCE }], error: null };

    const result = await deleteExternalSourceAction({ sourceId: SOURCE });

    expect(result).toEqual({ ok: true, data: { success: true } });
  });
});

describe('the research-source actions file', () => {
  const file = readFileSync(
    resolve(__dirname, '../src/server/external-context-actions.ts'),
    'utf8',
  );

  it('does not write with the admin client', () => {
    expect(file).not.toMatch(/getSupabaseServerAdminClient/);
  });

  it('has no "owner of any account" check left', () => {
    expect(file).not.toMatch(/requireAccountOwner/);
    expect(file).not.toMatch(/\.eq\('account_role', 'owner'\)/);
  });

  it('has no source-update action (it had no caller)', () => {
    expect(file).not.toMatch(/updateExternalSourceAction/);
  });
});
