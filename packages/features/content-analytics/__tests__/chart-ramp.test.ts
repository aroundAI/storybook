import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { TRAFFIC_SOURCE_GROUPS } from '@kit/clickhouse';

import { TRAFFIC_GROUP_COLORS } from '../src/components/deep-dive/traffic-share-card';
import {
  type LinearRgb,
  contrast,
  cvdDeltaE,
  normalDeltaE,
  parseColour,
} from './support/colour-distance';

/**
 * The chart ramp and the traffic card's use of it (FILM-1708), read out of
 * the stylesheet rather than restated: a test holding its own copy of the
 * colours would pass while the page drew something else.
 */
const styles = resolve(__dirname, '../../../../apps/web/styles');
const css = readFileSync(resolve(styles, 'shadcn-ui.css'), 'utf8');
const theme = readFileSync(resolve(styles, 'theme.css'), 'utf8');

function declarations(token: string) {
  return [...css.matchAll(new RegExp(`--${token}\\s*:\\s*([^;]+);`, 'g'))].map(
    (match) => match[1]!.trim(),
  );
}

/** `bg-chart-3 …` → `chart-3`; the class must name a ramp token. */
function tokenOf(classes: string) {
  return classes.match(/\bbg-(chart-[\w-]+?)(?=\s|$|\/)/)?.[1];
}

const SURFACES = {
  light: parseColour('rgb(255, 255, 255)'),
  // --card in the dark theme, #121212.
  dark: parseColour('rgb(18, 18, 18)'),
};

describe('the chart ramp', () => {
  const ramp = Array.from({ length: 8 }, (_, i) => `chart-${i + 1}`);

  it('defines each --chart-N exactly once, so no theme can disagree', () => {
    // On main the light block, :root and .dark each declared chart-1..6,
    // with the light block's oranges winning in light mode.
    for (const token of [
      ...ramp,
      'chart-neutral-strong',
      'chart-neutral-soft',
    ]) {
      expect(declarations(token), token).toHaveLength(1);
    }
  });

  it('maps every token to a Tailwind utility', () => {
    for (const token of [
      ...ramp,
      'chart-neutral-strong',
      'chart-neutral-soft',
    ]) {
      expect(theme).toMatch(
        new RegExp(`--color-${token}\\s*:\\s*var\\(--${token}\\)`),
      );
    }
  });

  it('passes the dataviz checks in its own order, on both surfaces', () => {
    const colours = ramp.map((token) => parseColour(declarations(token)[0]!));

    for (let i = 0; i < colours.length - 1; i++) {
      const pair = `${ramp[i]}/${ramp[i + 1]}`;

      expect(
        cvdDeltaE(colours[i]!, colours[i + 1]!),
        pair,
      ).toBeGreaterThanOrEqual(8);
      expect(
        normalDeltaE(colours[i]!, colours[i + 1]!),
        pair,
      ).toBeGreaterThanOrEqual(15);
    }

    for (const [token, colour] of ramp.map(
      (t, i) => [t, colours[i]!] as const,
    )) {
      expect(
        contrast(colour, SURFACES.light),
        `${token} on light`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(colour, SURFACES.dark),
        `${token} on dark`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('traffic group colours', () => {
  const colours = new Map<string, LinearRgb>(
    TRAFFIC_SOURCE_GROUPS.map((group) => {
      const token = tokenOf(TRAFFIC_GROUP_COLORS[group]);

      return [
        group,
        token && declarations(token).length === 1
          ? parseColour(declarations(token)[0]!)
          : ([NaN, NaN, NaN] as LinearRgb),
      ];
    }),
  );

  it('paints every group from a ramp token at full opacity', () => {
    // `bg-primary/40` and `bg-muted-foreground/40` were here: a theme's
    // primary can be the same blue as chart-1, and an alpha is not a colour.
    for (const group of TRAFFIC_SOURCE_GROUPS) {
      const classes = TRAFFIC_GROUP_COLORS[group];

      expect(tokenOf(classes), group).toBeDefined();
      expect(classes, group).not.toMatch(/bg-[\w-]+\/\d+/);
    }
  });

  it('gives eight groups eight different tokens', () => {
    const tokens = TRAFFIC_SOURCE_GROUPS.map((g) =>
      tokenOf(TRAFFIC_GROUP_COLORS[g]),
    );

    expect(new Set(tokens).size).toBe(TRAFFIC_SOURCE_GROUPS.length);
  });

  it('keeps every pair of groups apart, colour-blind or not', () => {
    // All 28 pairs, not only stack neighbours: a group with no views drops
    // out of a column, so any two groups can end up touching.
    const failures: string[] = [];

    for (let i = 0; i < TRAFFIC_SOURCE_GROUPS.length; i++) {
      for (let j = i + 1; j < TRAFFIC_SOURCE_GROUPS.length; j++) {
        const [a, b] = [TRAFFIC_SOURCE_GROUPS[i]!, TRAFFIC_SOURCE_GROUPS[j]!];
        const cvd = cvdDeltaE(colours.get(a)!, colours.get(b)!);
        const normal = normalDeltaE(colours.get(a)!, colours.get(b)!);

        if (!(cvd >= 8) || !(normal >= 15)) {
          failures.push(
            `${a}/${b}: cvd ${cvd.toFixed(1)}, normal ${normal.toFixed(1)}`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('separates direct from other by lightness, not alpha', () => {
    const lightness = (group: 'direct' | 'other') => {
      const value = declarations(tokenOf(TRAFFIC_GROUP_COLORS[group])!)[0]!;

      return Number(value.match(/oklch\(\s*([\d.]+)%/)?.[1]);
    };

    expect(lightness('other') - lightness('direct')).toBeGreaterThanOrEqual(30);
    // Other is the residual: hatched, so it does not read as an eighth peer.
    expect(TRAFFIC_GROUP_COLORS.other).toContain('repeating-linear-gradient');
  });
});
