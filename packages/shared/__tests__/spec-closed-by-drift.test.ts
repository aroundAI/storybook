import { load } from 'js-yaml';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  type KnownBugFile,
  type Status,
  fixedIds,
  loadKnownBugs,
  readRegisterFiles,
  renderKnownBug,
} from './known-bugs/register';

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
 *   (a) a KB whose file, `specs/known-bugs/KB-<n>.md`, says `status: fixed`
 *       in its front matter. `partial` (fixed in part) and `open` do not
 *       count. `known-bugs-register.test.ts` keeps that status in step with
 *       the entry's own banner;
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

const KB_ID = /\bKB-\d+\b/g;
const SPEC_ID = /\b(?:FILM|SPIKE)-(?:[A-Z]{2}-)?\d+[a-z]?\b/g;
const CLOSED_STATUSES = new Set(['DONE', 'RETIRED']);

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

function findViolations(
  specs: SpecRecord[],
  knownBugs: KnownBugFile[],
): string[] {
  const fixed = fixedIds(loadKnownBugs(knownBugs));

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
    const knownBugs = readRegisterFiles();
    // A scan that found nothing would pass for the wrong reason.
    expect(specs.length).toBeGreaterThan(200);
    expect(fixedIds(loadKnownBugs(knownBugs)).size).toBeGreaterThan(50);

    const violations = findViolations(specs, knownBugs);

    // One line per violation: spec_id → closed_by (why) — "item".
    expect(violations).toEqual([]);
  });

  describe('positive control: planted records', () => {
    const plant = (id: string, status: Status, fixedIn: string[] = []) => ({
      file: `specs/known-bugs/${id}.md`,
      text: renderKnownBug({
        id,
        title: `Planted ${status}`,
        status,
        fixedIn,
        fixedSummary: fixedIn.length > 0 ? 'Planted' : '',
        severity: 'unrated',
        found: '2026-09-25',
        body: `## ${id} — Planted ${status}\n\nPlanted.`,
      }),
    });

    const knownBugs = [
      plant('KB-1', 'fixed', ['#1']),
      plant('KB-2', 'open'),
      plant('KB-6', 'partial', ['#10']),
      plant('KB-9', 'fixed', ['#11']),
      plant('KB-10', 'fixed', ['#11', '#12']),
    ];

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

    it('reads fixed from the front matter, and only `fixed`', () => {
      expect([...fixedIds(loadKnownBugs(knownBugs)).keys()]).toEqual([
        'KB-1',
        'KB-9',
        'KB-10',
      ]);
    });

    it.each([
      ['KB-10', 'KB-10 is Fixed: specs/known-bugs/KB-10.md, fixed_in #11, #12'],
      ['KB-1', 'KB-1 is Fixed: specs/known-bugs/KB-1.md, fixed_in #1'],
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

    it.each(['KB-2', 'KB-6', 'KB-99', 'FILM-903', 'unassigned', 'owner'])(
      'leaves closed_by %s alone',
      (closedBy) => {
        expect(
          findViolations(
            [pointing(closedBy), spec('FILM-903', 'PARTIAL')],
            knownBugs,
          ),
        ).toEqual([]);
      },
    );

    it('ignores a met criterion that keeps its closed_by', () => {
      expect(findViolations([pointing('KB-10', true)], knownBugs)).toEqual([]);
    });
  });
});
