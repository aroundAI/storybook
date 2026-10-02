import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { findUncheckedUpdates } from './unchecked-deletes';

/**
 * KB-105: an UPDATE that RLS filters to no rows returns `error: null` like
 * one that worked, so the user is told a change was saved when it was not.
 * An update whose success is shown, or that gates a paid call or a queued
 * job, must `.select()` what it changed and pass it to
 * `requireAffectedRows` (`@kit/next/refusals`; `@kit/next/affected-rows`
 * in client code).
 *
 * Every other plain update is listed here with the reason it may stay as it
 * is — the classification of all of them is in the KB-105 pull request. The
 * list must match exactly: a new unchecked update fails the run, and so does
 * an entry whose update has since been checked (delete the line). Keys are
 * `path | table | update`, the value `[count, reason]`.
 *
 * Upserts are not scanned: an upsert RLS refuses raises (42501) rather than
 * being filtered — measured on the local database for DO UPDATE, DO NOTHING
 * and RETURNING. Soft deletes are KB-61's.
 */
const ADMIN = 'service role, admin client or a lambda: RLS does not filter it';
const JUST_INSERTED =
  'updates the row this action inserted moments earlier; the insert is RLS-checked';
const RECORDS_RESULT =
  'records the result of an external call that already happened; the gate before it is checked';
const FAILURE_MARK =
  'marks a failure on a path that then throws or returns failure anyway';
const SET_BEFORE =
  'clears a flag on siblings before setting one; nothing to clear is a success';
const CLEANUP = 'cleanup inside a larger action, logged non-fatal, not shown';
const CASCADE = 'renumbers siblings after a checked delete';
const BOOKKEEPING = 'a counter, cache or embedding nobody is told about';
const DEAD = 'no caller in the repo';
const LAST_USED =
  'stamps last_used_at when a key is handed out; best effort, a failed stamp must not fail the call the key was fetched for';

