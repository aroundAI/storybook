import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { PROMPT_REGISTRY } from '../src/lib/server/prompt-registry';

/**
 * KB-126, the class. A prompt is filled by name: `{{characters}}` is replaced
 * only by a variable called `characters`. A caller that sends the right data
 * under another name (`existing_characters`) gets no error — the renderer
 * leaves the placeholder in, and the model is sent `{{characters}}`. The
 * season outliner did this for every outline.
 *
 * This finds every call in the repo that names a template (`templateSlug:
 * '…'`) and passes a literal `variables` object, and fails on:
 *   - a placeholder the call leaves unfilled (no key for it, no default), and
 *   - a key the template does not declare (data sent to nowhere).
 * And, for every template on its own, on a placeholder it does not declare.
 *
 * It reads the template text rather than calling a renderer: the two
 * renderers differ (the Lambda one blanks an unfilled placeholder, the
 * prompt-engine one leaves it in), and either way the data is missing.
 */

const ROOT = join(__dirname, '../../../..');
const SEARCH = [
  'packages/features',
  'apps/web/lambda',
  'apps/web/app',
  'apps/web/lib',
];
const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;
const PROMPTS = join(__dirname, '../src/prompts');

interface Template {
  user_prompt: string;
  system_prompts: Array<{ content: string }>;
  variables: Record<string, { default?: unknown }>;
}

/**
 * The template a slug names: the registry's entry, else the JSON file of
 * that name (the LLM worker bundles its own registry of the same files).
 */
function templateFor(slug: string): Template | undefined {
  const registered = PROMPT_REGISTRY[slug];

  if (registered) return registered as unknown as Template;

  const name = `${slug.split('/').at(-1)}.json`;
  const found = jsonFiles(PROMPTS).find((path) => path.endsWith(`/${name}`));

  return found
    ? (JSON.parse(readFileSync(found, 'utf8')) as Template)
    : undefined;
}

function jsonFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return jsonFiles(path);
    return name.endsWith('.json') ? [path] : [];
  });
}

function templateText(template: Template): string {
  return [
    template.user_prompt,
    ...template.system_prompts.map((prompt) => prompt.content),
  ].join('\n');
}

interface Call {
  where: string;
  slug: string;
  keys: string[];
  sometimes: string[];
  /** A spread or computed key: the full key set is not known statically */
  open: boolean;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];

  for (const name of readdirSync(dir)) {
    if (
      name === 'node_modules' ||
      name === '__tests__' ||
      name.startsWith('.')
    ) {
      continue;
    }

    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(path);
    }
  }

  return out;
}

/** Object literals a spread may contribute: `...(x ? { a } : {})` */
function spreadLiterals(node: ts.Expression): ts.ObjectLiteralExpression[] {
  if (ts.isParenthesizedExpression(node))
    return spreadLiterals(node.expression);
  if (ts.isObjectLiteralExpression(node)) return [node];
  if (ts.isConditionalExpression(node)) {
    return [
      ...spreadLiterals(node.whenTrue),
      ...spreadLiterals(node.whenFalse),
    ];
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return spreadLiterals(node.right);
  }
  return [];
}

function propertyName(node: ts.ObjectLiteralElementLike): string | null {
  if (
    (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
    (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
  ) {
    return node.name.text;
  }

  return null;
}

function callsIn(path: string): Call[] {
  const text = readFileSync(path, 'utf8');

  if (!text.includes('templateSlug')) return [];

  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const calls: Call[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      let slug: string | null = null;
      let variables: ts.ObjectLiteralExpression | null = null;

      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue;

        const name = propertyName(property);

        if (
          name === 'templateSlug' &&
          ts.isStringLiteralLike(property.initializer)
        ) {
          slug = property.initializer.text;
        }

        if (
          name === 'variables' &&
          ts.isObjectLiteralExpression(property.initializer)
        ) {
          variables = property.initializer;
        }
      }

      if (slug && variables) {
        const keys: string[] = [];
        /** Keys sent only sometimes, from a conditional spread */
        const sometimes: string[] = [];
        let open = false;

        for (const property of variables.properties) {
          const name = propertyName(property);

          if (name) {
            keys.push(name);
          } else if (ts.isSpreadAssignment(property)) {
            const literals = spreadLiterals(property.expression);
            if (literals.length === 0) open = true;
            for (const literal of literals) {
              for (const inner of literal.properties) {
                const innerName = propertyName(inner);
                if (innerName) sometimes.push(innerName);
                else open = true;
              }
            }
          } else {
            open = true;
          }
        }

        const { line } = file.getLineAndCharacterOfPosition(node.getStart());

        calls.push({
          where: `${relative(ROOT, path)}:${line + 1}`,
          slug,
          keys,
          sometimes,
          open,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(file);
  return calls;
}

const calls = SEARCH.flatMap((dir) => sourceFiles(join(ROOT, dir))).flatMap(
  callsIn,
);

function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1]!);
}

describe('prompt variables (KB-126)', () => {
  it('finds the calls it checks', () => {
    // A positive control: a scanner that matched nothing would pass everything.
    // 23 on 2026-10-03: #554 deleted six uncalled callers (the news services,
    // act-context-bridge, agent-story-generation) and #557/#560 moved five
    // into @kit/generation's stages, which import their prompt JSON and pass
    // `variables` to buildBrief, a shape this scan does not read.
    expect(calls.length).toBeGreaterThan(20);
  });

  it('every template declares every placeholder it uses', () => {
    const undeclared = jsonFiles(PROMPTS).flatMap((path) => {
      const template = JSON.parse(readFileSync(path, 'utf8')) as Template;

      if (!template.user_prompt || !template.variables) return [];

      return placeholdersIn(templateText(template))
        .filter((name) => !(name in template.variables))
        .map((name) => `${relative(PROMPTS, path)}: {{${name}}}`);
    });

    expect([...new Set(undeclared)]).toEqual([]);
  });

  it.each(calls.map((call) => [call.where, call] as const))(
    '%s fills every placeholder of its template, and sends nothing it does not read',
    (_where, call) => {
      const template = templateFor(call.slug);

      expect(template, `no template "${call.slug}"`).toBeDefined();

      const unknown = [...call.keys, ...call.sometimes].filter(
        (key) => !(key in template!.variables),
      );

      expect(unknown, `keys ${call.slug} does not declare`).toEqual([]);

      // Both executors now refuse an unfilled placeholder at run time, so a
      // key sent only sometimes, or one this scan cannot see, is a failure
      // waiting to happen: send every key, every time
      expect(call.open, 'a spread or computed key').toBe(false);
      expect(call.sometimes, 'keys sent only sometimes').toEqual([]);

      const unfilled = placeholdersIn(templateText(template!)).filter(
        (name) =>
          !call.keys.includes(name) &&
          template!.variables[name]?.default === undefined,
      );

      expect([...new Set(unfilled)], `unfilled in ${call.slug}`).toEqual([]);
    },
  );
});
