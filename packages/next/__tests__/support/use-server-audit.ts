import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * KB-58: every export of a `'use server'` module is a network endpoint that
 * anyone can call with any arguments, so each one must be an action that
 * checks its caller. Helpers that only other server code calls belong in a
 * library module without the directive. `import 'server-only'` does not stop
 * registration: `@kit/shared/crypto` had both, and `decrypt` was an action.
 *
 * One classifier, used by the source guard (`use-server-exports.test.ts`)
 * and the built-manifest guard (`action-manifest.guard.test.ts`), so the two
 * cannot disagree about what "wrapped" means.
 */

export const REPO_ROOT = path.resolve(__dirname, '../../../..');

/** Roots scanned. `apps/dev-tool` is a local-only tool that is never deployed. */
const SCAN_ROOTS = ['apps/web', 'packages'];

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.open-next',
  '.turbo',
  'dist',
  '__tests__',
  '__mocks__',
]);

/**
 * Directories being deleted by another change, which this audit skips rather
 * than converting. Empty: the Edit Suite package was the only one, and
 * FILM-607 removed it.
 */
export const RETIRING_PATHS: readonly string[] = [];

/**
 * Wrappers that add behaviour around a finished `enhanceAction` but do not
 * replace its session check; the chain must still end in `enhanceAction`.
 */
const PASS_THROUGH_WRAPPERS = new Set([
  'returnRefusals',
  'withRefusals',
  'adminAction',
]);

/**
 * `enhanceAction(…, { auth: false })` is public by declaration. Each entry
 * says why it may be.
 */
export const PUBLIC_ACTIONS: Record<string, string> = {
  'apps/web/app/(marketing)/contact/_lib/server/server-actions.ts#sendContactEmail':
    'the public contact form',
  'packages/features/accounts/src/server/personal-accounts-server-actions.ts#refreshAuthSession':
    "runs straight after an MFA code is verified, while the cookie may still be aal1 (requireUser would redirect to /auth/verify); refreshes only the caller's own session and returns nothing",
};

/**
 * Functions that return a secret, decrypt or encrypt, or act with the
 * service-role client. Wrapped or not, none of these may ever be an action.
 */
export const NEVER_REGISTERED = new Set([
  'getApiKeyForProvider',
  'executeLLM',
  'loadAndRenderPrompt',
  'logLLMUsage',
  'encrypt',
  'decrypt',
  'isEncrypted',
  'getOAuthAppCredentials',
  'getGlobalOAuthCredentials',
  'getAccountOAuthApp',
  'getAccountOAuthAppAdmin',
  'getAccessToken',
  'validatePlatformToken',
  'ensureValidToken',
  'refreshTikTokToken',
  'getAccountElevenLabsApiKey',
  'getProjectElevenLabsApiKey',
  'loadVoiceProviderConfig',
  'loadMusicProviderConfig',
  'processScheduledPublishes',
]);

export interface ExportVerdict {
  /** Repo-relative path, `/`-separated. */
  file: string;
  name: string;
  /** Why the export is not an allowed action; `null` when it is. */
  problem: string | null;
}

export function isUseServerModule(source: ts.SourceFile): boolean {
  const first = source.statements[0];

  return (
    !!first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use server'
  );
}

const INLINE_DIRECTIVE = /^\s+['"]use server['"];?\s*$/m;

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

function isAuthFalse(config: ts.Expression | undefined): boolean {
  return (
    !!config &&
    ts.isObjectLiteralExpression(config) &&
    config.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        property.name.getText() === 'auth' &&
        property.initializer.kind === ts.SyntaxKind.FalseKeyword,
    )
  );
}

/**
 * Classifies every export of one module. `file` is repo-relative. The
 * module is treated as a `'use server'` module whether or not it has the
 * directive; callers decide which modules to pass.
 */
