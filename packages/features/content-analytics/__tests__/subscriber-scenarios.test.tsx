/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ConnectionSubscriberSeries,
  buildLatestLevel,
  buildSubscriberSeries,
} from '@kit/clickhouse';
import {
  SCENARIO_TODAY,
  SCENARIO_WINDOW_FROM,
  SUBSCRIBER_SCENARIOS,
  type ScenarioId,
  type SubscriberScenario,
  scenarioById,
} from '@kit/clickhouse/testing';

import { SubscriberSeriesCard } from '../src/components/deep-dive/subscriber-series-card';
import {
  type YppChannelProgress,
  YppProgressCard,
} from '../src/components/deep-dive/ypp-progress-card';
import { measuredKey, toChartData } from '../src/lib/subscriber-chart-data';
import {
  NO_SUBSCRIBER_LEVEL,
  SUBSCRIBER_SOURCE_LABEL,
} from '../src/lib/subscriber-disclosure';

/**
 * Every channel state through every Deep Dive surface (FILM-1617): the
 * per-channel card, its empty state, the Total view and its notes, the chart
 * marks, and the YPP row. Built from the same fixtures and the same builders
 * the ClickHouse readers use, so a change anywhere upstream shows here.
 */

// The chart is SVG with no layout under happy-dom; its data is tested
// through `toChartData` below. Everything else is the real component.
vi.mock('recharts', () => ({
  CartesianGrid: () => null,
  Line: () => null,
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  XAxis: () => null,
  YAxis: () => null,
}));

// `@kit/ui` source cannot resolve React from its own folder under this
// runner (see metric-cards.test.tsx), so its primitives are stood in for.
// The stand-ins keep the behaviour the card relies on: the toggle reports
// its value, the progress bar renders nothing a text assertion reads.
vi.mock('@kit/ui/skeleton', () => ({
  Skeleton: () => <div data-test="skeleton" />,
}));

vi.mock('@kit/ui/progress', () => ({
  Progress: () => <div />,
}));

vi.mock('@kit/ui/toggle-group', async () => {
  const { createContext, useContext } = await import('react');
  const Ctx = createContext<(value: string) => void>(() => undefined);

  return {
    ToggleGroup: ({
      children,
      onValueChange,
    }: {
      children: React.ReactNode;
      onValueChange: (value: string) => void;
    }) => <Ctx.Provider value={onValueChange}>{children}</Ctx.Provider>,
    ToggleGroupItem: ({
      children,
      value,
    }: {
      children: React.ReactNode;
      value: string;
    }) => {
      const onValueChange = useContext(Ctx);

      return (
        <button type="button" onClick={() => onValueChange(value)}>
          {children}
        </button>
      );
    },
  };
});

vi.mock('@kit/ui/chart', () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ChartTooltip: () => null,
}));

const window = { from: SCENARIO_WINDOW_FROM, to: SCENARIO_TODAY };

function seriesOf(s: SubscriberScenario): ConnectionSubscriberSeries {
  return buildSubscriberSeries(
    { connectionId: s.connectionId, anchors: s.anchors, deltas: s.deltas },
    window,
  );
}

function channelOf(s: SubscriberScenario) {
  return {
    connectionId: s.connectionId,
    platform: s.platform,
    name: s.name,
    thumbnailUrl: null,
    isActive: s.isActive,
    language: 'en',
  };
}

const ALL = SUBSCRIBER_SCENARIOS;
const CHANNELS = ALL.map(channelOf);

function renderCard(ids: ScenarioId[]) {
  const scenarios = ids.map(scenarioById);

  return render(
    <SubscriberSeriesCard
      series={scenarios.map(seriesOf)}
      channels={CHANNELS}
    />,
  );
}

function showTotal() {
  fireEvent.click(screen.getByText('Total'));
}

