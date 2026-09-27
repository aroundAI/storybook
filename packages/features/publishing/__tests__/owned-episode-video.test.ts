import { describe, expect, it } from 'vitest';

import {
  episodeVideoTarget,
  ownedEpisodeVideo,
} from '../src/lib/owned-episode-video';

/**
 * KB-123: a publish sends a video only from the app's storage and the
 * episode's own project (owner, 2026-09-25). One case per class of the
 * count query (`kb123-counts.sql`), on both storage providers. Production
 * serves R2 from an r2.dev public domain, so that shape is tested directly.
 */

const E = '11111111-1111-4111-8111-111111111111';
const SIBLING = '22222222-2222-4222-8222-222222222222';
const OTHER_PROJECT_EP = '33333333-3333-4333-8333-333333333333';
const UNKNOWN_EP = '44444444-4444-4444-8444-444444444444';
const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const scope = { episodeId: E, projectId: P };
const projects: Record<string, string> = {
  [E]: P,
  [SIBLING]: P,
  [OTHER_PROJECT_EP]: P2,
};
const projectOf = async (id: string) => projects[id] ?? null;

const R2 = 'https://pub-0123456789abcdef0123456789abcdef.r2.dev';
const r2Env = { STORAGE_PROVIDER: 'r2', R2_PUBLIC_URL: R2 };
const supabaseEnv = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' };

const r2 = (key: string) => `${R2}/project-assets/${key}`;
const sb = (key: string) =>
  `http://127.0.0.1:54321/storage/v1/object/public/project-assets/${key}`;

const cases: Array<[string, string, boolean]> = [
  ['1 own videos folder', `episodes/${E}/videos/en-1.mp4`, true],
  ['2 own episode, other folder', `episodes/${E}/thumbnails/x.mp4`, true],
  ['3 own project shots', `projects/${P}/shots/s/video/a.mp4`, true],
  ['4 own project, other folder', `projects/${P}/exports/x.mp4`, true],
  ['5 sibling episode', `episodes/${SIBLING}/videos/x.mp4`, true],
  ['6 episode of another project', `episodes/${OTHER_PROJECT_EP}/videos/x.mp4`, false],
  ['6 another project', `projects/${P2}/assets/x.mp4`, false],
  ['8 unknown episode', `episodes/${UNKNOWN_EP}/videos/x.mp4`, false],
  ['9 other key in the bucket', `misc/x.mp4`, false],
  ['9 a folder id that is not an id', `episodes/not-an-id/videos/x.mp4`, false],
  ['10 traversal', `episodes/${E}/videos/../../${OTHER_PROJECT_EP}/videos/x.mp4`, false],
  ['10 empty segment', `episodes/${E}//videos/x.mp4`, false],
];

describe('ownedEpisodeVideo', () => {
  for (const [provider, env, url] of [
    ['R2 (r2.dev, as production)', r2Env, r2],
    ['Supabase', supabaseEnv, sb],
  ] as const) {
    describe(provider, () => {
      for (const [name, key, allowed] of cases) {
        it(`${allowed ? 'sends' : 'refuses'}: ${name}`, async () => {
          expect(await ownedEpisodeVideo(url(key), scope, projectOf, env)).toBe(
            allowed ? url(key) : null,
          );
        });
      }
    });
  }

  it('refuses the own folder on another host (11)', async () => {
    const foreign = `https://evil.example/project-assets/episodes/${E}/videos/x.mp4`;
    expect(await ownedEpisodeVideo(foreign, scope, projectOf, r2Env)).toBeNull();
  });

  it('refuses another bucket on the storage host (11)', async () => {
    expect(
      await ownedEpisodeVideo(
        `${R2}/audio/episodes/${E}/videos/x.mp4`,
        scope,
        projectOf,
        r2Env,
      ),
    ).toBeNull();
  });

  it('refuses what is not a URL (12), and an empty value', async () => {
    expect(await ownedEpisodeVideo('not-a-url', scope, projectOf, r2Env)).toBeNull();
    expect(await ownedEpisodeVideo('', scope, projectOf, r2Env)).toBeNull();
    expect(await ownedEpisodeVideo(null, scope, projectOf, r2Env)).toBeNull();
  });

  it('refuses everything when the environment names no storage host', async () => {
    expect(
      await ownedEpisodeVideo(r2(`episodes/${E}/videos/x.mp4`), scope, projectOf, {
        STORAGE_PROVIDER: 'r2',
      }),
    ).toBeNull();
  });

  it('asks for the project only of a sibling episode', async () => {
    const asked: string[] = [];
    const tracking = async (id: string) => {
      asked.push(id);
      return projects[id] ?? null;
    };

    await ownedEpisodeVideo(r2(`episodes/${E}/videos/x.mp4`), scope, tracking, r2Env);
    await ownedEpisodeVideo(r2(`projects/${P}/x.mp4`), scope, tracking, r2Env);
    await ownedEpisodeVideo(r2(`episodes/${SIBLING}/videos/x.mp4`), scope, tracking, r2Env);

    expect(asked).toEqual([SIBLING]);
  });
});

describe('episodeVideoTarget', () => {
  it('reads the id of an episode or project folder', () => {
    expect(episodeVideoTarget(r2(`episodes/${E}/videos/x.mp4`), r2Env)).toEqual({
      episodeId: E,
    });
    expect(episodeVideoTarget(r2(`projects/${P}/shots/x.mp4`), r2Env)).toEqual({
      projectId: P,
    });
  });

  it('needs a file inside the folder, not the folder itself', () => {
    expect(episodeVideoTarget(r2(`episodes/${E}`), r2Env)).toBeNull();
  });
});
