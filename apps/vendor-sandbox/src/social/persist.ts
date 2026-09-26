import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SocialState, SocialStateJson } from './state';

/**
 * `SANDBOX_PERSIST=1` (FILM-1802 §5): social state survives a restart in
 * `.sandbox/state.json` at the repository root, which git ignores. Without
 * it, state lives in memory and clears on restart.
 */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

export const STATE_FILE = resolve(REPO, '.sandbox/state.json');

export function saveSocialState(social: SocialState, file = STATE_FILE) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(social.toJSON(), null, 2)}\n`);
}

/** Restores saved state; false when there is none. */
export function restoreSocialState(social: SocialState, file = STATE_FILE) {
  if (!existsSync(file)) return false;
  social.restore(JSON.parse(readFileSync(file, 'utf8')) as SocialStateJson);
  return true;
}
