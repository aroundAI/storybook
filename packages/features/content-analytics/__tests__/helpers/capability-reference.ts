import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Parsers for `docs/platform-capability-reference.md`, shared by every test
 * that binds code to it. One copy, because two parsers of the same document
 * would drift and each would then be guarding a slightly different file.
 */

export const REPO = resolve(__dirname, '../../../../..');
export const REFERENCE = 'docs/platform-capability-reference.md';

export const doc = readFileSync(join(REPO, REFERENCE), 'utf8');

/**
 * Blocks tagged `<!-- fields: <platform>/<endpoint> source: <url> -->`, keyed by
 * the whole tag, one endpoint each.
 *
 * Keyed by endpoint rather than platform because a platform is not one
 * contract: TikTok's Display API and Business API are separate apps, and X's
 * two quartile vocabularies live on separate endpoints. Merging them per
 * platform let a Display request ask for a Business-only field and pass.
 *
 * The `source` is required and deliberately weak — it proves someone had a
 * reference page open, not that a name is real. It exists because a name once
 * entered this index from an announcement blog post and nothing noticed.
 */
export function documentedNames() {
  const bySurface = new Map<string, Set<string>>();
  const block =
    /<!-- fields: (\S+) source: (https?:\/\/\S+) -->\s*```text\n([\s\S]*?)```/g;

  for (const [, surface, , body] of doc.matchAll(block)) {
    const names = new Set<string>();

    for (const line of body!.split('\n')) {
      const name = line.split('#')[0]!.trim();

      if (name) names.add(name);
    }

    bySurface.set(surface!, names);
  }

  return bySurface;
}

/**
 * The `<!-- forbidden -->` block: `scope  wrong -> right  reason`.
 *
 * `scope` is a `|`-separated list of path segments the rule applies to. A
 * deprecation is a fact about one vendor, not about the word: LinkedIn reports
 * a genuine `impressions`, so Meta's 2025-04-21 removal must not reach it.
 */
export function forbiddenNames() {
  const body = /<!-- forbidden -->\s*```text\n([\s\S]*?)```/.exec(doc)?.[1];

  if (!body) throw new Error(`No forbidden block in ${REFERENCE}`);

  return body
    .split('\n')
    .map((line) => /^(\S+)\s+(\S+)\s*->\s*(\S+)\s+(.*)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, scope, name, replacement, reason]) => ({
      // A directory or a file stem: `…/tiktok/…`, `…/tiktok.ts`, `…/tiktok-provider.ts`.
      scope: new RegExp(
        `(?:^|/)(?:${scope!.split('|').map(escape).join('|')})(?:/|\\.|-)`,
      ),
      name: name!,
      replacement: replacement!,
      reason: reason!.trim(),
    }));
}

export function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
