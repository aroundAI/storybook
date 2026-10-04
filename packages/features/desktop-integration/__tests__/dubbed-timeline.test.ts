import { describe, expect, it } from 'vitest';

import { buildFixturePackage } from '../fixtures/edit-package/build-fixture';
import { FIXTURES, seedFixture } from '../fixtures/edit-package/seed';
import { editPackageEtag } from '../src/build-edit-package';

/**
 * FILM-2007: a dubbed line carries where it starts on the timeline
 * (`dubbed_dialogue_lines.timeline_start_seconds`, written by the voice
 * worker from its source line), so the Studio's language lanes (FILM-2019)
 * place it without a lookup; and moving it changes the etag, as every
 * carried field does.
 */
const seed = () => structuredClone(seedFixture(FIXTURES[2]));

describe('the dubbed block’s timeline start (FILM-2007)', () => {
  it('carries each dub at its source line’s start, null when it has none', async () => {
    const fixture = seed();
    const source = new Map(
      fixture.sources.dialogueLines.map((line) => [
        line.id,
        line.timeline_start_seconds,
      ]),
    );
    fixture.sources.dubbedLines[1]!.timeline_start_seconds = null;

    const pkg = await buildFixturePackage(fixture);
    const [hindi] = pkg.dubbed;

    expect(hindi!.language).toBe('hi');
    expect(hindi!.lines[0]!.timelineStartSeconds).toBe(
      source.get(hindi!.lines[0]!.dialogueId),
    );
    expect(hindi!.lines[0]!.timelineStartSeconds).toBeGreaterThanOrEqual(0);
    expect(
      hindi!.lines.find(
        (line) => line.id === fixture.sources.dubbedLines[1]!.id,
      )!.timelineStartSeconds,
    ).toBeNull();
  });

  it('changes the etag when a dub moves', () => {
    const moved = seed();
    moved.sources.dubbedLines[0]!.timeline_start_seconds = 99;

    expect(editPackageEtag(moved.sources)).not.toBe(
      editPackageEtag(seed().sources),
    );
  });
});
