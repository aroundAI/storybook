import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  type ActionManifest,
  auditManifest,
} from './support/use-server-audit';

/**
 * KB-58: the build decides what is an action, not the source alone. This
 * reads the `server-reference-manifest.json` a production build wrote and
 * fails if any registered action is not an `enhanceAction` export, or if a
 * secret-returning function is registered under any wrapper.
 *
 * The real-manifest check runs only when `ACTION_MANIFEST` names a manifest
 * (CI sets it after `build:test`, and the deploys after `pnpm build`). The
 * manifest also holds the build's `encryptionKey`; it is never read here.
 */

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kb58-'));

function writeSource(file: string, text: string) {
  const absolute = path.join(fixtureRoot, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, text);
}

writeSource(
  'packages/f/src/server/actions.ts',
  `'use server';
   export const saveAction = enhanceAction(async () => 1, {});
   export async function getSecret() { return 'x'; }
   export const decrypt = enhanceAction(async () => 1, {});`,
);

const entry = (exportedName: string, filename: string) => ({
  filename,
  exportedName,
});

afterAll(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

describe('auditManifest', () => {
  it('passes a manifest of wrapped actions', () => {
    const manifest: ActionManifest = {
      node: {
        a: entry('saveAction', '../../packages/f/src/server/actions.ts'),
      },
    };

    expect(auditManifest(manifest, fixtureRoot)).toEqual({
      registered: 1,
      findings: [],
    });
  });

  it('fails a registered plain function', () => {
    const manifest: ActionManifest = {
      node: { a: entry('getSecret', '../../packages/f/src/server/actions.ts') },
    };

    expect(auditManifest(manifest, fixtureRoot).findings).toEqual([
      {
        key: 'packages/f/src/server/actions.ts#getSecret',
        problem: 'plain exported function',
      },
    ]);
  });

  it('fails a never-register name even when it is wrapped', () => {
    const manifest: ActionManifest = {
      node: { a: entry('decrypt', '../../packages/f/src/server/actions.ts') },
    };

    expect(auditManifest(manifest, fixtureRoot).findings).toEqual([
      {
        key: 'packages/f/src/server/actions.ts#decrypt',
        problem: 'a never-register name is registered',
      },
    ]);
  });

  it('fails an action it cannot trace to a source export', () => {
    const manifest: ActionManifest = {
      node: {},
      edge: { a: entry('inlineAction', 'app/page.tsx') },
    };

    expect(auditManifest(manifest, fixtureRoot).findings).toEqual([
      {
        key: 'apps/web/app/page.tsx#inlineAction',
        problem: 'registered, but not a top-level export this audit can see',
      },
    ]);
  });
});

const manifestPath = process.env.ACTION_MANIFEST;
const sourceRoot = process.env.ACTION_SOURCE_ROOT;

describe.runIf(manifestPath)(
  'the built server-reference-manifest.json (ACTION_MANIFEST)',
  () => {
    it('registers only wrapped actions, and no secret-returning function', () => {
      const file = path.resolve(manifestPath!);
      expect(fs.existsSync(file), `${file} does not exist`).toBe(true);

      const manifest = JSON.parse(
        fs.readFileSync(file, 'utf8'),
      ) as ActionManifest;
      const { registered, findings } = auditManifest(
        manifest,
        sourceRoot ? path.resolve(sourceRoot) : undefined,
      );

      console.info(
        `KB-58 manifest guard: ${registered} actions registered, ${findings.length} findings`,
      );

      expect(registered).toBeGreaterThan(0);
      expect(findings.map((f) => `${f.key}: ${f.problem}`)).toEqual([]);
    });
  },
);
