import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * KB-74: report files were never deleted, not even with their account. The
 * owner's decision (2026-09-25) is KB-20's: keep them until the account asks,
 * and deleting the account is asking. The cleanup removes the files of
 * accounts that no longer exist, and of legacy schedules that no longer
 * exist, and nothing else.
 *
 * The fake below is the Storage API as the local stack behaves: `list`
 * returns one level, folders with `id: null`, at most `limit` entries from
 * `offset`, sorted by name.
 */

const LIVE = '11111111-7400-4000-8000-000000000001';
const GONE = '11111111-7400-4000-8000-000000000002';
const LIVE_REPORT = '11111111-7400-4000-8000-0000000000a1';
const GONE_REPORT = '11111111-7400-4000-8000-0000000000a2';

function fakeAdmin(options: {
  files: string[];
  accounts: string[];
  schedules: string[];
  failLookup?: 'accounts' | 'scheduled_reports';
  failRemove?: boolean;
}) {
  const files = new Set(options.files);
  const rows: Record<string, string[]> = {
    accounts: options.accounts,
    scheduled_reports: options.schedules,
  };

  const bucket = {
    list: vi.fn(
      async (
        prefix: string,
        { limit, offset }: { limit: number; offset: number },
      ) => {
        const children = new Map<string, { name: string; id: string | null }>();

        for (const file of files) {
          if (!file.startsWith(`${prefix}/`)) continue;
          const [name, ...rest] = file.slice(prefix.length + 1).split('/');
          children.set(name!, { name: name!, id: rest.length ? null : name! });
        }

        const sorted = [...children.values()].sort((a, b) =>
          a.name.localeCompare(b.name),
        );

        return { data: sorted.slice(offset, offset + limit), error: null };
      },
    ),
    remove: vi.fn(async (paths: string[]) => {
      if (options.failRemove) {
        return { data: null, error: { message: 'storage unavailable' } };
      }
      for (const path of paths) files.delete(path);
      return { data: [], error: null };
    }),
  };

  const from = (table: string) => ({
    select: () => ({
      in: (_column: string, ids: string[]) => ({
        order: () => ({
          range: async (start: number, end: number) =>
            options.failLookup === table
              ? { data: null, error: { message: `${table} unreadable` } }
              : {
                  data: ids
                    .filter((id) => rows[table]!.includes(id))
                    .map((id) => ({ id }))
                    .slice(start, end + 1),
                  error: null,
                },
        }),
      }),
    }),
  });

  return {
    // The two calls the cleanup makes, not a whole client
    client: { storage: { from: () => bucket }, from } as never,
    files,
    bucket,
  };
}

