import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..', '..');
const ROOTS = ['apps/web/app', 'packages/features'];
const SKIPPED = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  '__tests__',
]);

/**
 * Callers of `openRun` that have no page to word a refusal for: an MCP tool,
 * a skill, or a call that degrades gracefully by design. Each needs its reason.
 */
const ALLOWED: Record<string, string> = {
  'packages/features/episodes/src/server/canon-actions.ts':
    'extractCanonChanges falls back to a basic extraction on any model failure',
  'packages/features/episodes/src/lib/server/mutations/asset-link-actions.ts':
    'asset descriptions fall back to an empty or default description by design',
  'packages/features/episodes/src/lib/documentary/fact-checker.ts':
    'an agent skill, not an action: its caller reports the failure',
  'packages/features/studio-mcp/src/server/tools/edit/writer.ts':
    'MCP tool: the refusal is a tool result, not a server action',
  'packages/features/studio-mcp/src/server/tools/generation/index.ts':
    'MCP tool: the refusal is a tool result, not a server action',
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return SKIPPED.has(entry.name) ? [] : sourceFiles(path);
    }

    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
      ? [path]
      : [];
  });
}

/** The index just past the `)` that closes the call opened at `open`. */
function endOfCall(source: string, open: number): number {
  let depth = 0;

  for (let index = open; index < source.length; index++) {
    if (source[index] === '(') depth++;
    if (source[index] === ')' && --depth === 0) return index + 1;
  }

  return source.length;
}

/**
 * Lines of the `openRunForJob(` / `openRun(` calls whose refusal reaches the
 * page unworded (KB-182). A call is worded when `.catch(refuseRunError)` is
 * attached to it (the action is wrapped in `returnRefusals`), or when the
 * file words the error itself with `runRefusalMessage` and returns it, once
 * per such call.
 */
export function findUnwordedRunOpens(source: string): number[] {
  const calls = [...source.matchAll(/\bopenRun(?:ForJob)?\(/g)].filter(
    (match) =>
      !/^\s*(async\s+)?function\s*$/.test(
        source.slice(Math.max(0, match.index - 20), match.index),
      ) &&
      !/(function|export async function)\s+$/.test(
        source.slice(Math.max(0, match.index - 30), match.index),
      ),
  );
  const own = (source.match(/\brunRefusalMessage\(/g) ?? []).length;

  const bare = calls.filter((match) => {
    const end = endOfCall(source, match.index + match[0].length - 1);

    return !/^\s*\.catch\(refuseRunError\)/.test(source.slice(end));
  });

  return bare
    .slice(own)
    .map((match) => source.slice(0, match.index).split('\n').length);
}

describe('KB-182: a web Generate action words a run refusal', () => {
  it('detects a bare call, a caught call and a self-worded call', () => {
    const bare = 'const run = await openRunForJob({ a: f(1) }, ctx);';
    const caught =
      'const run = await openRunForJob({ a: 1 }, ctx).catch(refuseRunError);';
    const own =
      'try { await openRunForJob(p, c); } catch (e) { return runRefusalMessage(e); }';

    expect(findUnwordedRunOpens(bare)).toEqual([1]);
    expect(findUnwordedRunOpens(caught)).toEqual([]);
    expect(findUnwordedRunOpens(own)).toEqual([]);
  });

  it('no action opens a run without wording its refusal', () => {
    const offenders = ROOTS.flatMap((root) =>
      sourceFiles(join(REPO, root)).flatMap((path) => {
        const file = relative(REPO, path);
        const lines = findUnwordedRunOpens(readFileSync(path, 'utf8'));

        return file in ALLOWED ? [] : lines.map((line) => `${file}:${line}`);
      }),
    );

    expect(
      offenders,
      'Add .catch(refuseRunError) from @kit/ai-gateway/refuse-run-error inside returnRefusals, or return runRefusalMessage(error)',
    ).toEqual([]);
  });
});
