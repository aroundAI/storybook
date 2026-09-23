import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createFilmProjectAction,
  updateProjectCoverImageAction,
} from '../_lib/server/create-film-project.action';

/**
 * KB-58: both were plain exports of a `'use server'` module — endpoints that
 * ran for any caller. They are `enhanceAction`s now: no session, nothing
 * runs. KB-28's and KB-6's returned refusals are unchanged.
 */

const session = vi.hoisted(() => ({ signedIn: true }));

const db = vi.hoisted(() => ({
  account: { data: { id: 'acc-1' } as unknown, error: null as unknown },
  insert: {
    data: { id: 'proj-1', slug: 'my-film' } as unknown,
    error: null as unknown,
  },
  rpc: { error: null as unknown },
  calls: [] as string[],
}));

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: vi.fn(() =>
    Promise.resolve(
      session.signedIn
        ? { data: { id: 'user-1' }, error: null }
        : {
            data: null,
            error: new Error('no session'),
            redirectTo: '/auth/sign-in',
          },
    ),
  ),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    from: (table: string) => {
      db.calls.push(table);
      const chain = {
        select: () => chain,
        eq: () => chain,
        insert: () => chain,
        single: () =>
          Promise.resolve(table === 'accounts' ? db.account : db.insert),
      };
      return chain;
    },
    rpc: (name: string) => {
      db.calls.push(name);
      return Promise.resolve(db.rpc);
    },
  }),
}));

// The real redirect throws; its digest names where it sends the caller.
const toSignIn = {
  digest: expect.stringContaining('/auth/sign-in'),
};

const input = {
  accountSlug: 'acme',
  name: 'My Film',
  settings: {} as never,
};

beforeEach(() => {
  session.signedIn = true;
  db.insert = { data: { id: 'proj-1', slug: 'my-film' }, error: null };
  db.rpc = { error: null };
  db.calls = [];
});

describe('createFilmProjectAction', () => {
  it('sends a caller without a session to sign in, and touches nothing', async () => {
    session.signedIn = false;

    await expect(createFilmProjectAction(input)).rejects.toMatchObject(
      toSignIn,
    );
    expect(db.calls).toEqual([]);
  });

  it('creates the project for a signed-in caller', async () => {
    await expect(createFilmProjectAction(input)).resolves.toEqual({
      ok: true,
      data: {
        projectId: 'proj-1',
        projectSlug: 'my-film',
        accountSlug: 'acme',
      },
    });
    expect(db.calls).toEqual(['accounts', 'projects']);
  });

  it('returns the duplicate-name refusal as a value', async () => {
    db.insert = { data: null, error: { code: '23505', message: 'dup' } };

    await expect(createFilmProjectAction(input)).resolves.toEqual({
      ok: false,
      error:
        'A project with this name already exists in this workspace. Choose a different name.',
    });
  });
});

describe('updateProjectCoverImageAction', () => {
  const cover = { projectId: 'proj-1', coverImageUrl: 'https://x/cover.png' };

  it('sends a caller without a session to sign in, and touches nothing', async () => {
    session.signedIn = false;

    await expect(updateProjectCoverImageAction(cover)).rejects.toMatchObject(
      toSignIn,
    );
    expect(db.calls).toEqual([]);
  });

  it('updates the cover for a signed-in caller', async () => {
    await expect(updateProjectCoverImageAction(cover)).resolves.toEqual({
      ok: true,
      data: null,
    });
    expect(db.calls).toEqual(['update_project_cover_image']);
  });

  it("returns KB-28's refusal as a value when the caller cannot edit", async () => {
    db.rpc = { error: { code: '42501', message: 'denied' } };

    await expect(updateProjectCoverImageAction(cover)).resolves.toEqual({
      ok: false,
      error: "You can't change this project's cover.",
    });
  });
});
