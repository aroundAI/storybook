import { describe, expect, it, vi } from 'vitest';

import { SupabaseStorageAdapter } from '../src/adapters/supabase';

vi.mock('server-only', () => ({}));

/**
 * FILM-2003: finalize_render compares a render's stored size with the size
 * its upload URL was signed for, so `stat` must report the size of exactly
 * the named file, and null when there is none.
 */
function adapterListing(
  entries: Array<{ name: string; metadata?: Record<string, unknown> }>,
  error: { message: string } | null = null,
) {
  const list = vi.fn().mockResolvedValue({ data: entries, error });
  const client = { storage: { from: vi.fn(() => ({ list })) } };

  return {
    adapter: new SupabaseStorageAdapter(client as never),
    list,
    client,
  };
}

const KEY = 'projects/p/episodes/e/renders/r1.mp4';

describe('SupabaseStorageAdapter.stat', () => {
  it('reports the size and type of the named file', async () => {
    const { adapter, list, client } = adapterListing([
      { name: 'r1-thumb.jpg', metadata: { size: 10, mimetype: 'image/jpeg' } },
      { name: 'r1.mp4', metadata: { size: 48211, mimetype: 'video/mp4' } },
    ]);

    await expect(adapter.stat('project-assets', KEY)).resolves.toEqual({
      size: 48211,
      contentType: 'video/mp4',
    });
    expect(client.storage.from).toHaveBeenCalledWith('project-assets');
    expect(list).toHaveBeenCalledWith('projects/p/episodes/e/renders', {
      limit: 100,
      search: 'r1.mp4',
    });
  });

  it('is null when only a file with a similar name exists', async () => {
    const { adapter } = adapterListing([
      { name: 'r1.mp4.part', metadata: { size: 1 } },
    ]);

    await expect(adapter.stat('project-assets', KEY)).resolves.toBeNull();
  });

  it('throws when the listing fails, rather than reporting no file', async () => {
    const { adapter } = adapterListing([], { message: 'boom' });

    await expect(adapter.stat('project-assets', KEY)).rejects.toThrow('boom');
  });
});