describe('deleteOrphanedReportFiles', () => {
  it("removes a deleted account's files, nested ones too, and keeps a live account's", async () => {
    const { deleteOrphanedReportFiles } = await import(
      '../src/server/report-storage'
    );
    const { client, files } = fakeAdmin({
      files: [
        `exports/${GONE}/1-report.csv`,
        `exports/${GONE}/scheduled/${GONE_REPORT}/2-report.pdf`,
        `exports/${LIVE}/3-report.csv`,
        `exports/${LIVE}/scheduled/${LIVE_REPORT}/4-report.pdf`,
      ],
      accounts: [LIVE],
      schedules: [LIVE_REPORT],
    });

    const result = await deleteOrphanedReportFiles(client);

    expect([...files].sort()).toEqual([
      `exports/${LIVE}/3-report.csv`,
      `exports/${LIVE}/scheduled/${LIVE_REPORT}/4-report.pdf`,
    ]);
    expect(result).toEqual({ removed: 2, failed: 0 });
  });

  it('keeps a live account’s scheduled files after its schedule is deleted', async () => {
    const { deleteOrphanedReportFiles } = await import(
      '../src/server/report-storage'
    );
    const { client, files } = fakeAdmin({
      files: [`exports/${LIVE}/scheduled/${GONE_REPORT}/1-report.pdf`],
      accounts: [LIVE],
      schedules: [],
    });

    await deleteOrphanedReportFiles(client);

    expect(files.size).toBe(1);
  });

  it('removes a legacy schedule folder once its schedule is gone', async () => {
    const { deleteOrphanedReportFiles } = await import(
      '../src/server/report-storage'
    );
    const { client, files } = fakeAdmin({
      files: [
        `scheduled/${GONE_REPORT}/1-report.pdf`,
        `scheduled/${LIVE_REPORT}/2-report.pdf`,
      ],
      accounts: [LIVE],
      schedules: [LIVE_REPORT],
    });

    const result = await deleteOrphanedReportFiles(client);

    expect([...files]).toEqual([`scheduled/${LIVE_REPORT}/2-report.pdf`]);
    expect(result.removed).toBe(1);
  });

  it('deletes nothing when it cannot read which accounts exist', async () => {
    const { deleteOrphanedReportFiles } = await import(
      '../src/server/report-storage'
    );
    const { client, files, bucket } = fakeAdmin({
      files: [`exports/${LIVE}/1-report.csv`],
      accounts: [LIVE],
      schedules: [],
      failLookup: 'accounts',
    });

    await expect(deleteOrphanedReportFiles(client)).rejects.toThrow(
      'accounts unreadable',
    );
    expect(bucket.remove).not.toHaveBeenCalled();
    expect(files.size).toBe(1);
  });

  it('deletes no legacy folder when it cannot read which schedules exist', async () => {
    const { deleteOrphanedReportFiles } = await import(
      '../src/server/report-storage'
    );
    const { client, files } = fakeAdmin({
      files: [`scheduled/${LIVE_REPORT}/1-report.pdf`],
      accounts: [],
      schedules: [LIVE_REPORT],
      failLookup: 'scheduled_reports',
    });

    await expect(deleteOrphanedReportFiles(client)).rejects.toThrow(
      'scheduled_reports unreadable',
    );
    expect(files.size).toBe(1);
  });

  it('leaves folders that are not an id alone', async () => {
    const { deleteOrphanedReportFiles } = await import(
      '../src/server/report-storage'
    );
    const { client, files } = fakeAdmin({
      files: ['exports/readme/1.csv', 'scheduled/.emptyFolderPlaceholder/x'],
      accounts: [],
      schedules: [],
    });

    await deleteOrphanedReportFiles(client);

    expect(files.size).toBe(2);
  });

  it('pages past the first 100 entries of a folder', async () => {
    const { deleteOrphanedReportFiles } = await import(
      '../src/server/report-storage'
    );
    const many = Array.from(
      { length: 230 },
      (_, i) => `exports/${GONE}/${String(i).padStart(3, '0')}-report.csv`,
    );
    const { client, files } = fakeAdmin({
      files: many,
      accounts: [],
      schedules: [],
    });

    const result = await deleteOrphanedReportFiles(client);

    expect(files.size).toBe(0);
    expect(result.removed).toBe(230);
  });

  it('counts a failed removal and carries on', async () => {
    const { deleteOrphanedReportFiles } = await import(
      '../src/server/report-storage'
    );
    const { client } = fakeAdmin({
      files: [`exports/${GONE}/1-report.csv`],
      accounts: [],
      schedules: [],
      failRemove: true,
    });

    await expect(deleteOrphanedReportFiles(client)).resolves.toEqual({
      removed: 0,
      failed: 1,
    });
  });
});

describe('scheduledReportPath', () => {
  it("files a scheduled report under its account's own folder", async () => {
    const { scheduledReportPath } = await import(
      '../src/server/report-storage'
    );

    expect(
      scheduledReportPath(LIVE, LIVE_REPORT, 'analytics-report.pdf', 1),
    ).toBe(`exports/${LIVE}/scheduled/${LIVE_REPORT}/1-analytics-report.pdf`);
  });
});
