/**
 * @vitest-environment happy-dom
 */
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ObservedCoverageRow, capabilityFor } from '@kit/clickhouse';

import {
  AgeDistributionCard,
  NotCollectedCard,
} from '../src/components/audience';
import {
  topAgeGroupClaim,
  topDeviceClaim,
} from '../src/components/audience/audience-claims';
import { ContentCard } from '../src/components/content/content-card';
import { CAUSAL_VOCABULARY } from '../src/components/overview/card-claim';
import { platformLabel } from '../src/lib/platform-labels';
import {
  channelRef,
  coverageResult,
  renderWithCoverage,
} from './helpers/coverage';

vi.mock('next/image', () => ({
  default: (props: { alt: string }) => <span data-image={props.alt} />,
}));

/**
 * FILM-1707: the Audience and Content tabs on the one card shell — every
 * card a chip, an Instagram audience never presented as per-video, and one
 * platform indication per content card.
 */
afterEach(cleanup);

const row = (
  table: ObservedCoverageRow['table'],
  platform: string,
): ObservedCoverageRow => ({
  table,
  platform,
  rows: 10,
  latestDate: '2026-09-29',
  metricSources: [],
});

const shell = (container: HTMLElement) =>
  container.querySelector('[data-card-shell="analytics"]');

describe('an Instagram audience', () => {
  const instagramNote = capabilityFor('demographics', 'instagram').note;

  it('is said, on the card, to be the account’s followers', () => {
    const { container } = renderWithCoverage(
      <AgeDistributionCard ageGroups={{ 'age18-24': 40, 'age25-34': 60 }} />,
      {
        result: coverageResult({
          rows: [row('video_audience', 'instagram')],
          channels: [channelRef('instagram')],
        }),
      },
    );

    const note = container.querySelector('[data-test="card-scope-note"]');

    expect(note?.textContent).toContain(instagramNote);
    expect(instagramNote).toMatch(/not of each post’s viewers/);
  });

  it('adds nothing when only per-video audiences are covered', () => {
    const { container } = renderWithCoverage(
      <AgeDistributionCard ageGroups={{ 'age18-24': 40 }} />,
      {
        result: coverageResult({
          rows: [row('video_audience', 'youtube')],
          channels: [channelRef('youtube')],
        }),
      },
    );

    expect(container.querySelector('[data-test="card-scope-note"]')).toBeNull();
  });

  it('is never called per-video in the card’s own copy', () => {
    const { container } = renderWithCoverage(
      <AgeDistributionCard ageGroups={{ 'age18-24': 40 }} />,
    );

    expect(container.textContent).not.toMatch(/per[- ]video|each video/i);
  });
});

describe('the Audience cards are on the shell', () => {
  it('draws the Age card on AnalyticsCard with its family and a chip', () => {
    const { container } = renderWithCoverage(
      <AgeDistributionCard ageGroups={{ 'age25-34': 80, 'age18-24': 20 }} />,
    );

    expect(shell(container)?.getAttribute('data-metric-family')).toBe(
      'demographics',
    );
    expect(
      container.querySelector('[data-test="provenance-chip"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-test="card-figure"]')?.textContent,
    ).toBe('80.0%');
  });

  it('chips a slot we do not collect as such, with its reason', () => {
    const { container } = renderWithCoverage(
      <NotCollectedCard
        title="Peak Activity"
        reason="Nothing we ingest says when viewers are online."
        data-test="audience-card-peak-activity"
      />,
    );

    expect(shell(container)?.getAttribute('data-metric-family')).toBe(
      'not_collected',
    );
    expect(
      container.querySelector('[data-test="provenance-chip"]')?.textContent,
    ).toBe('Not collected');
    expect(
      container.querySelector('[data-test="audience-not-collected"]')
        ?.textContent,
    ).toContain("We don't collect this");
  });
});

describe('Audience claims', () => {
  it('names the largest group, or every one that ties', () => {
    expect(
      topAgeGroupClaim([
        { label: '18-24 years', percentage: 20 },
        { label: '25-34 years', percentage: 80 },
      ]),
    ).toEqual({
      figure: '80.0%',
      sentence: '25-34 years is the largest age group.',
    });
    expect(
      topDeviceClaim([
        { label: 'Mobile', percentage: 50 },
        { label: 'Desktop', percentage: 50 },
      ]).sentence,
    ).toBe('Mobile and Desktop are level as the largest device type.');
  });

  it('gives a reason, not a zero, when nothing was reported', () => {
    expect(topAgeGroupClaim([])).toMatchObject({ figure: null });
    expect(topDeviceClaim([])).toMatchObject({ figure: null });
  });
});

describe('a content card', () => {
  const card = (platform: 'youtube' | 'tiktok') => (
    <ContentCard
      publishId="p-1"
      title="Pilot"
      platform={platform}
      publishedAt="2026-09-03T00:00:00.000Z"
      views={1200}
      likes={30}
      comments={4}
      engagementRate={2.8}
    />
  );

  it.each(['youtube', 'tiktok'] as const)(
    'says its platform once, in the chip (%s)',
    (platform) => {
      const { container } = renderWithCoverage(card(platform));
      const label = platformLabel(platform);
      const text = container.textContent ?? '';

      expect(text.split(label).length - 1).toBe(1);
      expect(
        container.querySelector('[data-test="provenance-chip"]')?.textContent,
      ).toContain(label);
    },
  );

  it('leads with its views, and says nothing causal', () => {
    const { container } = renderWithCoverage(card('youtube'));
    const sentence =
      container.querySelector('[data-test="card-sentence"]')?.textContent ?? '';

    expect(
      container.querySelector('[data-test="card-figure"]')?.textContent,
    ).toBe('1.2K');
    expect(sentence).toContain('2.8% engagement');
    expect(sentence).not.toMatch(CAUSAL_VOCABULARY);
  });
});
