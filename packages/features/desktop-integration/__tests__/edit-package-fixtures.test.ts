import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildFixturePackage } from '../fixtures/edit-package/build-fixture';
import { FIXTURES, seedFixture } from '../fixtures/edit-package/seed';
import {
  EditPackageSchema,
  type MediaEntry,
  isMediaRef,
} from '../src/edit-package.schema';

/**
 * FILM-2001: the three committed fixture packages are exactly what the
 * builder makes of the seed. FILM-2012's project-builder tests in the fork
 * consume these files, so a change to the package shape shows up here as a
 * diff to review, never silently.
 *
 * Regenerate after an intended change:
 *   UPDATE_FIXTURES=1 pnpm --filter @kit/desktop-integration exec vitest run __tests__/edit-package-fixtures.test.ts
 */

const DIR = join(__dirname, '../fixtures/edit-package');
const ONE_MB = 1024 * 1024;

const serialize = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

describe.each(FIXTURES)('the $name fixture package', (spec) => {
  const file = join(DIR, `${spec.name}.json`);

  it('validates against EditPackageSchema', async () => {
    const editPackage = await buildFixturePackage(seedFixture(spec));

    expect(EditPackageSchema.safeParse(editPackage).error).toBeUndefined();
    expect(editPackage.shots).toHaveLength(spec.shots);
  });

  it('matches the committed fixture', async () => {
    const built = serialize(await buildFixturePackage(seedFixture(spec)));

    if (process.env.UPDATE_FIXTURES === '1') writeFileSync(file, built);

    expect(existsSync(file), `${file} is missing`).toBe(true);
    expect(built).toBe(readFileSync(file, 'utf8'));
  });
});

describe('what the fixtures carry', () => {
  async function build(name: (typeof FIXTURES)[number]['name']) {
    const seed = seedFixture(FIXTURES.find((f) => f.name === name)!);
    return { seed, editPackage: await buildFixturePackage(seed) };
  }

  it('the 60-shot two-language package serializes under 1 MB', async () => {
    const { editPackage } = await build('60-shots');
    const bytes = Buffer.byteLength(JSON.stringify(editPackage));

    expect(editPackage.episode.languages).toEqual(['en', 'hi']);
    expect(editPackage.dubbed).toHaveLength(1);
    expect(editPackage.dubbed[0]!.lines).toHaveLength(120);
    expect(bytes).toBeLessThan(ONE_MB);
    // Recorded for the PR: ~0.5 MB at R2's URL length.
    expect(bytes).toBeGreaterThan(300 * 1024);
  });

  it('retention hints are the hand-computed drops of the seeded curve', async () => {
    // Points every 5%; each step loses 1.5 points, plus 12 at 0–5%, 8 at
    // 30–35% and 10 at 70–75%. Drops under 3 points are not hints. The
    // video is 300 s long (60 shots of 4, 5 and 6 s).
    const { editPackage } = await build('60-shots');

    expect(editPackage.analyticsHints.retention).toEqual(
      [
        { timestamp: 0, elapsedRatio: 0, dropPercentage: 13.5 },
        { timestamp: 90, elapsedRatio: 0.3, dropPercentage: 9.5 },
        { timestamp: 210, elapsedRatio: 0.7, dropPercentage: 11.5 },
      ].map((drop) => ({
        ...drop,
        platform: 'youtube',
        asOf: '2026-10-03T06:00:00Z',
      })),
    );
    expect(editPackage.analyticsHints.reason).toBeUndefined();
  });

  it('says why there are no hints rather than giving a zero', async () => {
    expect((await build('5-shots')).editPackage.analyticsHints).toEqual({
      retention: [],
      publishId: null,
      reason: 'unmeasured',
    });
    expect((await build('20-shots')).editPackage.analyticsHints).toEqual({
      retention: [],
      publishId: null,
      reason: 'no_published_video',
    });
  });

  it('gives a reason for every slot it cannot sign, never a broken URL', async () => {
    const { editPackage } = await build('20-shots');
    const [first, second, third] = editPackage.shots;
    const last = editPackage.shots.at(-1)!;

    expect(isMediaRef(first!.video)).toBe(true);
    expect(last.video).toEqual({ url: null, mediaReason: 'not_generated' });
    expect(second!.firstFrame).toEqual({
      url: null,
      mediaReason: 'outside_project',
    });
    expect(editPackage.dialogue[2]!.audio).toEqual({
      url: null,
      mediaReason: 'missing',
    });
    expect(isMediaRef(third!.firstFrame)).toBe(true);
  });

  it('carries sha256 only where StoryBook recorded one, and says so elsewhere', async () => {
    const { seed, editPackage } = await build('20-shots');
    const maya = editPackage.characters.find((c) => c.name === 'MAYA')!;
    const [image, reference] = maya.referenceImages as Array<
      Extract<MediaEntry, { url: string }>
    >;

    expect(image!.sha256).toBe(Object.values(seed.sources.recordedHashes)[0]);
    expect(reference!.sha256).toBeNull();
    expect(reference!.sha256Reason).toBe('not_recorded');
    expect(image!.mime).toBe('image/png');
    expect(image!.key).toMatch(/^project-assets\/projects\/.+\/maya\.png$/);
  });

  it('keeps music, sfx and ambience, and leaves the dialogue composite out', async () => {
    const { editPackage } = await build('5-shots');

    expect(
      editPackage.audioTracks
        .map((t) => [t.type, t.loopable, t.tags])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([
      ['ambience', true, []],
      ['music', true, ['tense', 'electronic']],
      ['sfx', false, []],
    ]);
    // In timeline order: the alarm at 3 s comes after the two beds at 0 s.
    expect(editPackage.audioTracks.map((t) => t.timelineStartSeconds)).toEqual([
      0, 0, 3,
    ]);
  });

  it('applies brand and policy defaults over what the project stored', async () => {
    const plain = (await build('5-shots')).editPackage;
    const branded = (await build('60-shots')).editPackage;

    expect(plain.brand.colors.primary).toBe('#2563EB');
    expect(plain.editPolicy.targetDurationSeconds).toBeNull();
    expect(branded.brand.colors.primary).toBe('#0EA5E9');
    expect(branded.brand.colors.secondary).toBe('#F59E0B');
    expect(branded.editPolicy.maxShotLength).toBe(5);
    expect(branded.editPolicy.minShotLength).toBe(1.2);
  });
});
