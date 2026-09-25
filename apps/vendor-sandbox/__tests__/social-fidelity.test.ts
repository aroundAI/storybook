import { describe, expect, it } from 'vitest';

// The one parser of the capability reference (FILM-1721), shared with the
// request-site guard, so the sandbox and the app cannot read the index
// differently.
import { documentedNames } from '../../../packages/features/content-analytics/__tests__/helpers/capability-reference';
import {
  SERVED,
  type ServedEndpoint,
  registryProblems,
  undeclaredKeys,
} from '../src/social/fields';

/**
 * FILM-1802 criterion 5, as the lead ruled (2026-09-25): a field the app
 * reads must be documented for its endpoint in the field index; an envelope
 * field it ignores must cite the vendor's page. Each vendor PR adds its
 * endpoints to SERVED; this test holds every entry to the rule.
 */

const index = documentedNames();

describe('the field index is readable', () => {
  it('parses the blocks the sandbox will serve from', () => {
    for (const block of [
      'youtube/analytics-metrics',
      'tiktok/display-video',
      'instagram/media-insights',
      'instagram/media-fields',
    ]) {
      expect(index.get(block), block).toBeDefined();
    }
    expect(index.get('tiktok/display-video')!.has('view_count')).toBe(true);
  });
});

describe('every served endpoint is documented', () => {
  it.each(SERVED.map((e) => [`${e.origin} ${e.method} ${e.path}`, e] as const))(
    '%s',
    (_, endpoint) => {
      expect(registryProblems(endpoint, index)).toEqual([]);
    },
  );

  it('(no endpoints yet is fine: each vendor PR adds its own)', () => {
    expect(Array.isArray(SERVED)).toBe(true);
  });
});

describe('the rule catches what it is for (positive controls)', () => {
  const tiktokQuery: ServedEndpoint = {
    origin: 'tiktok',
    method: 'POST',
    path: '/v2/video/query/',
    block: 'tiktok/display-video',
    reads: ['id', 'view_count', 'like_count'],
    envelope: [
      {
        field: 'error',
        source: 'https://developers.tiktok.com/doc/tiktok-api-v2-video-query',
      },
    ],
  };

  it('accepts a documented entry', () => {
    expect(registryProblems(tiktokQuery, index)).toEqual([]);
  });

  it("refuses a read field the endpoint's block does not document", () => {
    // saves are not on the Display API (capability reference, TikTok)
    expect(
      registryProblems(
        { ...tiktokQuery, reads: [...tiktokQuery.reads, 'saves'] },
        index,
      ),
    ).toEqual([
      'tiktok POST /v2/video/query/: reads "saves", which "tiktok/display-video" does not document',
    ]);
  });

  it('refuses a field documented only for another endpoint', () => {
    // A Business API field served on the Display API endpoint.
    const businessOnly = [...(index.get('tiktok/business') ?? [])].find(
      (name) => !index.get('tiktok/display-video')!.has(name),
    );
    expect(businessOnly).toBeDefined();
    expect(
      registryProblems({ ...tiktokQuery, reads: [businessOnly!] }, index),
    ).toHaveLength(1);
  });

  it('refuses reads with no block, and a block the index lacks', () => {
    expect(
      registryProblems({ ...tiktokQuery, block: undefined }, index)[0],
    ).toMatch(/names no field-index block/);
    expect(
      registryProblems({ ...tiktokQuery, block: 'tiktok/made-up' }, index)[0],
    ).toMatch(/is not in the index/);
  });

  it('refuses an envelope citation that is not a vendor documentation page', () => {
    for (const source of [
      'https://stackoverflow.com/questions/1',
      'http://developers.tiktok.com/doc/x',
      'not a url',
      'https://developers.tiktok.com.evil.example/doc',
    ]) {
      expect(
        registryProblems(
          { ...tiktokQuery, envelope: [{ field: 'error', source }] },
          index,
        ),
      ).toHaveLength(1);
    }
  });

  it('lists every key a served body names that the entry does not declare, at any depth', () => {
    expect(
      undeclaredKeys(tiktokQuery, {
        data: { videos: [{ id: '1', view_count: 12, save_count: 3 }] },
        error: { code: 'ok', message: '', log_id: 'x' },
      }),
    ).toEqual(['code', 'data', 'log_id', 'message', 'save_count', 'videos']);
  });
});
