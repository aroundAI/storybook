import { REFERENCE, doc } from './capability-reference';

/**
 * The `<!-- forbidden -->` block of the capability reference:
 * `scope  wrong -> right  reason`.
 *
 * `scope` is a `|`-separated list of path segments the rule applies to. A
 * deprecation is a fact about one vendor, not about the word: LinkedIn reports
 * a genuine `impressions`, so Meta's 2025-04-21 removal must not reach it.
 *
 * Its own file, beside `capability-reference.ts` rather than inside it, so
 * that file stays identical to the copy FILM-1703 adds and the two pull
 * requests do not collide. FILM-1722's registry records a renamed field
 * (`plays` → `views`) and must find it retired in this block.
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
