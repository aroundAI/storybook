import { describe, expect, it } from 'vitest';

import {
  PUBLIC_ACTIONS,
  auditRepository,
  classifyModule,
} from './support/use-server-audit';

/**
 * KB-58: a `'use server'` module's exports are network endpoints. This fails
 * when one of them is anything but an action that checks its caller.
 */

const US = "'use server';\n";
const problems = (text: string, file = 'packages/x/src/server/a.ts') =>
  classifyModule(file, text).map((v) => [v.name, v.problem]);

describe('classifyModule', () => {
  it('refuses a plain exported function', () => {
    expect(
      problems(`${US}export async function decrypt(v: string) { return v; }`),
    ).toEqual([['decrypt', 'plain exported function']]);
  });

  it('accepts enhanceAction, directly and through the refusal and admin wrappers', () => {
    const text = `${US}
      const inner = enhanceAction(async () => 1, {});
      export const a = enhanceAction(async () => 1, {});
      export const b = returnRefusals(inner);
      export const c = withRefusals('do it', enhanceAction(async () => 1, {}));
      export const d = adminAction(enhanceAction(async () => 1, {}));
      export const e = returnRefusals(adminAction(enhanceAction(async () => 1, {})));
    `;

    expect(problems(text)).toEqual([
      ['a', null],
      ['b', null],
      ['c', null],
      ['d', null],
      ['e', null],
    ]);
  });

  it('refuses a refusal wrapper around a plain function', () => {
    const text = `${US}
      async function getData(p: { id: string }) { return p; }
      export const getDataAction = returnRefusals(getData);
    `;

    expect(problems(text)).toEqual([
      ['getDataAction', 'wraps a plain function, not enhanceAction'],
    ]);
  });

  it('refuses an unknown wrapper and a plain arrow', () => {
    const text = `${US}
      export const a = myWrapper(async () => 1);
      export const b = async () => 1;
    `;

    expect(problems(text)).toEqual([
      ['a', 'wrapped by myWrapper, which is not a known action wrapper'],
      ['b', 'not a wrapped action'],
    ]);
  });

  it('refuses auth: false outside PUBLIC_ACTIONS and accepts it inside', () => {
    const text = `${US}
      export const sendContactEmail = enhanceAction(async () => 1, { auth: false });
    `;

    expect(problems(text)).toEqual([
      [
        'sendContactEmail',
        'enhanceAction with auth: false, not in PUBLIC_ACTIONS',
      ],
    ]);

    const listed = Object.keys(PUBLIC_ACTIONS)[0]!.split('#')[0]!;
    expect(problems(text, listed)).toEqual([['sendContactEmail', null]]);
  });

  it('refuses re-exports and default exports, including type re-exports, and ignores inline types', () => {
    const text = `${US}
      export type { Foo } from './foo';
      export interface Bar { x: number }
      export { decrypt } from './crypto';
      export default async function handler() {}
    `;

    expect(problems(text).map(([, problem]) => problem)).toEqual([
      expect.stringContaining('type re-export'),
      "re-export from a 'use server' module",
      'plain exported function',
    ]);
  });
});

describe("every 'use server' module in apps/web and packages", () => {
  it('exports only actions that check their caller', () => {
    const violations = auditRepository()
      .filter((v) => v.problem)
      .map((v) => `${v.file}#${v.name}: ${v.problem}`);

    expect(violations).toEqual([]);
  });
});
