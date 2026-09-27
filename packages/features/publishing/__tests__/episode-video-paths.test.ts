import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-123: every path that sends an episode's video checks it first
 * (`ownedEpisodeVideo`). The check's rule is unit-tested in
 * `owned-episode-video.test.ts`; this pins that each path calls it, since a
 * path that stopped calling it would still pass every unit test.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const read = (path: string) => readFileSync(join(REPO, path), 'utf8');

const GATES: Array<[string, RegExp, number]> = [
  // publish-now and retry, in process
  [
    'packages/features/publishing/src/server/publish-actions.ts',
    /await ownedEpisodeVideo\(/g,
    2,
  ],
  // the in-app scheduled job, in process
  [
    'packages/features/publishing/src/jobs/process-scheduled-publishes.ts',
    /await ownedEpisodeVideo\(\s*videoUrl,/g,
    1,
  ],
  // the scheduled Lambda, before it queues the job
  [
    'apps/web/lambda/scheduled-publish/index.ts',
    /await ownedEpisodeVideo\(\s*videoUrl,/g,
    1,
  ],
  // the worker, before any handler fetches
  [
    'apps/web/lambda/publish-worker/index.ts',
    /job\.videoUrl = await ownedJobVideo\(job\);/g,
    1,
  ],
];

describe('every publish path checks the video it sends', () => {
  for (const [path, pattern, count] of GATES) {
    it(path, () => {
      expect(read(path).match(pattern) ?? []).toHaveLength(count);
    });
  }

  it('retry sends the checked video, not the stored one', () => {
    expect(read('packages/features/publishing/src/server/publish-actions.ts')).not.toMatch(
      /videoUrl: episode\.final_video_url/,
    );
  });
});

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === 'node_modules' || name === '__tests__') return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

/**
 * A tripwire, not a proof: it catches the shapes the three old copies used
 * (`localizedVideos[lang]`, `group.videos[lang]`, …), so a copy pasted back
 * fails here. A read spelled another way would pass it. What keeps an
 * unowned video from being sent is the check on every path above, each
 * guarded in `kb-123.json`, not this scan.
 */
describe('one resolver', () => {
  it('only episode-video.ts picks a video out of the stored columns', () => {
    const offenders = [
      ...sources(join(REPO, 'packages/features/publishing/src')),
      ...sources(join(REPO, 'apps/web/lambda')),
    ]
      .filter((path) => !path.endsWith('lib/episode-video.ts'))
      .filter((path) =>
        /localizedVideos\[|localized_videos\[|group\.videos\[|\.videos\?\.\[/.test(
          readFileSync(path, 'utf8'),
        ),
      )
      .map((path) => relative(REPO, path));

    expect(offenders).toEqual([]);
  });
});
