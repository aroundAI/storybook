import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * `docs/platform-capability-reference.md`, parsed once for every guard that
 * reads it: the request-site check (FILM-1721) and the capability matrix's
 * citations (FILM-1703). One parser, so the two cannot come to disagree about
 * what the document says.
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
