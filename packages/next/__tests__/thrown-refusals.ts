import ts from 'typescript';

/**
 * Finds the server half of KB-6: an exported server action that can throw
 * an `ActionRefusal`.
 *
 * A production build replaces the message of an error thrown from a server
 * action with a generic sentence, so a refusal (text written for the page)
 * must leave the action as a value: `returnRefusals` or `withRefusals`
 * around it. An `ActionRefusal` thrown from an action exported bare reaches
 * the page as "An error occurred in the Server Components render…".
 *
 * "Can throw" is decided over the whole repository, by name:
 *
 * - a function whose body contains `new ActionRefusal(…)` throws (a local
 *   `refuse()` closure inside it counts, because it is in its body);
 * - so does one that calls `unwrap(…)`, which rethrows a returned refusal;
 * - so does one that calls, by name, any function that throws, to a fixed
 *   point. That is what catches refusals raised in shared helpers
 *   (`assertTransition`, the queue helpers) and in one action called by
 *   another;
 * - a `returnRefusals(…)` / `withRefusals(…)` wrapper does not throw a
 *   refusal: it returns one.
 *
 * Name-based resolution is conservative: two top-level functions with the
 * same name in different files are treated as one, which can only add
 * findings, never hide one.
 */
export interface ThrownRefusal {
  file: string;
  action: string;
  line: number;
}

interface Definition {
  file: string;
  name: string;
  line: number;
  exported: boolean;
  /** `export const X = enhanceAction(…)` */
  isAction: boolean;
  /** `export const X = returnRefusals(…)` or `withRefusals(…)` */
  isWrapper: boolean;
  /** `export const X = inner;`: X is inner under another name */
  aliasOf: string | null;
  throwsDirectly: boolean;
  calls: Set<string>;
}

const WRAPPERS = new Set(['returnRefusals', 'withRefusals']);

export function findThrownRefusals(
  files: Array<{ path: string; source: string }>,
): ThrownRefusal[] {
  const definitions = files.flatMap(({ path, source }) =>
    definitionsIn(path, source),
  );

  const byName = new Map<string, Definition[]>();
  for (const definition of definitions) {
    const list = byName.get(definition.name) ?? [];
    list.push(definition);
    byName.set(definition.name, list);
  }

  const throwers = new Set(
    definitions.filter((d) => d.throwsDirectly && !d.isWrapper),
  );

  for (let changed = true; changed; ) {
    changed = false;

    for (const definition of definitions) {
      if (throwers.has(definition) || definition.isWrapper) continue;

      const reaches = [...definition.calls].some((name) =>
        (byName.get(name) ?? []).some((callee) => throwers.has(callee)),
      );

      if (reaches) {
        throwers.add(definition);
        changed = true;
      }
    }
  }

  // An exported alias of a throwing action exports that action bare
  const isThrowingAction = (d: Definition): boolean =>
    d.isAction
      ? throwers.has(d)
      : d.aliasOf !== null &&
        (byName.get(d.aliasOf) ?? []).some(
          (target) =>
            target.file === d.file && target.isAction && throwers.has(target),
        );

  return definitions
    .filter((d) => d.exported && isThrowingAction(d))
    .map(({ file, name, line }) => ({ file, action: name, line }));
}

function definitionsIn(path: string, source: string): Definition[] {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const exportedNames = new Set<string>();
  for (const statement of file.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause) &&
      !statement.moduleSpecifier
    ) {
      for (const element of statement.exportClause.elements) {
        exportedNames.add((element.propertyName ?? element.name).text);
      }
    }
  }

  const definitions: Definition[] = [];
  const line = (node: ts.Node) =>
    file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;

  for (const statement of file.statements) {
    const exported = hasExportModifier(statement);

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      definitions.push({
        file: path,
        name: statement.name.text,
        line: line(statement),
        exported: exported || exportedNames.has(statement.name.text),
        isAction: false,
        isWrapper: false,
        aliasOf: null,
        ...analyse(statement),
      });
      continue;
    }

    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue;
      }

      const name = declaration.name.text;
      const initializer = declaration.initializer;
      const callee =
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression)
          ? initializer.expression.text
          : null;

      definitions.push({
        file: path,
        name,
        line: line(declaration),
        exported: exported || exportedNames.has(name),
        isAction: callee === 'enhanceAction',
        isWrapper: callee !== null && WRAPPERS.has(callee),
        aliasOf: ts.isIdentifier(initializer) ? initializer.text : null,
        ...analyse(initializer),
      });
    }
  }

  return definitions;
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

function analyse(node: ts.Node): {
  throwsDirectly: boolean;
  calls: Set<string>;
} {
  let throwsDirectly = false;
  const calls = new Set<string>();

  const visit = (child: ts.Node) => {
    if (
      ts.isNewExpression(child) &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === 'ActionRefusal'
    ) {
      throwsDirectly = true;
    }

    if (ts.isCallExpression(child)) {
      const callee = child.expression;

      if (ts.isIdentifier(callee)) {
        if (callee.text === 'unwrap') throwsDirectly = true;
        else calls.add(callee.text);
      }
    }

    ts.forEachChild(child, visit);
  };

  visit(node);

  return { throwsDirectly, calls };
}
