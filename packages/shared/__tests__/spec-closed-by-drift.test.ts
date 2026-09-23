import { load } from 'js-yaml';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-80. A spec's open work must not point at work that is already finished.
 *
 * Specs record what is left as `remaining: [{criterion, reason, closed_by}]`
 * (`specs/SCHEMA.md`). When a known bug is fixed or a spec is marked DONE, the
 * specs that point at it with `closed_by` were not always updated, so a
 * dependency query reported finished work as open. FILM-305, FILM-502 and
 * FILM-503 still waited on KB-14 after #309 fixed it.
 *
 * The rule: any item under a spec that carries a `closed_by` and is not
 * `met: true` (every `remaining` item, and any unmet acceptance criterion or
 * test-plan item that names one) is a violation when an id in its `closed_by`
 * is
 *
 *   (a) a KB id that is **Fixed** in `specs/cross-cutting/FILM-CC-04-known-bugs.md`:
 *       - its row in the `## Fixed` table is the source of truth. A row whose
 *         ID cell lists several ids (`KB-9, KB-10`) fixes each of them; an id
 *         marked `(part)` (`KB-6 (part)`) is fixed only in part and is NOT
 *         fixed. A row counts without an entry: an entry's text can land in a
 *         later PR than its fix.
 *       - an entry whose opening banner (before its first `###`) says
 *         `**Fixed**` or `**Fixed (<date>)` also counts, unless the banner's
 *         own paragraph says "in part" or "(part)"; the second test
 *         below requires such an entry to have its Fixed-table row, so the two
 *         records cannot disagree;
 *   (b) a spec whose `status` is DONE or RETIRED.
 *
 * A `closed_by` naming several ids (`KB-17 (delete); KB-27 (RPC)`) is checked
 * id by id: each id is a claim that the work is still pending there.
 *
 * To clear a violation, verify the item against the code: move it out of
 * `remaining` as `met: true` with `evidence`, or keep it with a corrected
 * `reason` and a `closed_by` that names the work actually left.
 */

const REPO = resolve(__dirname, '../../..');
const SPECS_DIR = join(REPO, 'specs');
const KNOWN_BUGS = join(SPECS_DIR, 'cross-cutting/FILM-CC-04-known-bugs.md');

const KB_ID = /\bKB-\d+\b/g;
const SPEC_ID = /\b(?:FILM|SPIKE)-(?:[A-Z]{2}-)?\d+[a-z]?\b/g;
const CLOSED_STATUSES = new Set(['DONE', 'RETIRED']);
const BANNER = /\*\*Fixed\*\*|\*\*Fixed \(\d{4}-\d{2}-\d{2}\)/;

interface SpecRecord {
  file: string;
  data: unknown;
}

