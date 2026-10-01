import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A server action's id in the build the server is serving, read from
 * `server-reference-manifest.json`, so a test can tell one action's
 * requests from another's by the `next-action` header.
 *
 * Matching on the request's input shape instead is a trap: two actions that
 * take the same arguments are indistinguishable. `getCoverageMatrixAction`
 * (FILM-1704) takes `{ scope, from, to }`, exactly as the subscriber series
 * does, and broke a spec that recognised the series by its keys.
 */
export function actionIdOf(exportedName: string): string {
  const manifest = JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../web/.next/server/server-reference-manifest.json',
      ),
      'utf8',
    ),
  ) as { node: Record<string, { exportedName?: string }> };

  const ids = Object.entries(manifest.node)
    .filter(([, entry]) => entry.exportedName === exportedName)
    .map(([id]) => id);

  if (ids.length !== 1) {
    throw new Error(
      `expected one server action named ${exportedName} in the served build, found ${ids.length}`,
    );
  }

  return ids[0]!;
}
