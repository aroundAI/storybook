/**
 * KB-61's source scan: PostgREST deletes and soft deletes whose statement
 * never asks for the rows it changed. See `kb61-unchecked-deletes.test.ts`.
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

const WRITE = /\.delete\(\s*(?:\{[^)]*\})?\s*\)|\.update\(\s*\{\s*deleted_at\s*:/g;

export function findUncheckedDeletes(source: string): UncheckedDelete[] {
  const found: UncheckedDelete[] = [];

  for (const match of source.matchAll(WRITE)) {
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

    if (variable && source.slice(at).includes(`${variable}.select(`)) continue;

    found.push({
      table,
      op: match[0].startsWith('.delete') ? 'delete' : 'soft-delete',
    });
  }

  return found;
}
