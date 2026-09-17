import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listChannelsAction } from '../src/server/channels-actions';

const channel = {
  connectionId: '00000000-0000-4000-8000-0000000000c1',
  platform: 'youtube',
  name: 'Main',
  thumbnailUrl: null,
  isActive: true,
};

const mocks = vi.hoisted(() => ({
  assertScopeAccess: vi.fn(),
  listProjectChannels: vi.fn(),
  listAccountChannels: vi.fn(),
}));

vi.mock('@kit/next/actions', () => ({
  enhanceAction: (handler: (data: unknown) => unknown) => handler,
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({}),
}));

vi.mock('../src/server/scope-access', () => ({
  assertScopeAccess: mocks.assertScopeAccess,
}));

vi.mock('../src/server/channels', () => ({
  listProjectChannels: mocks.listProjectChannels,
  listAccountChannels: mocks.listAccountChannels,
}));

const projectId = '00000000-0000-4000-8000-0000000000a1';
const accountId = '00000000-0000-4000-8000-0000000000b1';

describe('listChannelsAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertScopeAccess.mockResolvedValue(accountId);
    mocks.listProjectChannels.mockResolvedValue([channel]);
    mocks.listAccountChannels.mockResolvedValue([channel]);
  });

  it('lists the channels a project publishes to', async () => {
    await expect(listChannelsAction({ projectId })).resolves.toEqual([channel]);

    expect(mocks.assertScopeAccess).toHaveBeenCalledWith({ projectId });
    expect(mocks.listProjectChannels).toHaveBeenCalledOnce();
    expect(mocks.listAccountChannels).not.toHaveBeenCalled();
  });

  it("lists an account's channels when no project is given", async () => {
    await listChannelsAction({ accountId });

    expect(mocks.assertScopeAccess).toHaveBeenCalledWith({ accountId });
    expect(mocks.listAccountChannels).toHaveBeenCalledOnce();
    expect(mocks.listProjectChannels).not.toHaveBeenCalled();
  });

  // The listers read through the user-scoped client, but the access check is
  // what stops a caller naming a project in another account and learning its
  // channel names.
  it('checks access before listing anything', async () => {
    mocks.assertScopeAccess.mockRejectedValue(
      new Error('Project not found or access denied'),
    );

    await expect(listChannelsAction({ projectId })).rejects.toThrow(
      'Project not found or access denied',
    );

    expect(mocks.listProjectChannels).not.toHaveBeenCalled();
    expect(mocks.listAccountChannels).not.toHaveBeenCalled();
  });
});
