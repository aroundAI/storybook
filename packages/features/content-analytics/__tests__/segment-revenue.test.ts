import { describe, expect, it } from 'vitest';

import { createSegmentRevenueFold } from '../src/lib/segment-revenue';

const membership = () =>
  new Map([
    ['v1', ['topic:cooking', 'format:tutorial']],
    ['v2', ['topic:cooking']],
  ]);

const revenue = (publishId: string | null, cents: number) => ({
  publish_id: publishId,
  revenue_cents: cents,
});

describe('createSegmentRevenueFold', () => {
  it('adds a video revenue to every segment it belongs to', () => {
    const fold = createSegmentRevenueFold(membership());

    fold.add(revenue('v1', 1000));

    // A video in two segments contributes to both, exactly as it
    // contributes its views to both medians. Segment totals therefore do
    // not sum to the account total — a property of overlapping segments,
    // not double-counting.
    expect(fold.result().revenueBySegment.get('topic:cooking')).toBe(1000);
    expect(fold.result().revenueBySegment.get('format:tutorial')).toBe(1000);
  });

  it('accumulates across videos and rows', () => {
    const fold = createSegmentRevenueFold(membership());

    fold.add(revenue('v1', 1000));
    fold.add(revenue('v2', 250));
    fold.add(revenue('v2', 250));

    expect(fold.result().revenueBySegment.get('topic:cooking')).toBe(1500);
  });

  it('holds channel-level revenue aside rather than dropping it', () => {
    // A row with no publish belongs to a channel, not to any video, so it
    // cannot be attributed to a tag. Dropping it silently would understate
    // every segment's RPM against a total shown on another screen.
    const fold = createSegmentRevenueFold(membership());

    fold.add(revenue(null, 5000));

    expect(fold.result().excludedRevenueCents).toBe(5000);
    expect(fold.result().revenueBySegment.size).toBe(0);
  });

  it('ignores revenue for a video outside the segment set', () => {
    // Videos excluded for immaturity or predating ingest are absent from
    // the membership. Their revenue must not land in a segment whose views
    // do not include them, or the rate is inflated.
    const fold = createSegmentRevenueFold(membership());

    fold.add(revenue('v-unknown', 9999));

    expect(fold.result().revenueBySegment.size).toBe(0);
    expect(fold.result().excludedRevenueCents).toBe(0);
  });

  it('starts empty', () => {
    const fold = createSegmentRevenueFold(new Map());

    expect(fold.result()).toEqual({
      revenueBySegment: new Map(),
      excludedRevenueCents: 0,
    });
  });
});
