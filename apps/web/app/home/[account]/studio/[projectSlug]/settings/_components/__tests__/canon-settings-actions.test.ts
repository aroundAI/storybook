import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { updateCanonSettingsAction } from '../canon-settings-actions';

/**
 * FILM-1007: canon settings persist to `projects.metadata.canon`, next to
 * whatever else the project keeps in its metadata.
 */

const PROJECT = '11111111-1111-4111-8111-111111111111';

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction: vi.fn(
    (fn: (data: unknown, user: { id: string }) => unknown) => (data: unknown) =>
      fn(data, { id: 'user-1' }),
  ),
}));

type Result = { data: unknown; error: { message: string } | null };

const updates: Array<Record<string, unknown>> = [];

function clientReturning(read: Result, write: Result) {
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'single']) {
      chain[method] = vi.fn(() => chain);
    }
    chain.update = vi.fn((row: Record<string, unknown>) => {
      updates.push(row);
      return chain;
    });
    chain.then = (resolve: (value: Result) => unknown) =>
      resolve(updates.length ? write : read);
    return chain;
  });

  vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);
}

const settings = {
  enabled: true,
  roleSeparation: false,
  memoryHorizon: 15,
  enforcement: 'strict' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
});

describe('updateCanonSettingsAction', () => {
  it('writes the settings under metadata.canon and keeps the other metadata', async () => {
    clientReturning(
      { data: { metadata: { projectType: 'series' } }, error: null },
      { data: [{ id: PROJECT }], error: null },
    );

    await expect(
      updateCanonSettingsAction({ projectId: PROJECT, settings }),
    ).resolves.toEqual({ ok: true, data: { success: true } });

    expect(updates[0]!.metadata).toEqual({
      projectType: 'series',
      canon: { ...settings, memoryHorizonMode: 'custom' },
    });
  });

  it('records an automatic horizon as automatic, not as a number', async () => {
    clientReturning(
      { data: { metadata: null }, error: null },
      { data: [{ id: PROJECT }], error: null },
    );

    await updateCanonSettingsAction({
      projectId: PROJECT,
      settings: { ...settings, memoryHorizon: null },
    });

    expect(updates[0]!.metadata).toEqual({
      canon: {
        ...settings,
        memoryHorizon: null,
        memoryHorizonMode: 'automatic',
      },
    });
  });

  it('refuses, as a value, when row-level security matched no project', async () => {
    clientReturning(
      { data: { metadata: {} }, error: null },
      { data: [], error: null },
    );

    await expect(
      updateCanonSettingsAction({ projectId: PROJECT, settings }),
    ).resolves.toEqual({
      ok: false,
      error: "You can't change this project's canon settings.",
    });
  });
});
