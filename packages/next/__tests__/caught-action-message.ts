import ts from 'typescript';

/**
 * Finds the KB-6 shape in a client file: the `message` of a caught error
 * being read where the guarded code calls a server action.
 *
 * A production build replaces that message with a generic sentence, and a
 * dev server passes through whatever the action threw — a Postgres
 * constraint name included. So the message is never for the page, and never
 * something to branch on (`error.message.includes('in use')` cannot match in
 * production). A refusal is returned as a value and read with
 * `refusalMessage(error, fallback)` from `@kit/next/action-result`.
 *
 * Deliberately not flagged, because the error never crossed from a server
 * action: a `try` around `fetch`, a client-side upload or validation, and a
 * `message` passed to `console.*` or a logger.
 */
export interface CaughtMessageRead {
  line: number;
  /** The server action the guarded code calls. */
  action: string;
}

/** `action-result` is the client-safe half of the refusal helpers. */
const SERVER_MODULE = /server|action(?!-result)|mutation/i;
/** `setAction` is a state setter, not an action. */
const ACTION_NAME = /^(?!set[A-Z]).*Action$/;
const LOG_RECEIVERS = new Set(['console', 'logger', 'log']);

export function findCaughtActionMessageReads(
  fileName: string,
  source: string,
): CaughtMessageRead[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const serverImports = collectServerImports(file);

  const isAction = (name: string) =>
    ACTION_NAME.test(name) || serverImports.has(name);

  /** The first server action called, or handed over by name, in `node`. */
  const actionIn = (node: ts.Node): string | undefined => {
    let found: string | undefined;

    const visit = (child: ts.Node) => {
      if (found) return;

      // Called, or picked to be called: `mode === 'story' ? aAction : bAction`.
      // A property of that name — `props.onAction` — is not the import.
      if (
        ts.isIdentifier(child) &&
        isAction(child.text) &&
        !(
          ts.isPropertyAccessExpression(child.parent) &&
          child.parent.name === child
        ) &&
        !(ts.isPropertyAssignment(child.parent) && child.parent.name === child)
      ) {
        found = child.text;
        return;
      }

      ts.forEachChild(child, visit);
    };

    visit(node);

    return found;
  };

  const reads: CaughtMessageRead[] = [];

  const report = (scope: ts.Node, caught: string, action: string) => {
    const names = new Set([caught, ...aliasesOf(scope, caught)]);

    const visit = (node: ts.Node) => {
      if (isLogCall(node)) return;

      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === 'message' &&
        ts.isIdentifier(node.expression) &&
        names.has(node.expression.text)
      ) {
        reads.push({
          line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          action,
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(scope);
  };

  const visit = (node: ts.Node) => {
    if (ts.isTryStatement(node) && node.catchClause) {
      const binding = node.catchClause.variableDeclaration?.name;
      const action = actionIn(node.tryBlock);

      if (binding && ts.isIdentifier(binding) && action) {
        report(node.catchClause.block, binding.text, action);
      }
    }

    if (ts.isObjectLiteralExpression(node)) {
      const property = (name: string) =>
        node.properties.find(
          (candidate): candidate is ts.PropertyAssignment =>
            ts.isPropertyAssignment(candidate) &&
            ts.isIdentifier(candidate.name) &&
            candidate.name.text === name,
        );

      const onError = property('onError')?.initializer;
      const work = (property('mutationFn') ?? property('queryFn'))?.initializer;

      if (
        onError &&
        work &&
        (ts.isArrowFunction(onError) || ts.isFunctionExpression(onError))
      ) {
        const parameter = onError.parameters[0]?.name;
        const action = actionIn(work);

        if (parameter && ts.isIdentifier(parameter) && action) {
          report(onError.body, parameter.text, action);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return reads;
}

/**
 * Value imports from a module that reads as server code — `@kit/x/server`,
 * `../lib/server/asset.mutations`, `./create-film-project.action` — for the
 * actions whose names do not end in `Action`.
 */
function collectServerImports(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !SERVER_MODULE.test(statement.moduleSpecifier.text) ||
      statement.importClause?.isTypeOnly
    ) {
      continue;
    }

    const bindings = statement.importClause?.namedBindings;

    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly) names.add(element.name.text);
      }
    }
  }

  return names;
}

/** `const error = err instanceof Error ? err : new Error(…)` and the like. */
function aliasesOf(scope: ts.Node, caught: string): string[] {
  const aliases: string[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      mentions(node.initializer, caught)
    ) {
      aliases.push(node.name.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(scope);

  return aliases;
}

function mentions(node: ts.Node, name: string): boolean {
  if (ts.isIdentifier(node) && node.text === name) return true;

  return ts.forEachChild(node, (child) => mentions(child, name)) ?? false;
}

function isLogCall(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    LOG_RECEIVERS.has(node.expression.expression.text)
  );
}

/**
 * The other half of the rule. An action wrapped in `returnRefusals` or
 * `withRefusals` no longer throws its refusals, so a caller that does not
 * read the result treats "refused" as "done" — `await renameAction(…)`
 * followed by a success toast. Every call goes through `unwrap(…)`.
 */
export function findBareRefusingCalls(
  fileName: string,
  source: string,
  refusing: ReadonlySet<string>,
): CaughtMessageRead[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const calls: CaughtMessageRead[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      refusing.has(node.expression.text) &&
      !isUnwrapArgument(node)
    ) {
      calls.push({
        line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        action: node.expression.text,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return calls;
}

function isUnwrapArgument(call: ts.CallExpression): boolean {
  const parent = call.parent;

  return (
    ts.isCallExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    parent.expression.text === 'unwrap' &&
    parent.arguments.includes(call)
  );
}

/** The actions a server file exports wrapped: `export const x = returnRefusals(…)`. */
export function refusingActionsIn(source: string): string[] {
  return [
    ...source.matchAll(
      /^export const (\w+) = (?:returnRefusals|withRefusals)\(/gm,
    ),
  ].map((match) => match[1]!);
}
