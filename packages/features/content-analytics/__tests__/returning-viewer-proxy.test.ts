import { describe, expect, it } from 'vitest';

import { returningViewerClaim } from '../src/components/deep-dive/returning-viewer-proxy-card';
import { rolling90Claim } from '../src/components/deep-dive/rolling-90-card';
import { CAUSAL_VOCABULARY } from '../src/components/overview/card-claim';
import { subscribedSplit } from '../src/lib/returning-viewer-proxy';

describe('subscribedSplit', () => {
  it('shares subscribed views over all views, from the counts', () => {
    const split = subscribedSplit([
      { key: 'subscribed', views: 300 },
      { key: 'not_subscribed', views: 700 },
      { key: 'subscribed', views: 50 },
      { key: 'not_subscribed', views: 150 },
    ]);

    // 350 of 1,200: not the mean of 30% and 25%.
    expect(split.subscribedViews).toBe(350);
    expect(split.notSubscribedViews).toBe(850);
    expect(split.subscribedShare).toBeCloseTo(350 / 1200, 10);
  });

  it('is null, not 0%, when there are no audience rows', () => {
    expect(subscribedSplit([]).subscribedShare).toBeNull();
    expect(
      subscribedSplit([{ key: 'subscribed', views: 0 }]).subscribedShare,
    ).toBeNull();
  });
});

describe('returningViewerClaim', () => {
  it('names itself a proxy and asserts no cause', () => {
    const claim = returningViewerClaim(
      subscribedSplit([
        { key: 'subscribed', views: 1 },
        { key: 'not_subscribed', views: 3 },
      ]),
    );

    expect(claim.figure).toBe('25%');
    expect(claim.sentence).toContain('proxy');
    expect(claim.sentence).not.toMatch(CAUSAL_VOCABULARY);
  });

  it('gives no figure when nothing was reported', () => {
    const claim = returningViewerClaim(subscribedSplit([]));

    expect(claim.figure).toBeNull();
    expect(claim.noFigure).toBeTruthy();
  });
});

function days(count: number, views: (index: number) => number) {
  let rolling = 0;
  const daily = Array.from({ length: count }, (_, index) => views(index));

  return daily.map((dayViews, index) => {
    rolling += dayViews;

    if (index >= 90) rolling -= daily[index - 90]!;

    const date = new Date(Date.UTC(2026, 0, 1 + index))
      .toISOString()
      .slice(0, 10);

    return { date, views: dayViews, rollingViews: rolling };
  });
}

describe('rolling90Claim', () => {
  it('leads with the newest window and sets the previous one beside it', () => {
    const claim = rolling90Claim(
      days(200, () => 10),
      90,
    );

    // 90 days at 10 views a day.
    expect(claim.figure).toBe('900');
    expect(claim.sentence).toContain('against 900');
  });

  it('omits the comparison when the earlier window would be incomplete', () => {
    const claim = rolling90Claim(
      days(120, () => 10),
      90,
    );

    expect(claim.figure).toBe('900');
    expect(claim.sentence).not.toContain('against');
  });

  it('says there is not enough history rather than showing a short window', () => {
    const claim = rolling90Claim(
      days(30, () => 10),
      90,
    );

    expect(claim.figure).toBeNull();
    expect(claim.noFigure).toBe('Not enough history yet.');
  });

  it('gives no figure when every day is empty', () => {
    const claim = rolling90Claim(
      days(120, () => 0),
      90,
    );

    expect(claim.figure).toBeNull();
  });
});