export function classifyModule(file: string, text: string): ExportVerdict[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const locals = new Map<string, ts.Expression>();
  const localFunctions = new Set<string>();

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      localFunctions.add(statement.name.text);
    }

    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        locals.set(declaration.name.text, declaration.initializer);
      }
    }
  }

  const verdict = (
    name: string,
    init: ts.Expression | undefined,
    depth = 0,
  ): string | null => {
    if (!init || depth > 8) return 'not a wrapped action';

    if (ts.isIdentifier(init)) {
      const bound = locals.get(init.text);
      if (bound) return verdict(name, bound, depth + 1);

      return localFunctions.has(init.text)
        ? 'wraps a plain function, not enhanceAction'
        : 'not a wrapped action (an imported or unknown binding)';
    }

    if (!ts.isCallExpression(init)) return 'not a wrapped action';

    const callee = init.expression.getText(source);

    if (PASS_THROUGH_WRAPPERS.has(callee)) {
      return verdict(name, init.arguments.at(-1), depth + 1);
    }

    if (callee !== 'enhanceAction') {
      return `wrapped by ${callee}, which is not a known action wrapper`;
    }

    if (isAuthFalse(init.arguments[1]) && !PUBLIC_ACTIONS[`${file}#${name}`]) {
      return 'enhanceAction with auth: false, not in PUBLIC_ACTIONS';
    }

    return null;
  };

  const verdicts: ExportVerdict[] = [];

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
      verdicts.push({
        file,
        name: statement.name?.text ?? 'default',
        problem: 'plain exported function',
      });
    } else if (
      ts.isVariableStatement(statement) &&
      hasExportModifier(statement)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        const name = declaration.name.getText(source);
        verdicts.push({
          file,
          name,
          problem: verdict(name, declaration.initializer),
        });
      }
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      verdicts.push({
        file,
        name: statement.getText(source).replace(/\s+/g, ' '),
        problem: "re-export from a 'use server' module",
      });
    } else if (ts.isExportAssignment(statement)) {
      verdicts.push({
        file,
        name: 'default',
        problem: "default export from a 'use server' module",
      });
    }
  }

  return verdicts;
}

function walk(dir: string, found: string[]): string[] {
  if (!fs.existsSync(dir)) return found;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), found);
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.d\.ts$|\.test\.tsx?$|\.spec\.tsx?$/.test(entry.name)
    ) {
      found.push(path.join(dir, entry.name));
    }
  }

  return found;
}

const toRepoPath = (root: string, absolute: string) =>
  path.relative(root, absolute).split(path.sep).join('/');

export const isRetiring = (file: string) =>
  RETIRING_PATHS.some((prefix) => file.startsWith(prefix));

/** Every export of every `'use server'` module under the scanned roots. */
export function auditRepository(root = REPO_ROOT): ExportVerdict[] {
  const verdicts: ExportVerdict[] = [];

  for (const scanRoot of SCAN_ROOTS) {
    for (const absolute of walk(path.join(root, scanRoot), [])) {
      const file = toRepoPath(root, absolute);
      if (isRetiring(file)) continue;

      const text = fs.readFileSync(absolute, 'utf8');
      if (!text.includes('use server')) continue;

      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);

      if (isUseServerModule(source)) {
        verdicts.push(...classifyModule(file, text));
      } else if (INLINE_DIRECTIVE.test(text)) {
        verdicts.push({
          file,
          name: '(inline)',
          problem:
            "inline 'use server' in a function body: not covered by this audit, review it by hand",
        });
      }
    }
  }

  return verdicts;
}

/** The subset of `server-reference-manifest.json` read here. */
export interface ActionManifest {
  node: Record<string, { filename: string; exportedName: string }>;
  edge?: Record<string, { filename: string; exportedName: string }>;
}

export interface ManifestFinding {
  key: string;
  problem: string;
}

/**
 * Checks a built manifest against the source. The manifest's filenames are
 * relative to `apps/web`. `encryptionKey` is never read.
 */
export function auditManifest(
  manifest: ActionManifest,
  root = REPO_ROOT,
): { registered: number; findings: ManifestFinding[] } {
  const entries = [
    ...Object.values(manifest.node ?? {}),
    ...Object.values(manifest.edge ?? {}),
  ];

  const cache = new Map<string, ExportVerdict[] | null>();
  const findings: ManifestFinding[] = [];

  for (const entry of entries) {
    const file = path.posix.normalize(
      path.posix.join('apps/web', entry.filename.split(path.sep).join('/')),
    );
    const key = `${file}#${entry.exportedName}`;

    if (NEVER_REGISTERED.has(entry.exportedName)) {
      findings.push({ key, problem: 'a never-register name is registered' });
    }

    if (isRetiring(file)) continue;

    if (!cache.has(file)) {
      const absolute = path.join(root, file);
      cache.set(
        file,
        fs.existsSync(absolute)
          ? classifyModule(file, fs.readFileSync(absolute, 'utf8'))
          : null,
      );
    }

    const verdicts = cache.get(file);
    const match = verdicts?.find((v) => v.name === entry.exportedName);

    if (!match) {
      findings.push({
        key,
        problem: 'registered, but not a top-level export this audit can see',
      });
    } else if (match.problem) {
      findings.push({ key, problem: match.problem });
    }
  }

  return { registered: entries.length, findings };
}
