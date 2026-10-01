import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * FILM-1705: no card hand-writes a platform name. Every word of provenance
 * copy is the matrix's `capabilityFor().note`, and every platform name in a
 * sentence comes from a label map — so a statement about what a platform
 * reports cannot drift from the matrix by being retyped somewhere else.
 *
 * Read from the source with the TypeScript parser: a user-facing string is a
 * string literal, a template's text or JSX text. The one allowed shape is a
 * label map entry — `youtube: 'YouTube'`, `label: 'YouTube'`.
 */
const SRC = resolve(__dirname, '../src');
const ROOTS = ['components', 'lib'].map((dir) => join(SRC, dir));

const PLATFORM_NAME = /\b(?:YouTube|TikTok|Instagram|Facebook|LinkedIn)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      return name === '__tests__' || name === '__mocks__'
        ? []
        : sourceFiles(path);
    }

    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** `label: 'YouTube'` or `youtube: 'YouTube'`: a label map entry. */
function isLabelMapEntry(node: ts.Node): boolean {
  const parent = node.parent;

  return (
    parent !== undefined &&
    ts.isPropertyAssignment(parent) &&
    parent.initializer === node &&
    ts.isStringLiteral(node) &&
    PLATFORM_NAME.test(node.text) &&
    node.text.match(PLATFORM_NAME)![0] === node.text &&
    (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name))
  );
}

function platformNamesIn(path: string, text: string): string[] {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: string[] = [];

  const visit = (node: ts.Node) => {
    // An import names a module or an icon component, not copy.
    if (ts.isImportDeclaration(node)) return;

    const copy =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
        ? node.text
        : null;

    if (copy && PLATFORM_NAME.test(copy) && !isLabelMapEntry(node)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());

      found.push(`${relative(SRC, path)}:${line + 1} ${copy.trim()}`);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

describe('provenance copy', () => {
  it('names no platform outside a label map', () => {
    const found = ROOTS.flatMap(sourceFiles).flatMap((path) =>
      platformNamesIn(path, readFileSync(path, 'utf8')),
    );

    expect(found).toEqual([]);
  });

  it('would catch a hand-written platform list', () => {
    // The shapes this replaced (FILM-1705 §1), and the shape it allows.
    expect(
      platformNamesIn(
        'x.tsx',
        `const a = { description: 'Estimated ad revenue (YouTube only)' };
         const b = <p>Aggregated across TikTok, YouTube, and Instagram</p>;
         const c = \`views on \${n} YouTube videos\`;
         const LABELS = { youtube: 'YouTube', label: 'TikTok' };`,
      ),
    ).toHaveLength(3);
  });
});