interface Pointer {
  closedBy: string;
  label: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every object under the spec that names a `closed_by` and is not met. */
function openPointers(node: unknown, path: string): Pointer[] {
  if (Array.isArray(node)) {
    return node.flatMap((child, i) => openPointers(child, `${path}[${i}]`));
  }
  if (!isRecord(node)) return [];

  const own: Pointer[] = [];
  if (typeof node.closed_by === 'string' && node.met !== true) {
    const text = node.criterion ?? node.text;
    own.push({
      closedBy: node.closed_by,
      label: typeof text === 'string' ? text : path,
    });
  }

  return own.concat(
    Object.entries(node).flatMap(([key, child]) =>
      openPointers(child, path ? `${path}.${key}` : key),
    ),
  );
}

function splitSections(markdown: string, marker: RegExp) {
  const lines = markdown.split('\n');
  const starts = lines.flatMap((line, i) => (marker.test(line) ? [i] : []));

  return starts.map((start, n) => {
    const end = starts[n + 1] ?? lines.length;
    const nextH2 = lines.findIndex((l, i) => i > start && /^## /.test(l));
    return lines
      .slice(start, nextH2 === -1 ? end : Math.min(end, nextH2))
      .join('\n');
  });
}

/** KB ids fixed per the `## Fixed` table, with the PR cell as the reason. */
function fixedFromTable(markdown: string): Map<string, string> {
  const fixed = new Map<string, string>();
  const [section] = splitSections(markdown, /^## Fixed\s*$/);
  if (!section) return fixed;

  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const idCell = cells[1] ?? '';
    const prCell = cells[cells.length - 2] ?? '';

    for (const part of idCell.split(',')) {
      const id = part.trim();
      if (/^KB-\d+$/.test(id)) fixed.set(id, `Fixed table, ${prCell}`);
    }
  }
  return fixed;
}

/** KB ids whose entry's opening banner says Fixed (not "in part"). */
function fixedFromBanners(markdown: string): Map<string, string> {
  const fixed = new Map<string, string>();

  for (const entry of splitSections(markdown, /^## KB-\d+\b/)) {
    const id = /^## (KB-\d+)/.exec(entry)?.[1];
    if (!id) continue;
    const lead = entry.split(/\n### /)[0] ?? '';
    const paragraph = lead.split(/\n\s*\n/).find((p) => BANNER.test(p));
    const banner = paragraph ? BANNER.exec(paragraph)?.[0] : undefined;
    if (paragraph && banner && !/in part|\(part\)/i.test(paragraph)) {
      fixed.set(id, `entry banner ${banner}`);
    }
  }
  return fixed;
}

function findViolations(specs: SpecRecord[], knownBugs: string): string[] {
  const fixed = new Map([
    ...fixedFromBanners(knownBugs),
    ...fixedFromTable(knownBugs),
  ]);

  const statusById = new Map<string, string>();
  for (const { data } of specs) {
    if (isRecord(data) && typeof data.spec_id === 'string') {
      statusById.set(data.spec_id, String(data.status));
    }
  }

  const violations: string[] = [];
  for (const { file, data } of specs) {
    const specId =
      isRecord(data) && typeof data.spec_id === 'string' ? data.spec_id : file;

    for (const { closedBy, label } of openPointers(data, '')) {
      for (const kb of new Set(closedBy.match(KB_ID) ?? [])) {
        const why = fixed.get(kb);
        if (why) {
          violations.push(
            `${specId} → ${closedBy} (${kb} is Fixed: ${why}) — "${label}"`,
          );
        }
      }
      for (const target of new Set(closedBy.match(SPEC_ID) ?? [])) {
        const status = statusById.get(target);
        if (status && CLOSED_STATUSES.has(status)) {
          violations.push(
            `${specId} → ${closedBy} (${target} is ${status}) — "${label}"`,
          );
        }
      }
    }
  }
  return violations;
}

function listYaml(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listYaml(path);
    return /\.ya?ml$/.test(entry.name) ? [path] : [];
  });
}

function loadRepoSpecs(): SpecRecord[] {
  return listYaml(SPECS_DIR).map((path) => ({
    file: relative(REPO, path),
    data: load(readFileSync(path, 'utf8')),
  }));
}

describe('KB-80: spec closed_by pointers do not name finished work', () => {
  it('no open item waits on a Fixed KB or a DONE/RETIRED spec', () => {
    const specs = loadRepoSpecs();
    // A scan that found nothing would pass for the wrong reason.
    expect(specs.length).toBeGreaterThan(200);

    const violations = findViolations(specs, readFileSync(KNOWN_BUGS, 'utf8'));

    // One line per violation: spec_id → closed_by (why) — "item".
    expect(violations).toEqual([]);
  });

  it('every KB whose entry banner says Fixed has a Fixed-table row', () => {
    const knownBugs = readFileSync(KNOWN_BUGS, 'utf8');
    const table = fixedFromTable(knownBugs);
    const missing = [...fixedFromBanners(knownBugs).keys()].filter(
      (id) => !table.has(id),
    );

    expect(table.size).toBeGreaterThan(5);
    expect(missing).toEqual([]);
  });

  describe('positive control: planted records', () => {
    const knownBugs = [
      '## KB-1 — Fixed by banner only',
      '',
      '> **Fixed (2026-09-21), #1.** Done.',
      '',
      'A later paragraph may mention a `(part)` row without undoing that.',
      '',
      '### Details',
      '## KB-2 — Open',
      '',
      'Not fixed.',
      '',
      '### Notes',
      '',
      '**Fixed** here only as a sub-note.',
      '## KB-6 — Fixed in part',
      '',
      '**Fixed (PR A):** some of it.',
      '## KB-7 — Banner says in part',
      '',
      '> **Fixed (2026-09-22)** in part, #7: one of two paths.',
      '## Fixed',
      '',
      '| ID | Bug | Fixed in |',
      '|---|---|---|',
      '| KB-6 (part) | Half | #10 |',
      '| KB-9, KB-10 | Two at once | #11 |',
      '| KB-41 | Row without an entry | #319 |',
      '| — | Untracked | #12 |',
      '',
      '---',
      '',
      '## Leads',
      '| KB-99 | not in the Fixed table | #13 |',
    ].join('\n');

    const spec = (
      id: string,
      status: string,
      extra: Record<string, unknown> = {},
    ): SpecRecord => ({
      file: `${id}.yaml`,
      data: { spec_id: id, status, ...extra },
    });

    const pointing = (closedBy: string, met?: boolean) =>
      spec('FILM-900', 'PARTIAL', {
        acceptance_criteria: [
          { text: 'criterion', met: met ?? false, closed_by: closedBy },
        ],
        remaining: met ? [] : [{ criterion: 'left', closed_by: closedBy }],
      });

    it('parses the Fixed table and banners as documented', () => {
      expect([...fixedFromTable(knownBugs).keys()].sort()).toEqual([
        'KB-10',
        'KB-41',
        'KB-9',
      ]);
      expect([...fixedFromBanners(knownBugs).keys()]).toEqual(['KB-1']);
    });

    it.each([
      ['KB-10', 'KB-10 is Fixed: Fixed table, #11'],
      ['KB-41', 'KB-41 is Fixed: Fixed table, #319'],
      ['KB-1', 'KB-1 is Fixed: entry banner **Fixed (2026-09-21)'],
      ['KB-17 (delete); KB-9 (RPC)', 'KB-9 is Fixed'],
      ['FILM-901', 'FILM-901 is DONE'],
      ['FILM-902', 'FILM-902 is RETIRED'],
    ])('flags closed_by %s', (closedBy, why) => {
      const violations = findViolations(
        [
          pointing(closedBy),
          spec('FILM-901', 'DONE'),
          spec('FILM-902', 'RETIRED'),
        ],
        knownBugs,
      );

      // Once for the unmet criterion, once for the remaining item.
      expect(violations).toHaveLength(2);
      for (const v of violations) {
        expect(v).toContain(`FILM-900 → ${closedBy} (${why}`);
      }
    });

    it.each([
      'KB-2',
      'KB-6',
      'KB-7',
      'KB-99',
      'FILM-903',
      'unassigned',
      'owner',
    ])('leaves closed_by %s alone', (closedBy) => {
      expect(
        findViolations(
          [pointing(closedBy), spec('FILM-903', 'PARTIAL')],
          knownBugs,
        ),
      ).toEqual([]);
    });

    it('ignores a met criterion that keeps its closed_by', () => {
      expect(findViolations([pointing('KB-10', true)], knownBugs)).toEqual([]);
    });
  });
});
