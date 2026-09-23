import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../route';

/**
 * KB-26. This route queues fact-extraction jobs that a Lambda writes into
 * the project with the service role, so its own check is the only guard.
 * It used to accept anyone who could read the project, which includes every
 * signed-in user for a public or unlisted project. It must now require an
 * owner/admin/member row (`can_write_project`), and a refused request
 * extracts and queues nothing.
 */

const PROJECT = '550e8400-e29b-41d4-a716-446655440000';

const state = {
  canWrite: false,
  rpcArgs: [] as unknown[],
  queued: [] as unknown[],
  extracted: 0,
};

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    rpc: async (_fn: string, args: unknown) => {
      state.rpcArgs.push(args);
      return { data: state.canWrite, error: null };
    },
    // KB-31's `authorizeProjectTarget` reads the project for its account
    // after this route's gate, then asks `can_write_project` again.
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: { id: PROJECT, account_id: 'account-1' },
          error: null,
        }),
      };
      return query;
    },
  }),
}));

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: async () => ({ data: { id: 'u1' }, error: null }),
}));

vi.mock('@kit/episodes/lib/server/pdf-extractor', () => ({
  extractTextFromFile: async () => {
    state.extracted += 1;
    return { text: 'Some extracted research text.', pageCount: 1 };
  },
  chunkTextForExtraction: (text: string) => [text],
}));

vi.mock('@kit/prompt-engine/server', () => ({
  queueLlmJob: async (job: unknown) => {
    state.queued.push(job);
  },
}));

function request() {
  const form = new FormData();
  form.append('file', new File(['notes'], 'notes.txt', { type: 'text/plain' }));
  form.append('projectId', PROJECT);
  form.append('extractFacts', 'true');

  return new Request('http://localhost/api/research/upload', {
    method: 'POST',
    body: form,
  });
}

beforeEach(() => {
  state.canWrite = false;
  state.rpcArgs = [];
  state.queued = [];
  state.extracted = 0;
});

describe('POST /api/research/upload', () => {
  it('refuses a caller without a project_members row, and queues nothing', async () => {
    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(state.rpcArgs).toEqual([{ target_project_id: PROJECT }]);
    expect(state.extracted).toBe(0);
    expect(state.queued).toEqual([]);
  });

  it('extracts and queues for a project member', async () => {
    state.canWrite = true;

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(state.queued).toHaveLength(1);
  });
});
