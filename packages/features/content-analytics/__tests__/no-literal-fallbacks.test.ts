import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { AudienceDimension } from '@kit/clickhouse/server';

import { AUDIENCE_DIMENSION_READERS } from '../src/lib/audience-dimensions';

/**
 * FILM-1701. Three Audience cards rendered constants typed into a source
 * file — `data?.deviceType || DEFAULT_DEVICE_TYPES` — and no server type
 * carried the left-hand side, so the fallback was the only code path. A
 * fallback to a constant reads exactly like a fallback to a computed default
 * at the call site, which is how it survived review; so the rule is checked
 * by reading the source rather than by anyone remembering it.
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

describe('no analytics figure falls back to a literal', () => {
  const files = sourceFiles(SRC);

  it('finds the files it guards', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(
      files.some((file) => file.endsWith('audience/audience-grid.tsx')),
    ).toBe(true);
  });

  it('never falls back to a DEFAULT_* constant with ||', () => {
    // The spec's own acceptance check, package-wide:
    //   grep -rn "|| DEFAULT_" packages/features/content-analytics/src
    expect(offences(files, /\|\|\s*DEFAULT_/)).toEqual([]);
  });

  it('never falls back to a DEFAULT_* constant in a component, by either operator', () => {
    // `??` too, but only where figures are rendered: on the server
    // `options?.maxVideos ?? DEFAULT_MAX_VIDEOS` is a setting, not a figure.
    const components = files.filter((file) =>
      file.includes(`${join(SRC, 'components')}/`),
    );

    expect(components.length).toBeGreaterThan(50);
    expect(offences(components, /(\|\||\?\?)\s*DEFAULT_/)).toEqual([]);
  });

  it('never falls back to a non-zero number on the Audience tab', () => {
    // `|| 58` is a gender share nobody measured. `|| 0` stays legal: it is
    // only ever reached for a key the rows do not have, and the cards do not
    // render a key without rows.
    const audience = files.filter((file) =>
      file.includes(join('components', 'audience')),
    );

    expect(offences(audience, /(\|\||\?\?)\s*[1-9]/)).toEqual([]);
  });

  it('has deleted the two cards that had no data behind them', () => {
    for (const file of [
      'components/audience/interests-card.tsx',
      'components/audience/peak-activity-card.tsx',
    ]) {
      expect(existsSync(join(SRC, file)), file).toBe(false);
    }

    expect(
      offences(files, /InterestsCard|PeakActivityCard|PeakActivityGrid/),
    ).toEqual([]);
  });
});

/**
 * "A dimension that is ingested is either read or removed from ingest."
 * `device`, `os`, `city` and `follower_status` were written on every sync
 * and read by nothing on the Audience tab, and the absence of a card read as
 * the absence of data.
 *
 * `AUDIENCE_DIMENSION_READERS` is a `Record<AudienceDimension, …>`, so a new
 * dimension does not compile until someone decides which it is. This binds
 * each "read" entry to a file that really does ask for it.
 */
describe('every audience dimension is read, or recorded as unread', () => {
  const entries = Object.entries(AUDIENCE_DIMENSION_READERS) as Array<
    [AudienceDimension, (typeof AUDIENCE_DIMENSION_READERS)[AudienceDimension]]
  >;

  it.each(entries.filter(([, entry]) => entry.status === 'read'))(
    '%s is asked for by the file that claims to read it',
    (dimension, entry) => {
      if (entry.status !== 'read') throw new Error('unreachable');

      const source = readFileSync(join(SRC, entry.readBy), 'utf8');

      expect(source).toContain(`dimension: '${dimension}'`);
    },
  );

  it.each(entries.filter(([, entry]) => entry.status === 'unread'))(
    '%s is asked for by nothing, as recorded',
    (dimension) => {
      expect(
        offences(sourceFiles(SRC), new RegExp(`dimension: '${dimension}'`)),
      ).toEqual([]);
    },
  );

  it('matches the list in the spec', () => {
    const spec = readFileSync(
      resolve(
        __dirname,
        '../../../../specs/phase-17-analytics-provenance/FILM-1701-audience-truth-up.md',
      ),
      'utf8',
    );

    for (const [dimension, entry] of entries) {
      expect(spec, dimension).toContain(
        `| \`${dimension}\` | ${entry.status} |`,
      );
    }
  });
});
