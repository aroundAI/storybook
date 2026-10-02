import type { SupabaseClient } from '@supabase/supabase-js';

import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@kit/supabase/database';

import { recordUploadedFileDuration } from '../src/lib/uploaded-file-duration';
import { mp4, serve } from './mp4-fixture';

/**
 * FILM-1710. Meta never reports an Instagram video's length, so it is taken
 * from the file we uploaded, at publish time — or the row stays null
 * (`duration_unknown`), never 0 and never the episode's duration.
 */

function fakeClient(error: { message: string } | null = null) {
  const writes: Array<{
    table: string;
    values: Record<string, unknown>;
    filters: Array<[string, string, unknown]>;
  }> = [];

  const client = {
    from: vi.fn((table: string) => ({
      update: (values: Record<string, unknown>) => {
        const write = { table, values, filters: [] as never[] };
        writes.push(write);

        const chain = {
          eq: (column: string, value: unknown) => {
            write.filters.push(['eq', column, value] as never);
            return chain;
          },
          is: (column: string, value: unknown) => {
            write.filters.push(['is', column, value] as never);
            return Promise.resolve({ error });
          },
        };

        return chain;
      },
    })),
  };

  return {
    client: () => client as unknown as SupabaseClient<Database>,
    writes,
  };
}

const instagram = { id: 'pub-ig', platform: 'instagram' };
const url = 'https://storage/episodes/ep/short.mp4';

describe('recordUploadedFileDuration', () => {
  it('records the uploaded 45-second clip as 45, filling only a null', async () => {
    const { client, writes } = fakeClient();
    const { fetcher } = serve(
      mp4({ seconds: 44.6, width: 1080, height: 1920 }),
    );

    expect(
      await recordUploadedFileDuration(client, instagram, url, fetcher),
    ).toEqual({ recorded: true, seconds: 45 });

    expect(writes).toEqual([
      {
        table: 'publishes',
        values: { duration_seconds: 45 },
        filters: [
          ['eq', 'id', 'pub-ig'],
          ['is', 'duration_seconds', null],
        ],
      },
    ]);
  });

  it('leaves the row duration_unknown when the header cannot be read', async () => {
    const { client, writes } = fakeClient();
    const { fetcher } = serve(new Uint8Array(4096).fill(7));

    expect(
      await recordUploadedFileDuration(client, instagram, url, fetcher),
    ).toEqual({ recorded: false, reason: 'duration_unknown' });
    expect(writes).toEqual([]);
  });

  it('never writes 0: a header that says zero seconds is unknown', async () => {
    const { client, writes } = fakeClient();
    const { fetcher } = serve(mp4({ seconds: 0, width: 1080, height: 1920 }));

    expect(
      await recordUploadedFileDuration(client, instagram, url, fetcher),
    ).toEqual({ recorded: false, reason: 'duration_unknown' });
    expect(writes).toEqual([]);
  });

  it('does not throw when storage refuses the read', async () => {
    const { client, writes } = fakeClient();
    const fetcher = vi.fn(async () => new Response('gone', { status: 404 }));

    expect(
      await recordUploadedFileDuration(client, instagram, url, fetcher),
    ).toEqual({ recorded: false, reason: 'duration_unknown' });
    expect(writes).toEqual([]);
  });

  it('reports a refused write rather than throwing', async () => {
    const { client } = fakeClient({ message: 'denied' });
    const { fetcher } = serve(mp4({ seconds: 30, width: 1080, height: 1920 }));

    expect(
      await recordUploadedFileDuration(client, instagram, url, fetcher),
    ).toEqual({ recorded: false, reason: 'write_failed' });
  });

  it.each(['youtube', 'tiktok', 'facebook', 'twitter'])(
    'leaves %s to its own writer and reads nothing',
    async (platform) => {
      const { client, writes } = fakeClient();
      const { fetcher } = serve(
        mp4({ seconds: 30, width: 1080, height: 1920 }),
      );

      expect(
        await recordUploadedFileDuration(
          client,
          { id: 'p', platform },
          url,
          fetcher,
        ),
      ).toEqual({ recorded: false, reason: 'not_measured_here' });
      expect(fetcher).not.toHaveBeenCalled();
      expect(writes).toEqual([]);
    },
  );
});