function totalNote(): string {
  return (
    document.querySelector('[data-test="subscriber-series-total-note"]')
      ?.textContent ?? ''
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${SCENARIO_TODAY}T12:00:00Z`));
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('one channel selected: the card says why it has no line', () => {
  const EMPTY_STATE: Partial<Record<ScenarioId, string>> = {
    'never-measured': NO_SUBSCRIBER_LEVEL,
    'hidden-count': NO_SUBSCRIBER_LEVEL,
    'disconnected-never-measured': NO_SUBSCRIBER_LEVEL,
    'untracked-platform': 'aren’t tracked for Facebook',
    'active-stopped-before-window': 'No data since Jun 30, 2025',
    'disconnected-before-window': 'No data since Jun 30, 2025',
  };

  it.each(Object.entries(EMPTY_STATE))('%s', (id, text) => {
    renderCard([id as ScenarioId]);

    expect(
      document.querySelector('[data-test="subscriber-series-empty"]')
        ?.textContent,
    ).toContain(text);
  });

  it.each(ALL.filter((s) => !(s.id in EMPTY_STATE)).map((s) => s.id))(
    '%s draws a line',
    (id) => {
      renderCard([id]);

      expect(
        document.querySelector('[data-test="subscriber-series"]'),
      ).not.toBeNull();
    },
  );
});

describe('all channels, per channel: every channel without a line is explained', () => {
  const MISSING: Record<string, string> = {
    'Never Measured': NO_SUBSCRIBER_LEVEL,
    'Hidden Count': NO_SUBSCRIBER_LEVEL,
    'Retired Unmeasured': NO_SUBSCRIBER_LEVEL,
    'Facebook Page': 'aren’t tracked for Facebook',
    'Long Stopped Channel': 'No data since Jun 30, 2025',
    'Long Retired Channel': 'No data since Jun 30, 2025',
  };

  it.each(Object.entries(MISSING))('%s', (name, text) => {
    renderCard(ALL.map((s) => s.id));

    const item = [
      ...document.querySelectorAll(
        '[data-test="subscriber-series-missing"] li, [data-test="subscriber-series-untracked"]',
      ),
    ].find((el) => el.textContent?.includes(name));

    expect(item?.textContent).toContain(text);
  });
});

describe('the Total view', () => {
  it('names why the YouTube total is missing, channel by channel', () => {
    renderCard(ALL.map((s) => s.id));
    showTotal();

    const note = totalNote();

    expect(note).toContain(
      'Long Stopped Channel has no data since Jun 30, 2025',
    );
    expect(note).toContain(
      'Never Measured and Hidden Count have no subscriber count',
    );
    expect(note).not.toContain('Hidden Count has no data since');
  });

  it('never offers a total for an untracked platform', () => {
    renderCard(ALL.map((s) => s.id));
    showTotal();

    expect(totalNote()).not.toMatch(/facebook/i);
  });

  it('says where a total begins, and nothing about an end it doesn’t have', () => {
    renderCard(['healthy-rounded', 'healthy-exact']);
    showTotal();

    expect(totalNote()).toContain('YouTube total begins Jun 1, 2026');
    expect(totalNote()).not.toContain('ends');
  });

  it('says where and why a total ends early', () => {
    renderCard([
      'healthy-rounded',
      'healthy-exact',
      'active-stopped-in-window',
    ]);
    showTotal();

    expect(totalNote()).toContain(
      'It ends Jun 30, 2026, the last day Stopped Channel has data',
    );
  });

  it('leaves out a disconnected channel and names it', () => {
    renderCard(['healthy-rounded', 'disconnected-in-window']);
    showTotal();

    expect(totalNote()).toContain('Leaves out Retired Channel');
  });
});

describe('the total note and the channel list agree on every state', () => {
  // One rule for "ended" vs "no count yet", used by both: a state the list
  // calls ended, the total note must too, and the reverse.
  const EMPTY_ACTIVE_YOUTUBE = ALL.filter(
    (s) =>
      s.platform === 'youtube' && s.isActive && seriesOf(s).points.length === 0,
  );

  it.each(EMPTY_ACTIVE_YOUTUBE.map((s) => s.id))('%s', (id) => {
    renderCard(['healthy-exact', id]);

    const listed =
      [
        ...document.querySelectorAll(
          '[data-test="subscriber-series-missing"] li',
        ),
      ]
        .map((el) => el.textContent ?? '')
        .find((text) => text.includes(scenarioById(id).name)) ?? '';

    showTotal();

    const ended = /No data since/.test(listed);

    expect(totalNote().includes('has no data since')).toBe(ended);
    expect(totalNote().includes('no subscriber count')).toBe(!ended);
  });
});

describe('a channel missing from the channel list', () => {
  // Its platform is unknown, so it must not be called untracked: explain it
  // from its data alone.
  it('is explained from its data, not as an untracked platform', () => {
    render(
      <SubscriberSeriesCard
        series={[seriesOf(scenarioById('never-measured'))]}
        channels={[]}
      />,
    );

    const empty = document.querySelector(
      '[data-test="subscriber-series-empty"]',
    )?.textContent;

    expect(empty).toContain(NO_SUBSCRIBER_LEVEL);
    expect(empty).not.toContain('aren’t tracked');
  });
});

describe('presentation found in the all-scenarios evidence', () => {
  // Five chart colour tokens: the sixth line reused the first, and the key
  // could not tell two channels apart.
  it('gives every line its own colour, past five', () => {
    const { config } = toChartData(
      Array.from({ length: 10 }, (_, i) => ({
        key: `line-${i}`,
        name: `Line ${i}`,
        points: [],
      })),
    );

    const colours = Object.values(config).map((c) => c.color);

    expect(new Set(colours).size).toBe(colours.length);
  });

  it('lists untracked channels after the sentence, not as another one', () => {
    renderCard(ALL.map((s) => s.id));

    expect(
      document.querySelector('[data-test="subscriber-series-untracked"]')
        ?.textContent,
    ).toContain('channels: Facebook Page.');
  });

  it('says nothing about double counting when there is no total', () => {
    renderCard(ALL.map((s) => s.id));
    showTotal();

    expect(totalNote()).not.toContain('counted once for each');
  });

  it('still warns about double counting when a total is drawn', () => {
    renderCard(['healthy-rounded', 'healthy-exact']);
    showTotal();

    expect(totalNote()).toContain('counted once for each');
  });

  it('shows no line legend when nothing is drawn', () => {
    // Every state but the TikTok one, whose single channel is a TikTok
    // total of its own and so draws a line.
    renderCard(ALL.filter((s) => s.platform !== 'tiktok').map((s) => s.id));
    showTotal();

    expect(
      document.querySelector('[data-test="subscriber-source-legend"]'),
    ).toBeNull();
  });
});

// KB-114, option a (decided 2026-09-25): a channel whose platform reports
// no daily movement is drawn between its recorded counts, and says so.
describe('a channel drawn between its snapshots', () => {
  it('explains the points and the line between them', () => {
    renderCard(['snapshots-only']);

    expect(
      document.querySelector(
        '[data-test="subscriber-legend-between-snapshots"]',
      )?.textContent,
    ).toContain('reconstructed from follower snapshots');
    expect(
      document.querySelector('[data-test="subscriber-legend-snapshot-point"]')
        ?.textContent,
    ).toContain('A follower count recorded that day');
  });

  it('does not explain snapshot lines on a chart without one', () => {
    renderCard(['healthy-exact']);

    expect(
      document.querySelector(
        '[data-test="subscriber-legend-between-snapshots"]',
      ),
    ).toBeNull();
  });

  it('puts no solid stroke under the line: nothing between counts is measured', () => {
    const series = seriesOf(scenarioById('snapshots-only'));
    const { rows } = toChartData([
      { key: 'line', name: 'TikTok', points: series.points },
    ]);
    const between = rows.filter((r) => r.line__source === 'between_snapshots');

    expect(between.length).toBeGreaterThan(0);
    for (const row of between) {
      expect(row.line__measured).toBeNull();
    }
  });
});

describe('chart marks: every line with points is visible', () => {
  it.each(ALL.filter((s) => seriesOf(s).points.length > 0).map((s) => s.id))(
    '%s',
    (id) => {
      const series = seriesOf(scenarioById(id));
      const { rows } = toChartData([
        { key: 'line', name: id, points: series.points },
      ]);

      const values = rows.map((r) => r.line);
      const hasSegment = values.some(
        (v, i) => v != null && values[i + 1] != null,
      );
      const hasIsolatedMark = rows.some(
        (r) => r[measuredKey('line')] != null && r['line__isolated'] === true,
      );

      expect(hasSegment || hasIsolatedMark).toBe(true);
    },
  );
});

describe('labels: one description per source, on every surface', () => {
  // A rounded snapshot day is a measured day. The legend draws it solid; the
  // tooltip, the YPP row and the follower chip must say the same.
  it.each(['snapshot', 'constrained', 'clamped'] as const)(
    '%s reads as measured',
    (source) => {
      expect(SUBSCRIBER_SOURCE_LABEL[source]).toMatch(/^measured/);
    },
  );

  it('interpolated reads as reconstructed', () => {
    expect(SUBSCRIBER_SOURCE_LABEL.interpolated).toMatch(/^reconstructed/);
  });
});

describe('the YPP row', () => {
  function progressFor(id: ScenarioId): YppChannelProgress {
    const s = scenarioById(id);
    const level = buildLatestLevel({
      connectionId: s.connectionId,
      anchors: s.anchors,
      deltas: s.deltas,
    });

    return {
      connectionId: s.connectionId,
      channelName: s.name,
      watchHours: 10,
      targetWatchHours: 4000,
      watchHoursProgress: 0.01,
      subscribers: level?.level ?? null,
      subscribersSource: level?.source ?? null,
      subscribersAsOf: level?.date ?? null,
      subscribersRoundingStep: level?.roundingStep ?? 0,
      netSubscribers: 5,
      targetSubscribers: 1000,
      subscriberProgress: 0.005,
      watchHoursBasis: 'default',
      subscribersBasis: 'default',
      applicantStatus: 'unknown',
      escalated: false,
      joinedYppAt: null,
      alreadyJoined: false,
      windowDays: 365,
      subscribersReadFailed: false,
    };
  }

  function subscribersRow(): string {
    return (
      document.querySelector('[data-test="ypp-subscribers"]')?.textContent ?? ''
    );
  }

  it.each(['never-measured', 'hidden-count'] as const)(
    '%s is unavailable, never 0',
    (id) => {
      render(<YppProgressCard progress={progressFor(id)} />);

      expect(subscribersRow()).toContain('Unavailable');
      expect(subscribersRow()).not.toMatch(/\b0\b/);
    },
  );

  it('a current count is dated and not marked old', () => {
    render(<YppProgressCard progress={progressFor('healthy-exact')} />);

    expect(subscribersRow()).toContain('As of Sep 17, 2026');
    expect(subscribersRow()).not.toMatch(/no newer data/i);
  });

  it('an old count says there is no newer data', () => {
    render(
      <YppProgressCard progress={progressFor('active-stopped-in-window')} />,
    );

    expect(subscribersRow()).toContain('No newer data since Jun 30, 2026');
  });

  it('a failed level read says so, and keeps watch hours', () => {
    render(
      <YppProgressCard
        progress={{
          ...progressFor('healthy-exact'),
          subscribers: null,
          subscribersReadFailed: true,
        }}
      />,
    );

    expect(subscribersRow()).toContain('could not be loaded');
    expect(document.body.textContent).toContain('Watch hours');
  });
});
