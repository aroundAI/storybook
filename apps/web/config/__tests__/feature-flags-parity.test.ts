import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * KB-99: local, test and E2E ran with personal accounts on while every deploy
 * ran with them off, so a defect that only exists with them on was found and
 * "fixed" locally. These flags must resolve to the deployed value everywhere.
 *
 * The deployed value is the literal default in sst.config.ts, the code default
 * is what an unset variable gives, and the committed env files are what
 * `next dev`, `build:test` and CI's E2E build read.
 */
const WEB = path.resolve(__dirname, '../..');
const ROOT = path.resolve(WEB, '../..');

const read = (file: string) => readFileSync(file, 'utf8');

const ENV_FILES = ['.env', '.env.development', '.env.test', '.env.production'];

function sstDefault(variable: string) {
  const match = read(path.join(ROOT, 'sst.config.ts')).match(
    new RegExp(`${variable}:\\s*process\\.env\\.${variable}\\s*\\|\\|\\s*'(true|false)'`),
  );

  return match?.[1];
}

function codeDefault(variable: string) {
  const match = read(path.join(WEB, 'config/feature-flags.config.ts')).match(
    new RegExp(`process\\.env\\.${variable},\\s*(true|false),`),
  );

  return match?.[1];
}

function envFileValues(variable: string) {
  return ENV_FILES.flatMap((file) => {
    const line = read(path.join(WEB, file))
      .split('\n')
      .find((l) => l.startsWith(`${variable}=`));

    return line ? [{ file, value: line.slice(variable.length + 1).trim() }] : [];
  });
}

describe('feature flags match the deployed build (KB-99)', () => {
  it('personal accounts are off in the deploy, the code default and every env file', () => {
    const variable = 'NEXT_PUBLIC_ENABLE_PERSONAL_ACCOUNTS';

    expect(sstDefault(variable)).toBe('false');
    expect(codeDefault(variable)).toBe('false');
    expect(envFileValues(variable)).toEqual([{ file: '.env', value: 'false' }]);
  });

  it('personal account billing is off in the code default and every env file', () => {
    // sst.config.ts does not set it, so the deploy gets the code default.
    const variable = 'NEXT_PUBLIC_ENABLE_PERSONAL_ACCOUNT_BILLING';

    expect(sstDefault(variable)).toBeUndefined();
    expect(codeDefault(variable)).toBe('false');

    for (const { value } of envFileValues(variable)) {
      expect(value).toBe('false');
    }
  });
});
