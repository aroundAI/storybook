import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-181. A browser Realtime channel joined before the socket carries the
 * user's token joins as `anon`: Realtime evaluates RLS with no user, drops
 * every event, and the channel still reports SUBSCRIBED. So every file that
 * opens a channel goes through `subscribeWithAuth`, which sets the token
 * first.
 */

const REPO = resolve(__dirname, '../../..');
const ROOTS = ['packages', 'apps'];
const HELPER = 'packages/supabase/src/realtime/subscribe-with-auth.ts';
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  '.open-next',
  '.sst',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
]);
const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE =
  /(?:^|\/)(?:__tests__|__mocks__|e2e)\/|\.(?:test|spec)\.[jt]sx?$/;

const OPENS_CHANNEL = /\.channel\s*\(|['"`]postgres_changes['"`]/;
const GOES_THROUGH_HELPER = /\bsubscribeWithAuth\b/;

function sourceFiles(path: string): string[] {
  const absolute = join(REPO, path);

  if (!statSync(absolute).isDirectory()) return SOURCE.test(path) ? [path] : [];

  return readdirSync(absolute).flatMap((entry) =>
    SKIP_DIRS.has(entry) ? [] : sourceFiles(join(path, entry)),
  );
}

const FILES = ROOTS.flatMap(sourceFiles)
  .map((file) => relative(REPO, join(REPO, file)).split(sep).join('/'))
  .filter((file) => !TEST_FILE.test(file) && file !== HELPER);

describe('Realtime subscriptions join with the user token (KB-181)', () => {
  it('scans the repo and finds the notifications stream', () => {
    const opening = FILES.filter((file) =>
      OPENS_CHANNEL.test(readFileSync(join(REPO, file), 'utf8')),
    );

    expect(opening).toContain(
      'packages/features/notifications/src/hooks/use-notifications-stream.ts',
    );
  });

  it('no file opens a channel without subscribeWithAuth', () => {
    const offenders = FILES.filter((file) => {
      const source = readFileSync(join(REPO, file), 'utf8');

      return OPENS_CHANNEL.test(source) && !GOES_THROUGH_HELPER.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it('the helper sets the token before it joins', () => {
    const source = readFileSync(join(REPO, HELPER), 'utf8');

    expect(source.indexOf('realtime.setAuth')).toBeGreaterThan(-1);
    expect(source.indexOf('realtime.setAuth')).toBeLessThan(
      source.indexOf('.subscribe()'),
    );
  });
});
