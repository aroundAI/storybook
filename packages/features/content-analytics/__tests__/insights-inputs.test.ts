import { describe, expect, it } from 'vitest';

import {
  audienceForInsights,
  buildTrendFacts,
  previousPeriod,
  topContentForInsights,
} from '../src/lib/insights-inputs';
import { recorded } from './helpers/recorded-rate';

const row = (platform: string, views: number, likes = 0) => ({
  platform,
  views,
  likes,
  comments: 0,
  shares: 0,
});

describe('previousPeriod', () => {
  it('is the same length, ending the day before the range starts', () => {
    const range = {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-10-01T00:00:00Z'),
    };

    const before = previousPeriod(range)!;

    expect(before.to.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(before.to.getTime() - before.from.getTime()).toBe(
      range.to.getTime() - range.from.getTime(),
    );
  });

  it('is null without both ends', () => {
    expect(previousPeriod({ from: new Date() })).toBeNull();
    expect(previousPeriod({})).toBeNull();
  });
});

describe('buildTrendFacts', () => {
  it('reports the change for the selected platforms and for each one', () => {
    const facts = buildTrendFacts(
      [row('youtube', 150), row('tiktok', 50)],
      [row('youtube', 100), row('tiktok', 100), row('instagram', 900)],
    );

    expect(facts).toContainEqual({
      metric: 'views',
      platform: 'all',
      current: 200,
      previous: 200,
      changePercent: 0,
    });
    expect(facts).toContainEqual({
      metric: 'views',
      platform: 'youtube',
      current: 150,
      previous: 100,
      changePercent: 50,
    });
    expect(facts).toContainEqual({
      metric: 'views',
      platform: 'tiktok',
      current: 50,
      previous: 100,
      changePercent: -50,
    });
  });

  it('leaves out a metric with no baseline rather than reporting 0%', () => {
    const facts = buildTrendFacts(
      [row('youtube', 150, 10)],
      [row('youtube', 100, 0)],
    );

    expect(facts.map((f) => f.metric)).toEqual(['views', 'views']);
  });

  it('is empty when there is no previous period or nothing in it', () => {
    expect(buildTrendFacts([row('youtube', 10)], undefined)).toEqual([]);
    expect(buildTrendFacts(undefined, [row('youtube', 10)])).toEqual([]);
    expect(buildTrendFacts([row('youtube', 10)], [])).toEqual([]);
    expect(buildTrendFacts([row('youtube', 10)], [row('youtube', 0)])).toEqual(
      [],
    );
  });
});

describe('topContentForInsights', () => {
  const item = (id: string, views: number, publishTitle = '') => ({
    publishId: id,
    episodeTitle: `Episode ${id}`,
    publishTitle,
    platform: 'youtube',
    views,
    likes: 1,
    engagementRate: recorded(0.1),
  });

  it('keeps the five most viewed, by views, and skips unviewed content', () => {
    const top = topContentForInsights([
      ...['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => item(id, 10 + i)),
      item('zero', 0),
    ]);

    expect(top?.map((t) => t.id)).toEqual(['f', 'e', 'd', 'c', 'b']);
  });

  it('titles with the publish title, falling back to the episode’s', () => {
    const top = topContentForInsights([item('a', 5, 'Custom'), item('b', 4)]);

    expect(top?.map((t) => t.title)).toEqual(['Custom', 'Episode b']);
  });

  it('is undefined when nothing was viewed', () => {
    expect(topContentForInsights(undefined)).toBeUndefined();
    expect(topContentForInsights([item('a', 0)])).toBeUndefined();
  });
});

describe('audienceForInsights', () => {
  it('passes only the splits that were measured', () => {
    expect(
      audienceForInsights({
        demographics: { ageGroups: { '25-34': 40 }, genders: {} },
        geography: {},
      }),
    ).toEqual({ demographics: { ageGroups: { '25-34': 40 } } });
  });

  it('keeps the ten largest countries', () => {
    const geography = Object.fromEntries(
      Array.from({ length: 15 }, (_, i) => [`C${i}`, i + 1]),
    );

    const sent = audienceForInsights({ geography })!.geography!;

    expect(Object.keys(sent)).toHaveLength(10);
    expect(sent.C14).toBe(15);
    expect(sent.C0).toBeUndefined();
  });

  it('is undefined when nothing was reported', () => {
    expect(audienceForInsights(null)).toBeUndefined();
    expect(audienceForInsights({ demographics: {}, geography: {} })).toBe(
      undefined,
    );
  });
});
