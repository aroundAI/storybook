import { describe, expect, it } from 'vitest';

import { FIXTURES, seedFixture } from '../fixtures/edit-package/seed';
import {
  type EditPackageSources,
  buildEditPackage,
  editPackageEtag,
} from '../src/build-edit-package';

/**
 * FILM-2001: the etag changes when anything the timeline is built from
 * changes, and only then. The Studio polls with it every five minutes
 * (FILM-2011), so a false change costs a re-sync and a missed one leaves
 * the editor on stale media.
 */

function sources(): EditPackageSources {
  return structuredClone(seedFixture(FIXTURES[1]).sources);
}

describe('editPackageEtag', () => {
  it('is the same for the same rows, and names the episode version', () => {
    const etag = editPackageEtag(sources());

    expect(editPackageEtag(sources())).toBe(etag);
    expect(etag).toMatch(/^v7-[0-9a-f]{40}$/);
  });

  it('changes when a shot’s video_url changes', () => {
    const changed = sources();
    changed.shots[0]!.video_url = `${changed.shots[0]!.video_url}?v=2`;

    expect(editPackageEtag(changed)).not.toBe(editPackageEtag(sources()));
  });

  it('changes when the brand changes', () => {
    const changed = sources();
    changed.project.brand = { colors: { primary: '#111111' } };

    expect(editPackageEtag(changed)).not.toBe(editPackageEtag(sources()));
  });

  it('changes when the edit policy changes', () => {
    const changed = sources();
    changed.project.edit_policy = { minShotLength: 2 };

    expect(editPackageEtag(changed)).not.toBe(editPackageEtag(sources()));
  });

  it('changes when a dialogue line is deleted, which moves no updated_at', () => {
    const changed = sources();
    changed.dialogueLines.pop();

    expect(editPackageEtag(changed)).not.toBe(editPackageEtag(sources()));
  });

  it('changes when a caption segment’s text or an audio track’s volume changes', () => {
    const caption = sources();
    caption.captionSegments[0]!.text = 'Edited';
    const volume = sources();
    volume.audioTracks[0]!.volume = 0.2;

    expect(editPackageEtag(caption)).not.toBe(editPackageEtag(sources()));
    expect(editPackageEtag(volume)).not.toBe(editPackageEtag(sources()));
  });

  it('changes when the episode version moves', () => {
    const changed = sources();
    changed.episode.version = 8;

    expect(editPackageEtag(changed)).toMatch(/^v8-/);
  });

  it('does not change when a stored brand only spells out its defaults', () => {
    const changed = sources();
    changed.project.brand = { transitionStyle: 'cut' };

    expect(editPackageEtag(changed)).toBe(editPackageEtag(sources()));
  });

  it('does not change with the row order the database happens to return', () => {
    const shuffled = sources();
    shuffled.shots.reverse();
    shuffled.dialogueLines.reverse();
    shuffled.captionSegments.reverse();

    expect(editPackageEtag(shuffled)).toBe(editPackageEtag(sources()));
  });

  it('is not moved by analytics, timestamps or signed URLs', () => {
    const rows = sources();
    const build = (generatedAt: Date, signature: string) =>
      buildEditPackage({
        sources: rows,
        media: (url) =>
          url
            ? {
                url: `https://signed.test/x?sig=${signature}`,
                key: 'k',
                sha256: null,
                sha256Reason: 'not_recorded',
                bytes: 1,
                mime: 'video/mp4',
              }
            : { url: null, mediaReason: 'not_generated' },
        analyticsHints: {
          retention: [],
          publishId: null,
          reason: 'unmeasured',
        },
        generatedAt,
      });

    const morning = build(new Date('2026-10-04T08:00:00Z'), 'a');
    const evening = build(new Date('2026-10-04T20:00:00Z'), 'b');

    expect(evening.etag).toBe(morning.etag);
    expect(evening.urlsExpireAt).toBe('2026-10-04T21:00:00.000Z');
  });
});
