import { describe, expect, it } from 'vitest';

import { McpToolError } from '../../src/errors';
import { getEpisodeTool } from '../../src/server/tools/read/episodes';
import {
  closeEditSessionTool,
  openEditSessionTool,
  recordEditEventsTool,
  studioTools,
} from '../../src/server/tools/studio';
import { createFakeClient, fakeContext } from '../helpers/fake-supabase';

/**
 * FILM-2002: the three edit-session tools over a recording client. The
 * database functions are pgTAP's subject (edit-sessions.test.sql); here,
 * what each tool sends them and how each answer maps onto the error
 * contract.
 */
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EPISODE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HOLDER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const episodeInTeam = [
  {
    id: EPISODE_ID,
    project: { id: PROJECT_ID, account_id: ACCOUNT_ID, name: 'P', slug: 'p' },
  },
];

const session = {
  id: SESSION_ID,
  episode_id: EPISODE_ID,
  user_id: '11111111-1111-4111-8111-111111111111',
  connection_id: CONNECTION_ID,
  package_etag: 'ep@v3',
  status: 'open',
  previous_status: 'ready',
  started_at: '2026-10-04T10:00:00Z',
  last_event_at: '2026-10-04T10:00:00Z',
  closed_at: null,
  delivered_at: null,
  close_reason: null,
  summary: {},
};

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );

  expect(error).toBeInstanceOf(McpToolError);

  return error as McpToolError;
}

const qa = (n: number) => ({
  clientEventId: `qa-${n}`,
  ts: '2026-10-04T10:00:00Z',
  type: 'qa_run',
  data: { pass: true, issues: 0 },
});

describe('the StorybookStudio session tools', () => {
  it('are three studio:write tools, none read-only or destructive', () => {
    expect(studioTools.map((tool) => tool.name)).toEqual([
      'open_edit_session',
      'record_edit_events',
      'close_edit_session',
    ]);

    for (const tool of studioTools) {
      expect(tool.scope).toBe('studio:write');
      expect(tool.annotations.readOnlyHint).toBe(false);
      expect(tool.annotations.destructiveHint).toBe(false);
    }
  });
});

describe('open_edit_session', () => {
  it("opens with the connection's id and returns sessionId and previousStatus", async () => {
    const fake = createFakeClient({
      episodes: episodeInTeam,
      'rpc:open_edit_session': {
        ok: true,
        existing: false,
        session,
        previousStatus: 'ready',
        episodeVersion: 7,
      },
    });

    const result = await openEditSessionTool.handler(
      { episodeId: EPISODE_ID, packageEtag: 'ep@v3' },
      fakeContext(fake.client),
    );

    const rpc = fake.calls.find((call) => call.op === 'rpc');
    expect(rpc?.payload).toEqual({
      p_episode_id: EPISODE_ID,
      p_package_etag: 'ep@v3',
      p_connection_id: CONNECTION_ID,
    });
    expect(result.structuredContent).toMatchObject({
      sessionId: SESSION_ID,
      previousStatus: 'ready',
      existing: false,
      episodeVersion: 7,
    });
  });

  it('refuses an episode outside the bound team before calling the database', async () => {
    const fake = createFakeClient({ episodes: [] });

    const error = await refusal(
      openEditSessionTool.handler(
        { episodeId: EPISODE_ID, packageEtag: 'ep@v3' },
        fakeContext(fake.client),
      ),
    );

    expect(error.code).toBe('NOT_FOUND');
    expect(fake.tables()).not.toContain('rpc:open_edit_session');
  });

  it("maps another user's open session to RUN_IN_PROGRESS with who and since", async () => {
    const holder = {
      sessionId: SESSION_ID,
      userId: HOLDER_ID,
      name: 'Maya',
      since: '2026-10-04T09:00:00Z',
    };
    const fake = createFakeClient({
      episodes: episodeInTeam,
      'rpc:open_edit_session': { ok: false, code: 'RUN_IN_PROGRESS', holder },
    });

    const error = await refusal(
      openEditSessionTool.handler(
        { episodeId: EPISODE_ID, packageEtag: 'ep@v3' },
        fakeContext(fake.client),
      ),
    );

    expect(error.code).toBe('RUN_IN_PROGRESS');
    expect(error.details).toEqual({ holder });
    expect(error.message).toBe(
      'Maya has been editing this episode in the Studio since 2026-10-04T09:00:00Z.',
    );
  });

  it.each([
    [{ code: 'FORBIDDEN', role: 'viewer' }, 'FORBIDDEN', /yours is viewer/],
    [
      { code: 'VALIDATION_FAILED', status: 'draft' },
      'VALIDATION_FAILED',
      /Nothing to edit: the episode is in draft/,
    ],
  ])('maps %o to %s', async (answer, code, message) => {
    const fake = createFakeClient({
      episodes: episodeInTeam,
      'rpc:open_edit_session': { ok: false, ...answer },
    });

    const error = await refusal(
      openEditSessionTool.handler(
        { episodeId: EPISODE_ID, packageEtag: 'ep@v3' },
        fakeContext(fake.client),
      ),
    );

    expect(error.code).toBe(code);
    expect(error.message).toMatch(message);
  });
});

