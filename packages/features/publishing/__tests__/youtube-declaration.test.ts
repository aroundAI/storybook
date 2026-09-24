import { describe, expect, it } from 'vitest';

import {
  YOUTUBE_CATEGORIES,
  YouTubeDeclarationMissing,
  isYouTubeCategoryId,
  resolveYouTubeDeclaration,
} from '../src/lib/youtube-declaration';

/**
 * KB-30. Every YouTube upload declared "not made for kids" and category 22
 * because each upload site spelled `?? false` and `?? '22'`. The resolver is
 * now the only place a declaration comes from, and it has no fallback value:
 * an answer the creator gave, or a refusal.
 */

const undeclared = { youtube_made_for_kids: null, youtube_category_id: null };

describe('resolveYouTubeDeclaration', () => {
  it('uses what the request or publish row carries', () => {
    expect(
      resolveYouTubeDeclaration(
        { madeForKids: true, categoryId: '1' },
        undeclared,
      ),
    ).toEqual({ madeForKids: true, categoryId: '1' });
  });

  it('carries an explicit "not made for kids" through, rather than treating false as absent', () => {
    expect(
      resolveYouTubeDeclaration(
        { madeForKids: false, categoryId: '27' },
        { youtube_made_for_kids: true, youtube_category_id: '1' },
      ),
    ).toEqual({ madeForKids: false, categoryId: '27' });
  });

  it("falls back to the channel's declaration for a row made before KB-30", () => {
    expect(
      resolveYouTubeDeclaration(
        {},
        { youtube_made_for_kids: true, youtube_category_id: '1' },
      ),
    ).toEqual({ madeForKids: true, categoryId: '1' });
  });

  it('takes each field from wherever it is answered', () => {
    expect(
      resolveYouTubeDeclaration(
        { madeForKids: false },
        { youtube_made_for_kids: null, youtube_category_id: '24' },
      ),
    ).toEqual({ madeForKids: false, categoryId: '24' });
  });

  it('refuses when nobody has declared the audience — it never assumes', () => {
    expect(() =>
      resolveYouTubeDeclaration({ categoryId: '1' }, undeclared),
    ).toThrow(YouTubeDeclarationMissing);

    try {
      resolveYouTubeDeclaration({ categoryId: '1' }, undeclared);
    } catch (error) {
      expect((error as YouTubeDeclarationMissing).missing).toEqual([
        'audience',
      ]);
    }
  });

  it('refuses when nobody has chosen a category, rather than sending 22', () => {
    try {
      resolveYouTubeDeclaration({}, null);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(YouTubeDeclarationMissing);
      expect((error as YouTubeDeclarationMissing).missing).toEqual([
        'audience',
        'category',
      ]);
      expect((error as Error).message).toMatch(/Settings → Platforms/);
    }
  });

  it('ignores values that are not a declaration (a string "false", a category name)', () => {
    expect(() =>
      resolveYouTubeDeclaration(
        { madeForKids: 'false', categoryId: 'Film' },
        undeclared,
      ),
    ).toThrow(YouTubeDeclarationMissing);
  });
});

describe('YOUTUBE_CATEGORIES', () => {
  it('are numeric ids the database accepts, each once', () => {
    const ids = YOUTUBE_CATEGORIES.map((c) => c.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[0-9]{1,3}$/.test(id))).toBe(true);
    expect(isYouTubeCategoryId('22')).toBe(true);
    expect(isYouTubeCategoryId('Film')).toBe(false);
  });
});
