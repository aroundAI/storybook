import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PLATFORMS, isPlatform } from '../src/lib/platforms';

/**
 * KB-15. `platform_connections.platform` is a varchar with a CHECK, so the
 * generated types say `string` and cannot be derived from. `PLATFORMS` is
 * written out once instead, and this test binds it to the constraint: a value
 * the database accepts that refresh does not know about is how X went
 * unrefreshed.
 */

const MIGRATIONS = resolve(__dirname, '../../../../apps/web/supabase/migrations');

/** The values of every CHECK on `platform_connections.platform`, in order. */
function platformChecks() {
  const checks: string[][] = [];

  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (!file.endsWith('.sql')) continue;

    for (const statement of readFileSync(resolve(MIGRATIONS, file), 'utf8').split(';')) {
      const definesTable =
        /create\s+table\s+(if\s+not\s+exists\s+)?(public\.)?platform_connections\s*\(/i.test(statement) ||
        /alter\s+table\s+(only\s+)?(public\.)?platform_connections\b/i.test(statement);
      const check = /check\s*\(\s*platform\s+in\s*\(([^)]*)\)\s*\)/i.exec(statement);

      if (definesTable && check) {
        checks.push(
          [...check[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!),
        );
      }
    }
  }

  return checks;
}

describe('PLATFORMS', () => {
  it('is exactly the set the platform_connections CHECK allows', () => {
    const checks = platformChecks();

    // Positive control: a broken reader must not pass by finding nothing.
    expect(checks.length).toBeGreaterThan(0);
    expect(new Set(PLATFORMS)).toEqual(new Set(checks.at(-1)));
  });

  it('parses a stored platform instead of trusting it', () => {
    expect(isPlatform('twitter')).toBe(true);
    expect(isPlatform('myspace')).toBe(false);
  });
});