describe('record_edit_events', () => {
  it('sends the events in the database shape and reports accepted and duplicates', async () => {
    const fake = createFakeClient({
      edit_sessions: [session],
      episodes: episodeInTeam,
      'rpc:record_edit_events': { ok: true, accepted: 1, duplicates: 1 },
    });

    const result = await recordEditEventsTool.handler(
      { sessionId: SESSION_ID, events: [qa(1), qa(2)] },
      fakeContext(fake.client),
    );

    const rpc = fake.calls.find((call) => call.op === 'rpc');
    expect(rpc?.payload).toEqual({
      p_session_id: SESSION_ID,
      p_events: [1, 2].map((n) => ({
        client_event_id: `qa-${n}`,
        ts: '2026-10-04T10:00:00Z',
        type: 'qa_run',
        data: { pass: true, issues: 0 },
      })),
    });
    expect(result.structuredContent).toEqual({
      sessionId: SESSION_ID,
      accepted: 1,
      duplicates: 1,
    });
  });

  it('refuses 501 events with VALIDATION_FAILED and writes nothing', async () => {
    const fake = createFakeClient({ edit_sessions: [session] });

    const error = await refusal(
      recordEditEventsTool.handler(
        {
          sessionId: SESSION_ID,
          events: Array.from({ length: 501 }, (_, i) => qa(i)),
        },
        fakeContext(fake.client),
      ),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(fake.calls).toHaveLength(0);
  });

  it('refuses an unknown type and a malformed data field by path', async () => {
    const fake = createFakeClient({ edit_sessions: [session] });

    const error = await refusal(
      recordEditEventsTool.handler(
        {
          sessionId: SESSION_ID,
          events: [
            { ...qa(1), type: 'session_opened' },
            { ...qa(2), data: { pass: 'yes', issues: 0 } },
          ],
        },
        fakeContext(fake.client),
      ),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    const paths = (
      error.details?.errors as Array<{ path: Array<string | number> }>
    ).map((issue) => issue.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['0.type', '1.data.pass']));
    expect(fake.calls).toHaveLength(0);
  });

  it('says a closed session is closed', async () => {
    const fake = createFakeClient({
      edit_sessions: [session],
      episodes: episodeInTeam,
      'rpc:record_edit_events': {
        ok: false,
        code: 'VALIDATION_FAILED',
        status: 'closed',
      },
    });

    const error = await refusal(
      recordEditEventsTool.handler(
        { sessionId: SESSION_ID, events: [qa(1)] },
        fakeContext(fake.client),
      ),
    );

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toBe('The edit session is closed; open a new one.');
  });
});

describe('close_edit_session', () => {
  it("closes with the summary of the session's events", async () => {
    const fake = createFakeClient({
      edit_sessions: [session],
      episodes: episodeInTeam,
      // paged: the first range gets the rows, the next an empty page
      edit_events: (call) => {
        const range = call.filters.find((f) => f.method === 'range');

        return {
          data:
            range?.args[0] === 0
              ? [
                  {
                    id: 1,
                    ts: '2026-10-04T10:01:00Z',
                    type: 'version_created',
                    data: {
                      versionId: 'v1',
                      durationSeconds: 60,
                      aiOps: 4,
                      userOps: 1,
                    },
                  },
                  {
                    id: 2,
                    ts: '2026-10-04T10:02:00Z',
                    type: 'qa_run',
                    data: {},
                  },
                ]
              : [],
        };
      },
      'rpc:close_edit_session': {
        ok: true,
        session: { ...session, status: 'closed' },
        restoredStatus: 'ready',
        episodeStatus: 'ready',
        episodeVersion: 9,
      },
    });

    const result = await closeEditSessionTool.handler(
      { sessionId: SESSION_ID },
      fakeContext(fake.client),
    );

    const summary = {
      versions: 1,
      finalDuration: 60,
      aiOps: 4,
      userOps: 1,
      plansProposed: 0,
      plansApproved: 0,
      qaRuns: 1,
    };
    const rpc = fake.calls.find((call) => call.op === 'rpc');
    expect(rpc?.payload).toEqual({
      p_session_id: SESSION_ID,
      p_summary: summary,
      p_reason: 'client',
    });
    expect(result.structuredContent).toEqual({
      sessionId: SESSION_ID,
      status: 'closed',
      summary,
      restoredStatus: 'ready',
      episodeStatus: 'ready',
      episodeVersion: 9,
    });
  });

  it('refuses a session outside the bound team', async () => {
    const fake = createFakeClient({ edit_sessions: [] });

    const error = await refusal(
      closeEditSessionTool.handler(
        { sessionId: SESSION_ID },
        fakeContext(fake.client),
      ),
    );

    expect(error.code).toBe('NOT_FOUND');
    expect(fake.tables()).not.toContain('rpc:close_edit_session');
  });
});

describe('get_episode (FILM-2002 AC8)', () => {
  it('includes edit_state and the open session', async () => {
    const editState = {
      sessionId: SESSION_ID,
      editedBy: { userId: session.user_id, name: 'Maya' },
      since: session.started_at,
      lastDeliveredAt: null,
      editedIn: 'studio',
      versions: 0,
    };
    const fake = createFakeClient({
      episodes: [
        {
          ...episodeInTeam[0],
          project_id: PROJECT_ID,
          number: 1,
          title: 'Ep',
          status: 'editing',
          version: 3,
          metadata: {},
          edit_state: editState,
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-04T10:00:00Z',
        },
      ],
      edit_sessions: [session],
    });

    const result = await getEpisodeTool.handler(
      { episodeId: EPISODE_ID },
      fakeContext(fake.client),
    );

    const select = fake.calls.find((call) => call.table === 'episodes');
    expect(select?.columns).toMatch(/edit_state/);
    expect(result.structuredContent.editState).toEqual(editState);
    expect(result.structuredContent.editSession).toMatchObject({
      id: SESSION_ID,
      userId: session.user_id,
      previousStatus: 'ready',
      startedAt: session.started_at,
    });
  });

  it('has no edit session when none is open', async () => {
    const fake = createFakeClient({
      episodes: [
        {
          ...episodeInTeam[0],
          status: 'ready',
          metadata: {},
          edit_state: {},
        },
      ],
      edit_sessions: [],
    });

    const result = await getEpisodeTool.handler(
      { episodeId: EPISODE_ID },
      fakeContext(fake.client),
    );

    expect(result.structuredContent.editSession).toBeNull();
    expect(result.structuredContent.editState).toMatchObject({
      sessionId: null,
      versions: 0,
    });
  });
});
