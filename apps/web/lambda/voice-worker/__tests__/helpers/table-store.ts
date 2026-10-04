/**
 * A small in-memory PostgREST stand-in for the dub-episode tests: the
 * filters the handler uses narrow rows, writes change them, an upsert
 * matches on its `onConflict` columns, and an update of `episodes` moves
 * `version` as the bump trigger does.
 */
type Row = Record<string, unknown>;

export function tableStore(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];

  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let op: 'select' | 'update' | 'upsert' = 'select';
    let payload: unknown = null;
    let onConflict: string[] = [];
    let single = false;
    let range: [number, number] | null = null;
    let order: { column: string; ascending: boolean } | null = null;

    const rows = () => (tables[table] ??= []);

    const run = () => {
      if (op === 'upsert') {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const out: Row[] = [];

        for (const incoming of list) {
          const existing = rows().find((row) =>
            onConflict.every((column) => row[column] === incoming[column]),
          );

          if (existing) {
            Object.assign(existing, incoming);
            out.push(existing);
          } else {
            const row = { id: crypto.randomUUID(), ...incoming };
            rows().push(row);
            out.push(row);
          }
        }

        writes.push({ table, op, payload });
        return out;
      }

      let matched = rows().filter((row) => filters.every((f) => f(row)));

      if (op === 'update') {
        for (const row of matched) {
          Object.assign(row, payload as Row);
          if (table === 'episodes') row.version = Number(row.version ?? 1) + 1;
        }
        writes.push({ table, op, payload });
      }

      if (order) {
        const { column, ascending } = order;
        matched = [...matched].sort(
          (a, b) =>
            (Number(a[column]) - Number(b[column])) * (ascending ? 1 : -1),
        );
      }

      if (range) matched = matched.slice(range[0], range[1] + 1);

      return matched.map((row) => ({ ...row }));
    };

    const chain: Record<string, unknown> = {
      select: () => chain,
      update: (values: unknown) => {
        op = 'update';
        payload = values;
        return chain;
      },
      upsert: (values: unknown, options?: { onConflict?: string }) => {
        op = 'upsert';
        payload = values;
        onConflict = (options?.onConflict ?? 'id').split(',');
        return chain;
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return chain;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return chain;
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => (row[column] ?? null) === value);
        return chain;
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        order = { column, ascending: options?.ascending ?? true };
        return chain;
      },
      range: (from: number, to: number) => {
        range = [from, to];
        return chain;
      },
      maybeSingle: () => {
        single = true;
        return chain;
      },
      then: (resolve: (value: unknown) => unknown) => {
        const data = run();
        return Promise.resolve(
          resolve({ data: single ? (data[0] ?? null) : data, error: null }),
        );
      },
    };

    return chain;
  };

  return { client: { from } as never, tables, writes };
}
