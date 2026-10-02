import { resolve } from 'node:path';

import {
  type SandboxVersion,
  sourceStamp,
  stalenessProblem,
} from '../../../vendor-sandbox/src/version';

/**
 * Whether the sandbox on `controlUrl` runs the source of the checkout these
 * specs belong to. A sandbox left running from an older tree serves older
 * vendor responses: one started before #509 answered the Instagram sync
 * spec's Reels insights with HTTP 400, which read as a product bug.
 *
 * Local runs only: CI starts no sandbox, and every spec that calls this
 * skips there (`sandboxRun()`).
 */
const CHECKOUT = resolve(__dirname, '../../../..');

export async function sandboxFreshnessProblem(
  controlUrl: string,
  root = CHECKOUT,
) {
  const response = await fetch(`${controlUrl}/__sandbox/version`);
  const served =
    response.status === 200
      ? ((await response.json()) as SandboxVersion)
      : null;

  return stalenessProblem(controlUrl, served, sourceStamp(root));
}

export async function assertSandboxFresh(controlUrl: string) {
  const problem = await sandboxFreshnessProblem(controlUrl);

  if (problem) throw new Error(problem);
}
