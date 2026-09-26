/**
 * KB-61's source scan: PostgREST deletes and soft deletes whose statement
 * never asks for the rows it changed. See `kb61-unchecked-deletes.test.ts`.
 * KB-105 widens it to plain updates (`findUncheckedUpdates`,
 * `kb105-unchecked-updates.test.ts`).
 *
 * A statement runs from the previous `;` or line-ending brace to the next
 * `;`. It counts as a PostgREST write only when it names a table with
 * `.from('<table>')`, so `set.delete(x)` and `params.delete('a')` are not
 * matched. A write kept in a variable (`let query = client.from(t).delete()`)
 * is checked when the file later calls `query.select(`.
 */
export interface UncheckedDelete {
  table: string;
  op: 'delete' | 'soft-delete';
}

export interface UncheckedUpdate {
  table: string;
  op: 'update';
}

const WRITE =
  /\.delete\(\s*(?:\{[^)]*\})?\s*\)|\.update\(\s*\{\s*deleted_at\s*:/g;

// KB-105: every other `.update(`. Soft deletes stay KB-61's. Upserts are not
// scanned: RLS makes a refused upsert raise, it does not filter it to no rows.
const UPDATE = /\.update\((?!\s*\{\s*deleted_at\s*:)/g;

export function findUncheckedDeletes(source: string): UncheckedDelete[] {
  return findUnchecked(source, WRITE).map(({ table, write }) => ({
    table,
    op: write.startsWith('.delete') ? 'delete' : 'soft-delete',
  }));
}

export function findUncheckedUpdates(source: string): UncheckedUpdate[] {
  return findUnchecked(source, UPDATE).map(({ table }) => ({
    table,
    op: 'update',
  }));
}

function findUnchecked(source: string, pattern: RegExp) {
  const found: Array<{ table: string; write: string }> = [];

  for (const match of source.matchAll(pattern)) {
    const at = match.index ?? 0;
    const start = Math.max(
      source.lastIndexOf(';', at),
      source.lastIndexOf('{\n', at),
      source.lastIndexOf('}\n', at),
    );
    const end = source.indexOf(';', at);
    const before = source.slice(start + 1, at);
    const after = source.slice(at, end === -1 ? undefined : end);

    const tables = [...before.matchAll(/\.from\(\s*['"`]([\w.]+)['"`]\s*\)/g)];
    const table = tables.at(-1)?.[1];

    if (!table || after.includes('.select(')) continue;

    const variable = /(?:let|const|var)\s+(\w+)\s*=/.exec(before)?.[1];

    if (variable && selectsLater(source.slice(end + 1), variable)) continue;

    found.push({ table, write: match[0] });
  }

  return found;
}

/**
 * A write kept in a variable is checked when a later statement that uses the
 * variable asks for rows: `query.select(`, or `(cond ? query.is(…) :
 * query.eq(…)).select(` — the shape an optimistic-lock update takes.
 */
function selectsLater(rest: string, variable: string): boolean {
  const use = new RegExp(`\\b${variable}\\s*\\.`, 'g');

  for (const found of rest.matchAll(use)) {
    const statementEnd = rest.indexOf(';', found.index ?? 0);
    const statement = rest.slice(
      found.index ?? 0,
      statementEnd === -1 ? undefined : statementEnd,
    );

    if (statement.includes('.select(')) return true;
  }

  return false;
}
