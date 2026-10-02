import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Which source a running sandbox was started from, so a local E2E run can
 * refuse one started from an older tree than the one under test. A sandbox
 * started before #509 served Meta media insights without the Reels fields,
 * and the Instagram sync spec failed with HTTP 400 — it read as a product bug
 * for an hour.
 *
 * Node builtins only, and no `import.meta`: `apps/e2e` imports this file too,
 * and computes the same stamp over its own checkout.
 */

/**
 * What the sandbox process runs, relative to the repository root: its own
 * source (`tsx` loads it once, at start) and the prompt files and registry it
 * builds its LLM catalog from at start (`src/llm/prompts.ts`).
 */
export const SOURCE_ROOTS = [
  'apps/vendor-sandbox/src',
  'packages/features/prompt-engine/src/prompts',
  'packages/features/prompt-engine/src/lib/server/prompt-registry.ts',
] as const;

export interface SourceStamp {
  /** One hash over every file below: equal stamps mean equal source. */
  digest: string;
  /** Each file's own hash, by its path from the repository root. */
  files: Record<string, string>;
  /** The checkout the sandbox was started from. */
  root: string;
}

/** What `/__sandbox/version` serves. */
export interface SandboxVersion extends SourceStamp {
  pid: number;
  startedAt: string;
}

function listFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    listFiles(join(path, entry.name)),
  );
}

function sha256(data: string | Buffer) {
  return createHash('sha256').update(data).digest('hex');
}

export function sourceStamp(root: string): SourceStamp {
  const files: Record<string, string> = {};

  for (const top of SOURCE_ROOTS)
    for (const file of listFiles(join(root, top)))
      files[relative(root, file).split(sep).join('/')] = sha256(
        readFileSync(file),
      );

  const lines = Object.keys(files)
    .sort()
    .map((path) => `${path}\0${files[path]}`);

  return { digest: sha256(lines.join('\n')), files, root };
}

/** The paths whose content differs, or that exist on one side only. */
export function changedFiles(
  served: Record<string, string>,
  local: Record<string, string>,
) {
  return [...new Set([...Object.keys(served), ...Object.keys(local)])]
    .filter((path) => served[path] !== local[path])
    .sort();
}

const SHOWN = 10;

/**
 * Why the sandbox on `controlUrl` cannot serve a run of the tree at
 * `local.root`, or null when it can. `served` is what its
 * `/__sandbox/version` answered: null when the route does not exist, which
 * means a sandbox older than the route itself.
 */
export function stalenessProblem(
  controlUrl: string,
  served: SandboxVersion | null,
  local: SourceStamp,
): string | null {
  if (served && served.digest === local.digest) return null;

  const port = new URL(controlUrl).port || '80';
  const restart = [
    `Restart the sandbox from this worktree: stop the one on ${controlUrl}` +
      (served ? ` (pid ${served.pid}, started from ${served.root})` : ''),
    `then: cd ${local.root}/apps/vendor-sandbox && SANDBOX_PORT_BASE=${port} pnpm start`,
  ].join('; ');

  if (!served)
    return `The vendor sandbox on ${controlUrl} has no /__sandbox/version, so it was started from source older than this tree. ${restart}.`;

  const changed = changedFiles(served.files ?? {}, local.files);
  const listed =
    changed.slice(0, SHOWN).join(', ') +
    (changed.length > SHOWN ? `, and ${changed.length - SHOWN} more` : '');

  return `The vendor sandbox on ${controlUrl} was started at ${served.startedAt} from source that differs from this tree's (${changed.length} file${changed.length === 1 ? '' : 's'}: ${listed}). ${restart}.`;
}
