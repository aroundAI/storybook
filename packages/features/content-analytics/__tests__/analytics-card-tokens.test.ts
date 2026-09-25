import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-1706. The card shell was written in raw Tailwind palette classes
 * with hand-written dark variants while every card body inside it used
 * semantic tokens — the pattern `packages/ui/CLAUDE.md` names as the one to
 * avoid. And its `h-64` default was escaped by every Deep Dive caller.
 *
 * Read from the source, because a class name is a string: nothing else
 * would notice `bg-white` coming back.
 */
const SRC = resolve(__dirname, '../src');
const SHELL = join(SRC, 'components/overview/analytics-card.tsx');

const PALETTE =
  /\b(?:bg|text|border|from|via|to|ring|fill|stroke)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/;
const DARK_COLOUR_PAIR = /\bdark:(?:bg|text|border|from|via|to|ring)-/;
const FIXED_HEIGHT = /(?<![-\w])h-(?:\d+|\[[^\]]+\])(?![-\w])/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      return name === '__tests__' || name === '__mocks__'
        ? []
        : sourceFiles(path);
    }

    return /\.tsx$/.test(name) ? [path] : [];
  });
}

describe('the analytics card shell', () => {
  const shell = readFileSync(SHELL, 'utf8');

  it('uses no raw palette colour', () => {
    expect(shell.match(PALETTE)?.[0] ?? null).toBeNull();
  });

  it('writes no hand-made dark variant', () => {
    expect(shell.match(DARK_COLOUR_PAIR)?.[0] ?? null).toBeNull();
  });

  it('sets no fixed height on the card', () => {
    // The root is the one <section>; skeleton placeholders inside it have
    // heights, and should.
    const root = /<section\b[\s\S]*?>/.exec(shell)?.[0];

    expect(root).toBeDefined();
    expect(root!.match(FIXED_HEIGHT)?.[0] ?? null).toBeNull();
  });

  it('has no gradient variant', () => {
    expect(shell).not.toMatch(/gradient/);
  });
});

describe('the cards that use it', () => {
  // Every `<AnalyticsCard …>` opening tag in the package. Prettier ends a
  // multi-line opening tag with `>` or `/>` alone at the tag's own
  // indentation, which is what separates it from a `>` inside a prop such
  // as `footer={<div>…</div>}`; and it puts each of the tag's own
  // attributes two spaces in, which separates them from an attribute of an
  // element inside a prop.
  const openings = sourceFiles(SRC).flatMap((file) =>
    [
      ...readFileSync(file, 'utf8').matchAll(
        /^([ \t]*)<AnalyticsCard\b(?:[^\n]*\/?>[ \t]*$|[\s\S]*?^\1\/?>)/gm,
      ),
    ].map(([tag, indent]) => ({
      file: relative(SRC, file),
      has: (attribute: string) =>
        tag.includes('\n')
          ? new RegExp(`\\n${indent}  ${attribute}=`).test(tag)
          : new RegExp(`\\s${attribute}=`).test(tag),
    })),
  );

  it('are found, so the checks below are not vacuous', () => {
    expect(openings.length).toBeGreaterThanOrEqual(17);
  });

  it('never pass a class to escape the shell’s size or colours', () => {
    expect(
      openings.filter(({ has }) => has('className')).map(({ file }) => file),
    ).toEqual([]);
  });

  it('all declare what they show', () => {
    expect(
      openings
        .filter(({ has }) => !has('metricFamily'))
        .map(({ file }) => file),
    ).toEqual([]);
  });
});
