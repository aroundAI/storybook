import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  findBareRefusingCalls,
  findCaughtActionMessageReads,
  refusingActionsIn,
} from './caught-action-message';
import { findThrownRefusals } from './thrown-refusals';

const REPO = join(__dirname, '..', '..', '..');
const ROOTS = ['apps/web/app', 'packages'];
const SKIPPED = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'coverage',
  '__tests__',
]);

/**
 * Files that still read a caught server-action message, and who owns the
 * fix: the second KB-6 pull request (assets, audio, publishing, analytics,
 * edit suite, admin), or an open pull request that is rewriting the file.
 * An entry that no longer offends fails the run, so the list can only
 * shrink — delete the line in the pull request that fixes the file.
 */
const KNOWN: Record<string, string> = {};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return SKIPPED.has(entry.name) ? [] : sourceFiles(path);
    }

    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
      ? [path]
      : [];
  });
}

const sources = ROOTS.flatMap((root) => sourceFiles(join(REPO, root))).map(
  (path) => ({ path, source: readFileSync(path, 'utf8') }),
);

const describeReads = (reads: Array<{ line: number; action: string }>) =>
  reads.map((read) => `line ${read.line} (${read.action})`);

const offenders = new Map<string, string[]>();

for (const { path, source } of sources) {
  if (!/^\s*['"]use client['"]/m.test(source)) continue;

  const reads = findCaughtActionMessageReads(path, source);

  if (reads.length > 0) {
    offenders.set(relative(REPO, path), describeReads(reads));
  }
}

const refusing = new Set(
  sources.flatMap(({ source }) => refusingActionsIn(source)),
);

describe('KB-6: a caught server-action error is never read for its message', () => {
  it('no client file shows or branches on the message of an error caught around a server action', () => {
    const unexpected = [...offenders]
      .filter(([file]) => !(file in KNOWN))
      .map(([file, reads]) => `${file}: ${reads.join(', ')}`);

    expect(
      unexpected,
      'Return the refusal as a value (returnRefusals + ActionRefusal from @kit/next) and show refusalMessage(error, fallback)',
    ).toEqual([]);
  });

  it('every call to an action that returns its refusals is unwrapped', () => {
    expect(refusing.size).toBeGreaterThan(0);

    const bare = sources.flatMap(({ path, source }) =>
      describeReads(findBareRefusingCalls(path, source, refusing)).map(
        (call) => `${relative(REPO, path)}: ${call}`,
      ),
    );

    expect(
      bare,
      'A refusal is a value now: without unwrap(…) the caller reads "refused" as "done"',
    ).toEqual([]);
  });

  it('no exported server action throws a refusal: each one returns it (returnRefusals / withRefusals)', () => {
    const thrown = findThrownRefusals(
      sources.map(({ path, source }) => ({
        path: relative(REPO, path),
        source,
      })),
    ).map(({ file, line, action }) => `${file}:${line} ${action}`);

    expect(
      thrown,
      'Rename the enhanceAction to an inner const and export returnRefusals(inner); callers unwrap(…)',
    ).toEqual([]);
  });

  it('every file excused as owned by another pull request still needs excusing', () => {
    expect(Object.keys(KNOWN).filter((file) => !offenders.has(file))).toEqual(
      [],
    );
  });
});

describe('what the scan flags, and what it leaves alone', () => {
  const scan = (source: string) =>
    findCaughtActionMessageReads('fixture.tsx', source).map(
      (read) => read.action,
    );

  it('flags a toast of the caught message around an action', () => {
    expect(
      scan(`
        import { deleteEpisodeAction } from '@kit/episodes/server/actions';
        async function run() {
          try {
            await deleteEpisodeAction({ episodeId });
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : 'Failed to delete episode',
            );
          }
        }
      `),
    ).toEqual(['deleteEpisodeAction']);
  });

  it('flags an action imported from a server module under another name', () => {
    expect(
      scan(`
        import { createFilmProject } from '../_lib/server/create-film-project.action';
        async function run() {
          try {
            await createFilmProject(slug, data);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed');
          }
        }
      `),
    ).toEqual(['createFilmProject']);
  });

  it('flags a dynamically imported action', () => {
    expect(
      scan(`
        async function run() {
          try {
            const { generateSfxAssetAction } = await import('@kit/audio-generation/server');
            await generateSfxAssetAction(input);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed');
          }
        }
      `),
    ).toEqual(['generateSfxAssetAction']);
  });

  it('flags a mutation whose onError shows the message', () => {
    expect(
      scan(`
        const mutation = useMutation({
          mutationFn: (trackId: string) => deleteAudioTrackAction({ trackId }),
          onError: (error: Error) => {
            toast.error(\`Failed to delete track: \${error.message}\`);
          },
        });
      `),
    ).toEqual(['deleteAudioTrackAction']);
  });

  it('flags a mutation handed the action by name', () => {
    expect(
      scan(`
        const mutation = useMutation({
          mutationFn: fixContinuityIssueAction,
          onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Failed');
          },
        });
      `),
    ).toEqual(['fixContinuityIssueAction']);
  });

  it('flags an action chosen first and called under another name', () => {
    expect(
      scan(`
        async function run() {
          try {
            const action = mode === 'story' ? refineStoryAction : refineScreenplayAction;
            await action({ episodeId });
          } catch (error) {
            setFailure(error instanceof Error ? error.message : 'Failed');
          }
        }
      `),
    ).toEqual(['refineStoryAction']);
  });

  it('flags branching on the message, which cannot match in production', () => {
    expect(
      scan(`
        async function run() {
          try {
            await deleteAssetAction({ assetId });
          } catch (err) {
            const error = err instanceof Error ? err : new Error('x');
            if (error.message.includes('in use')) {
              toast.error('Cannot delete asset that is in use');
            }
          }
        }
      `),
    ).toEqual(['deleteAssetAction']);
  });

  it('leaves a caught fetch alone: that message never crossed from an action', () => {
    expect(
      scan(`
        async function run() {
          try {
            const response = await fetch('/api/research/upload', { method: 'POST' });
            if (!response.ok) throw new Error('Extraction failed');
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed');
          }
        }
      `),
    ).toEqual([]);
  });

  it('leaves a client-only failure alone', () => {
    expect(
      scan(`
        async function run() {
          try {
            await navigator.clipboard.writeText(text);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed');
          }
        }
      `),
    ).toEqual([]);
  });

  it('leaves a logged message alone', () => {
    expect(
      scan(`
        async function run() {
          try {
            await deleteEpisodeAction({ episodeId });
          } catch (error) {
            console.error('delete failed', error instanceof Error ? error.message : error);
            toast.error('Failed to delete episode');
          }
        }
      `),
    ).toEqual([]);
  });

  it('leaves refusalMessage alone: it is how a refusal is read (server half below)', () => {
    expect(
      scan(`
        async function run() {
          try {
            await unwrap(deleteEpisodeAction({ episodeId }));
          } catch (error) {
            toast.error(refusalMessage(error, 'Failed to delete episode'));
          }
        }
      `),
    ).toEqual([]);
  });
});
