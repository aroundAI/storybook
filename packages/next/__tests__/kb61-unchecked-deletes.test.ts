import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { findUncheckedDeletes } from './unchecked-deletes';

/**
 * KB-61: a DELETE, or a soft delete (`.update({ deleted_at })`), that RLS
 * filters to no rows returns `error: null` like one that worked. A write
 * whose success the user is told about must `.select()` what it changed and
 * pass it to `requireAffectedRows`.
 *
 * Every write that does not is listed here with the reason it may stay as it
 * is. The list must match exactly: a new unchecked write fails the run, and
 * so does an entry whose write has since been checked (delete the line).
 * Keys are `path | table | op`, the value `[count, reason]`.
 */
const ADMIN = 'service role or admin client: RLS does not filter it';
const CLEANUP = 'cleanup whose outcome is not shown to anyone';
const REPLACE =
  'clears a set before re-inserting it; "nothing to clear" is a success';
const CASCADE =
  'a child of a parent whose own write is checked; no children is a success';

const KNOWN: Record<string, [number, string]> = {
  // Service role / admin client
  'apps/web/lambda/publish-worker/index.ts | publishes | delete': [1, ADMIN],
  'packages/billing/gateway/src/server/services/billing-event-handler/billing-event-handler.service.ts | subscriptions | delete':
    [1, ADMIN],
  'packages/features/admin/src/lib/server/services/admin-accounts.service.ts | accounts | delete':
    [1, ADMIN],
  'packages/features/team-accounts/src/server/services/delete-team-account.service.ts | accounts | delete':
    [1, ADMIN],
  'packages/features/team-accounts/src/server/services/leave-team-account.service.ts | accounts_memberships | delete':
    [1, ADMIN],

  // One-time OAuth state, consumed by the callback
  'apps/web/app/api/platforms/callback/meta/route.ts | oauth_states | delete': [
    1,
    CLEANUP,
  ],
  'apps/web/app/api/platforms/callback/tiktok/route.ts | oauth_states | delete':
    [1, CLEANUP],
  'apps/web/app/api/platforms/callback/twitter/route.ts | oauth_states | delete':
    [1, CLEANUP],
  'apps/web/app/api/platforms/callback/youtube/route.ts | oauth_states | delete':
    [1, CLEANUP],
  'apps/web/app/api/platforms/youtube/save-channel/route.ts | oauth_states | delete':
    [1, CLEANUP],

  // Rollbacks of a row the same action just inserted
  'packages/features/content-analytics/src/server/experiment-service.ts | analytics_experiments | delete':
    [1, 'rollback of the row this service just inserted'],

  // Replace-sets
  'packages/features/content-analytics/src/server/taxonomy-service.ts | publish_tags | delete':
    [2, REPLACE],

  // Cascades under a checked parent
  'packages/features/episodes/src/server/actions.ts | shots | delete': [
    2,
    CASCADE,
  ],
  'packages/features/episodes/src/server/actions.ts | shots | soft-delete': [
    1,
    CASCADE,
  ],
  'packages/features/episodes/src/server/actions.ts | audio_cues | delete': [
    2,
    CASCADE,
  ],
  'packages/features/episodes/src/server/actions.ts | audio_tracks | delete': [
    2,
    CASCADE,
  ],
  'packages/features/episodes/src/lib/server/mutations/season-actions.ts | shots | soft-delete':
    [1, CASCADE],
  'packages/features/episodes/src/lib/server/mutations/season-actions.ts | episodes | soft-delete':
    [1, CASCADE],
  'packages/features/audio-generation/src/server/voice-clone-actions.ts | voice_consent | delete':
    [1, CASCADE],
};

const REPO = join(__dirname, '..', '..', '..');
const ROOTS = ['apps/web/app', 'apps/web/lambda', 'packages'];
const SKIPPED = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'coverage',
  '__tests__',
  '__mocks__',
  'scripts',
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return SKIPPED.has(entry.name) ? [] : sourceFiles(path);
    }

    return /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

function scanRepo() {
  const counts: Record<string, number> = {};

  for (const root of ROOTS) {
    for (const file of sourceFiles(join(REPO, root))) {
      const path = relative(REPO, file);

      for (const found of findUncheckedDeletes(readFileSync(file, 'utf8'))) {
        const key = `${path} | ${found.table} | ${found.op}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
  }

  return counts;
}

describe('KB-61: deletes check what they removed', () => {
  const counts = scanRepo();

  it('finds no unchecked delete or soft delete outside the list', () => {
    const unexplained = Object.entries(counts)
      .filter(([key, count]) => count > (KNOWN[key]?.[0] ?? 0))
      .map(([key, count]) => `${key} (${count})`);

    expect(
      unexplained,
      'end the write in .select("id") and pass the data to requireAffectedRows (@kit/next/refusals)',
    ).toEqual([]);
  });

  it('lists no write that has since been checked', () => {
    const stale = Object.entries(KNOWN)
      .filter(([key, [count]]) => (counts[key] ?? 0) < count)
      .map(([key]) => key);

    expect(stale, 'delete these lines from KNOWN').toEqual([]);
  });
});

describe('findUncheckedDeletes', () => {
  it('finds a delete with no .select()', () => {
    expect(
      findUncheckedDeletes(
        `const { error } = await client\n  .from('posts')\n  .delete()\n  .eq('id', id);`,
      ),
    ).toEqual([{ table: 'posts', op: 'delete' }]);
  });

  it('passes a delete that selects what it removed', () => {
    expect(
      findUncheckedDeletes(
        `const { data } = await client.from('posts').delete().eq('id', id).select('id');`,
      ),
    ).toEqual([]);
  });

  it('finds a soft delete with no .select()', () => {
    expect(
      findUncheckedDeletes(
        `await (client as any)\n  .from('episodes')\n  .update({ deleted_at: now })\n  .eq('id', id);`,
      ),
    ).toEqual([{ table: 'episodes', op: 'soft-delete' }]);
  });

  it('ignores a Set or Map delete', () => {
    expect(
      findUncheckedDeletes(`next.delete(id);\nparams.delete('a');`),
    ).toEqual([]);
  });

  it('finds a counted delete with no .select()', () => {
    expect(
      findUncheckedDeletes(
        `const { count } = await client.from('lines').delete({ count: 'exact' }).eq('a', 1);`,
      ),
    ).toEqual([{ table: 'lines', op: 'delete' }]);
  });
});
