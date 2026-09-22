import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-16. The Overview tab drew figures nobody measured: a share donut that
 * was 83/17 for every account (`breakdown || { direct: 83, copyLink: 17 }`),
 * a revenue split that was `revenue * 0.7` and `revenue * 0.3`, a footer
 * reading "Projection: $10k by month end", and a `+100.0%` beside every
 * metric because `calculateChange(n, 0)` called a change from nothing a
 * doubling. One defect seven times: a component that accepts optional data
 * and, when it is absent, draws something anyway.
 *
 * FILM-1701's `no-literal-fallbacks.test.ts` guards the Audience components
 * the same way. This file mirrors its helpers so the two collapse into one
 * by deletion once both are on `main`.
 */
const SRC = resolve(__dirname, '../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      return name === '__tests__' || name === '__mocks__'
        ? []
        : sourceFiles(path);
    }

    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function offences(files: string[], pattern: RegExp) {
  return files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        pattern.test(line)
          ? [`${relative(SRC, file)}:${index + 1}: ${line.trim()}`]
          : [],
      ),
  );
}

/**
 * The literal footers an Overview card may print. A footer earns its place
 * by stating a denominator or a caveat — what the figure is over, or what
 * it leaves out — never by sounding insightful. Anything not listed here
 * is an offence; an entry whose file no longer carries it is harmless.
 */
const ALLOWED_LITERAL_FOOTERS: Record<string, string[]> = {
  // The project totals are not narrowed by the platform filter, and the
  // footer says so.
  'components/overview/likes-card.tsx': ['Aggregated across all platforms'],
  // Untrue whatever the filter says. FILM-1701 (#288) deletes it, and this
  // entry with it; it is listed only so that KB-16 does not edit that file.
  'components/overview/views-card.tsx': ['Aggregated across TikTok, YT, Insta'],
  'components/overview/comments-card.tsx': ['Aggregated across all platforms'],
  // Where the rows come from, on cards that render only when rows exist.
  'components/overview/gender-card.tsx': [
    'Based on platform demographics data',
  ],
  'components/overview/top-regions-card.tsx': [
    'Based on platform geography data',
  ],
  // Channel-level income has no project, and the card says it is not here.
  'components/overview/revenue-card.tsx': [
    'Revenue recorded against this project’s videos. Channel-level income is on the account’s Revenue tab.',
  ],
};

describe('no Overview figure falls back to a literal', () => {
  const files = sourceFiles(SRC);
  const overview = files.filter((file) =>
    file.includes(join('components', 'overview')),
  );
  const cards = [...overview, join(SRC, 'components', 'metric-cards.tsx')];

  it('finds the files it guards', () => {
    expect(overview.length).toBeGreaterThan(10);
    expect(files).toContain(join(SRC, 'components', 'metric-cards.tsx'));
    expect(files).toContain(join(SRC, 'lib', 'format.ts'));
    expect(files).toContain(join(SRC, 'lib', 'insights-utils.ts'));
  });

  it('never falls back to a non-zero number', () => {
    expect(offences(cards, /(\|\||\?\?)\s*[1-9]/)).toEqual([]);
  });

  it('never falls back to an object literal of figures', () => {
    // `breakdown || { direct: 83, copyLink: 17 }` — "from prototype".
    expect(offences(cards, /(\|\||\?\?)\s*\{[^}]*:\s*\d/)).toEqual([]);
  });

  it('never scales a figure by a literal fraction', () => {
    // `revenue * 0.7` is a split nobody measured.
    expect(offences(cards, /\*\s*0\.\d/)).toEqual([]);
  });

  it('never chooses a literal share when the breakdown is absent', () => {
    // A ternary whose else-branch is a bare number: `breakdown ? … : 70;`.
    expect(offences(cards, /:\s*[1-9]\d*(\.\d+)?;$/)).toEqual([]);
  });

  it('never reads an absent previous period as zero', () => {
    // `previousData?.views || 0` turns "no comparison" into "up from nothing".
    expect(offences(cards, /previous\w*\?\.\w+\s*(\|\||\?\?)\s*0\b/)).toEqual(
      [],
    );
  });

  it('never reports a change from nothing as 100%', () => {
    // `current > 0 ? 100 : 0` in both the card helper and the LLM input.
    expect(
      offences(
        [join(SRC, 'lib', 'format.ts'), join(SRC, 'lib', 'insights-utils.ts')],
        /\?\s*100\s*:/,
      ),
    ).toEqual([]);
  });

  it('prints no literal footer that is not a denominator or a caveat', () => {
    const literal =
      /footer=(?:"([^"]*)"|\{[^}]*?(?:\|\||\?\?)\s*'([^']*)'\s*\})/;

    const unlisted = overview.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) => {
          const match = literal.exec(line);

          if (!match) return [];

          const text = match[1] ?? match[2] ?? '';
          const allowed =
            ALLOWED_LITERAL_FOOTERS[relative(SRC, file)]?.includes(text) ??
            false;

          return allowed
            ? []
            : [`${relative(SRC, file)}:${index + 1}: ${line.trim()}`];
        }),
    );

    expect(unlisted).toEqual([]);
  });

  it('keeps no prop that carried invented data', () => {
    // The grid accepted these, nothing ever passed them, and the cards drew
    // a default in their place. The props are gone, not defaulted.
    expect(
      offences(overview, /shareBreakdown|revenueBreakdown|projection\?:/),
    ).toEqual([]);
  });
});
