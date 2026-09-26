import type { SupabaseClient } from '@supabase/supabase-js';

import { describe, expect, it } from 'vitest';

import type { Database } from '@kit/supabase/database';

import {
  PublishJobRefused,
  deleteJobTarget,
  publishJobConnection,
} from '../job-guard';

/**
 * KB-47, KB-109. The publish worker holds every connection's token. A
 * message is a pointer: the worker re-reads the publish row and acts on the
 * row's connection and video, for a user who may still take them down.
 */

const PUBLISH = '10000000-0000-4000-8000-000000000001';
const PROJECT = '20000000-0000-4000-8000-000000000001';
const ACCOUNT = '30000000-0000-4000-8000-000000000001';
const OTHER_ACCOUNT = '30000000-0000-4000-8000-000000000002';
const CONNECTION = '40000000-0000-4000-8000-000000000001';
const ADMIN = '50000000-0000-4000-8000-000000000001';
const MEMBER = '50000000-0000-4000-8000-000000000002';

interface Row {
  status: string;
  platform_content_id: string | null;
  platform_connection_id: string | null;
  connectionAccount: string | null;
}

function client(row: Row | null): SupabaseClient<Database> {
  const roles: Record<string, string> = {
    [ADMIN]: 'admin',
    [MEMBER]: 'member',
  };

  const fake = {
    from(relation: string) {
      const filters: Record<string, string> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          filters[column] = value;
          return builder;
        },
        maybeSingle: async () => {
          if (relation === 'project_members') {
            const role = roles[filters.user_id ?? ''];
            return { data: role ? { role } : null, error: null };
          }

          return {
            data: row && {
              id: PUBLISH,
              status: row.status,
              platform: 'youtube',
              platform_content_id: row.platform_content_id,
              platform_connection_id: row.platform_connection_id,
              episode: {
                project_id: PROJECT,
                project: { account_id: ACCOUNT },
              },
              connection: row.connectionAccount
                ? { account_id: row.connectionAccount }
                : null,
            },
            error: null,
          };
        },
      };
      return builder;
    },
  };

  return fake as unknown as SupabaseClient<Database>;
}

const deleting: Row = {
  status: 'deleting',
  platform_content_id: 'VIDEO123',
  platform_connection_id: CONNECTION,
  connectionAccount: ACCOUNT,
};

describe('deleteJobTarget', () => {
  it("gives an admin the row's video and connection, not the message's", async () => {
    await expect(
      deleteJobTarget(client(deleting), { publishId: PUBLISH, userId: ADMIN }),
    ).resolves.toEqual({
      platform: 'youtube',
      platformContentId: 'VIDEO123',
      platformConnectionId: CONNECTION,
    });
  });

  it('refuses a project member: only owners and admins take videos down', async () => {
    await expect(
      deleteJobTarget(client(deleting), { publishId: PUBLISH, userId: MEMBER }),
    ).rejects.toThrow(
      'Only project owners and admins can take a published video down.',
    );
  });

  it('refuses a publish nobody marked for deletion', async () => {
    await expect(
      deleteJobTarget(client({ ...deleting, status: 'published' }), {
        publishId: PUBLISH,
        userId: ADMIN,
      }),
    ).rejects.toThrow(/not marked for deletion/);
  });

  it("refuses a publish naming another account's connection", async () => {
    await expect(
      deleteJobTarget(
        client({ ...deleting, connectionAccount: OTHER_ACCOUNT }),
        { publishId: PUBLISH, userId: ADMIN },
      ),
    ).rejects.toBeInstanceOf(PublishJobRefused);
  });

  it('has nothing to do for a publish that is already gone', async () => {
    await expect(
      deleteJobTarget(client(null), { publishId: PUBLISH, userId: ADMIN }),
    ).resolves.toBeNull();
  });
});

describe('publishJobConnection', () => {
  const published = { ...deleting, status: 'queued' };

  it("lets a job upload with its publish's own connection", async () => {
    await expect(
      publishJobConnection(client(published), {
        publishId: PUBLISH,
        platformConnectionId: CONNECTION,
      }),
    ).resolves.toBe(CONNECTION);
  });

  it("refuses a publish naming another account's connection", async () => {
    await expect(
      publishJobConnection(
        client({ ...published, connectionAccount: OTHER_ACCOUNT }),
        { publishId: PUBLISH, platformConnectionId: CONNECTION },
      ),
    ).rejects.toThrow(/connection of another account/);
  });

  it("refuses a message naming a connection the publish doesn't", async () => {
    await expect(
      publishJobConnection(client(published), {
        publishId: PUBLISH,
        platformConnectionId: '40000000-0000-4000-8000-000000000009',
      }),
    ).rejects.toThrow(/not the publish's connection/);
  });
});