const KNOWN: Record<string, [number, string]> = {
  'apps/web/app/api/reports/scheduled/route.ts | scheduled_reports | update': [
    2,
    ADMIN,
  ],
  'apps/web/lambda/llm-worker/handlers/asset-creation.ts | episodes | update': [
    1,
    ADMIN,
  ],
  'apps/web/lambda/llm-worker/handlers/audio-file-generation.ts | audio_cues | update':
    [3, ADMIN],
  'apps/web/lambda/llm-worker/handlers/audio-file-generation.ts | external_api_keys | update':
    [1, LAST_USED],
  'apps/web/lambda/llm-worker/handlers/shot-generation.ts | episodes | update':
    [1, ADMIN],
  'apps/web/lambda/llm-worker/handlers/story-generation.ts | episodes | update':
    [1, ADMIN],
  'apps/web/lambda/llm-worker/utils/commit-story-canon.ts | episodes | update':
    [1, ADMIN],
  'apps/web/lambda/llm-worker/utils/commit-story-canon.ts | narrative_threads | update':
    [2, ADMIN],
  'apps/web/lambda/publish-worker/index.ts | publishes | update': [1, ADMIN],
  'apps/web/lambda/scheduled-publish/index.ts | publishes | update': [3, ADMIN],
  'apps/web/lambda/voice-worker/voice-generation.ts | dialogue_lines | update':
    [3, ADMIN],
  'apps/web/lambda/voice-worker/voice-generation.ts | external_api_keys | update':
    [1, LAST_USED],
  'packages/billing/gateway/src/server/services/billing-event-handler/billing-event-handler.service.ts | orders | update':
    [2, ADMIN],
  'packages/features/audio-generation/src/server/audio-asset-actions.ts | audio_assets | update':
    [1, BOOKKEEPING],
  'packages/features/audio-generation/src/server/audio-cue-actions.ts | audio_cues | update':
    [3, `${FAILURE_MARK} + ${JUST_INSERTED}`],
  'packages/features/audio-generation/src/server/batch-actions.ts | batch_generation_jobs | update':
    [1, CLEANUP],
  'packages/features/audio-generation/src/server/core/audio-asset-core.ts | audio_assets | update':
    [1, BOOKKEEPING],
  'packages/features/audio-generation/src/server/voice-actions.ts | dialogue_lines | update':
    [4, `${FAILURE_MARK} + ${RECORDS_RESULT}`],
  'packages/features/audio-generation/src/server/voice-actions.ts | generation_jobs | update':
    [4, `${FAILURE_MARK} + ${RECORDS_RESULT}`],
  'packages/features/audio-generation/src/server/voice-clone-actions.ts | voice_profiles | update':
    [2, `${FAILURE_MARK} + ${RECORDS_RESULT}`],
  'packages/features/content-analytics/src/server/analytics-sync-cron.ts | platform_connections | update':
    [1, ADMIN],
  'packages/features/content-analytics/src/server/analytics-sync-cron.ts | publishes | update':
    [1, ADMIN],
  'packages/features/content-analytics/src/server/analytics-sync-cron.ts | revenue_records | update':
    [1, ADMIN],
  'packages/features/content-analytics/src/server/asset-duration-sync.ts | publishes | update':
    [1, ADMIN],
  'packages/features/content-analytics/src/server/backfill/youtube-backfill.ts | publishes | update':
    [1, ADMIN],
  'packages/features/content-analytics/src/server/reporting/report-ingest.ts | youtube_report_jobs | update':
    [1, ADMIN],
  'packages/features/content-analytics/src/server/vendor-data-purge.ts | vendor_data_purges | update':
    [3, ADMIN],
  'packages/features/generation/src/jobs.ts | generation_jobs | update': [
    3,
    ADMIN,
  ],
  'packages/features/episodes/src/agent/story-orchestrator.ts | episodes | update':
    [1, ADMIN],
  'packages/features/episodes/src/lib/canon/sequel-system.ts | projects | update':
    [1, DEAD],
  'packages/features/episodes/src/lib/server/mutations/shot-actions.ts | generation_jobs | update':
    [1, CLEANUP],
  'packages/features/episodes/src/lib/server/mutations/shot-actions.ts | shots | update':
    [1, CASCADE],
  'packages/features/episodes/src/server/actions.ts | generation_jobs | update':
    [2, CLEANUP],
  'packages/features/episodes/src/server/thumbnail-actions.ts | episode_thumbnails | update':
    [2, SET_BEFORE],
  'packages/features/publishing/src/jobs/process-scheduled-publishes.ts | publishes | update':
    [3, ADMIN],
  'packages/features/publishing/src/lib/uploaded-file-duration.ts | publishes | update':
    [1, ADMIN],
  'packages/features/publishing/src/server/publish-actions.ts | episodes | update':
    [1, BOOKKEEPING],
  'packages/features/publishing/src/server/publish-actions.ts | publishes | update':
    [6, `${FAILURE_MARK} + ${JUST_INSERTED} + ${RECORDS_RESULT}`],
  'packages/features/team-accounts/src/server/services/account-members.service.ts | accounts_memberships | update':
    [1, ADMIN],
  'packages/supabase/src/external-api-keys.ts | external_api_keys | update': [
    1,
    LAST_USED,
  ],
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

      for (const found of findUncheckedUpdates(readFileSync(file, 'utf8'))) {
        const key = `${path} | ${found.table} | ${found.op}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
  }

  return counts;
}

describe('KB-105: updates whose success is shown check what they changed', () => {
  const counts = scanRepo();

  it('finds no unchecked update outside the list', () => {
    const unexplained = Object.entries(counts)
      .filter(([key, count]) => count > (KNOWN[key]?.[0] ?? 0))
      .map(([key, count]) => `${key} (${count})`);

    expect(
      unexplained,
      'end the update in .select("id") and pass the data to requireAffectedRows, or list it here with its reason',
    ).toEqual([]);
  });

  it('lists no update that has since been checked', () => {
    const stale = Object.entries(KNOWN)
      .filter(([key, [count]]) => (counts[key] ?? 0) < count)
      .map(([key]) => key);

    expect(stale, 'lower or delete these lines in KNOWN').toEqual([]);
  });
});

describe('findUncheckedUpdates', () => {
  it('finds an update with no .select()', () => {
    expect(
      findUncheckedUpdates(
        `const { error } = await client\n  .from('posts')\n  .update({ title })\n  .eq('id', id);`,
      ),
    ).toEqual([{ table: 'posts', op: 'update' }]);
  });

  it('passes an update that selects what it changed', () => {
    expect(
      findUncheckedUpdates(
        `const { data } = await client.from('posts').update({ title }).eq('id', id).select('id');`,
      ),
    ).toEqual([]);
  });

  it('leaves soft deletes to KB-61', () => {
    expect(
      findUncheckedUpdates(
        `await client.from('episodes').update({ deleted_at: now }).eq('id', id);`,
      ),
    ).toEqual([]);
  });

  it('does not scan upserts', () => {
    expect(
      findUncheckedUpdates(
        `await client.from('settings').upsert({ account_id: id, value });`,
      ),
    ).toEqual([]);
  });

  it('passes a kept update selected through a conditional (optimistic lock)', () => {
    expect(
      findUncheckedUpdates(
        [
          `const update = client.from('publishes').update({ note }).eq('id', id);`,
          `const { data } = await (stale === null ? update.is('at', null) : update.eq('at', stale)).select('id');`,
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('finds a kept update that is never selected', () => {
    expect(
      findUncheckedUpdates(
        [
          `const update = client.from('publishes').update({ note }).eq('id', id);`,
          `const { error } = await update.eq('at', stale);`,
        ].join('\n'),
      ),
    ).toEqual([{ table: 'publishes', op: 'update' }]);
  });

  it('ignores an update that names no table', () => {
    expect(findUncheckedUpdates(`hash.update(chunk);`)).toEqual([]);
  });
});
