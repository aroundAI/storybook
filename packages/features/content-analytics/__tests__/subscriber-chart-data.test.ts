import { describe, expect, it } from 'vitest';

import {
  drawnRoundingError,
  measuredKey,
  toChartData,
} from '../src/lib/subscriber-chart-data';

describe('toChartData', () => {
  // Snapshots are daily, so almost every day is measured. The solid line is
  // the measured days; it breaks over a capture gap, where only the dashed
  // full line underneath shows through.
  it('puts measured days on the solid line and leaves gaps as null', () => {
    const { rows } = toChartData([
      {
        key: 'a',
        name: 'A',
        points: [
          { date: '2026-09-01', level: 100, source: 'snapshot' },
          { date: '2026-09-02', level: 101, source: 'interpolated' },
          { date: '2026-09-03', level: 102, source: 'constrained' },
        ],
      },
    ]);

    expect(rows.map((r) => [r.date, r.a, r[measuredKey('a')]])).toEqual([
      ['2026-09-01', 100, 100],
      ['2026-09-02', 101, null],
      ['2026-09-03', 102, 102],
    ]);
  });
});

describe('drawnRoundingError', () => {
  // A platform with no drawn line must not widen the warning under the chart.
  it('counts only totals that have points', () => {
    expect(
      drawnRoundingError([
        { points: [], roundingError: 999 },
        {
          points: [{ date: '2026-09-01', level: 1, source: 'snapshot' }],
          roundingError: 9,
        },
      ]),
    ).toBe(9);
  });

  it('is 0 when nothing is drawn', () => {
    expect(drawnRoundingError([{ points: [], roundingError: 999 }])).toBe(0);
  });
});
