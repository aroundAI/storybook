/**
 * Verifies the Postgres/PostgREST half against a real database.
 *
 * The pagination helpers in @kit/shared are unit-tested against a fake
 * pager, which proves the loop terminates but says nothing about the thing
 * that motivated them: PostgREST silently truncates every response at
 * `db-max-rows` (1000 here) with HTTP 200 and `error: null`, service-role
 * included. That cap is a property of the server, so only a real server can
 * demonstrate it — and demonstrate that the fix actually clears it.
 *
 * Usage (needs `supabase start` and deployment/config/local.env):
 *   pnpm --filter @kit/supabase verify
 */
import { createClient } from '@supabase/supabase-js';

import { fetchAllByIds, fetchAllRows } from '../../shared/src/pagination';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Comfortably past the 1000-row cap, cheap to insert. */
const SEED_ROWS = 1200;
const SEED_DIMENSION = 'topic';
const SEED_PREFIX = 'verify-pagination-';

const results: Array<{ name: string; ok: boolean; detail: string }> = [];

async function step(name: string, run: () => Promise<string>) {
  try {
    results.push({ name, ok: true, detail: await run() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, detail: message.slice(0, 200) });
  }
}

function requireEnv() {
  if (!URL || !SERVICE_KEY || !ANON_KEY) {
    console.error(
      'Missing Supabase env. Load deployment/config/local.env first:\n' +
        '  set -a && . deployment/config/local.env && set +a',
    );
    process.exit(1);
  }
}

async function main() {
  requireEnv();

  const admin = createClient(URL!, SERVICE_KEY!, {
    auth: { persistSession: false },
  });
  const anon = createClient(URL!, ANON_KEY!, {
    auth: { persistSession: false },
  });

  // A seeded account to hang the fixture rows off.
  const { data: account, error: accountError } = await admin
    .from('accounts')
    .select('id')
    .limit(1)
    .maybeSingle();

  if (accountError || !account) {
    console.error('No account to seed against:', accountError?.message);
    process.exit(1);
  }

  const accountId = account.id as string;

  await step('seed rows past the row cap', async () => {
    await admin.from('content_tags').delete().like('slug', `${SEED_PREFIX}%`);

    // Chunked: the insert payload is a body rather than a URI, but a single
    // 1200-row insert is still worth splitting.
    for (let index = 0; index < SEED_ROWS; index += 300) {
      const batch = Array.from(
        { length: Math.min(300, SEED_ROWS - index) },
        (_, offset) => ({
          account_id: accountId,
          dimension: SEED_DIMENSION,
          slug: `${SEED_PREFIX}${String(index + offset).padStart(5, '0')}`,
          label: `Verify ${index + offset}`,
        }),
      );

      const { error } = await admin.from('content_tags').insert(batch);
      if (error) throw new Error(error.message);
    }

    return `${SEED_ROWS} rows`;
  });

  await step('an unbounded read IS truncated, silently', async () => {
    const { data, error } = await admin
      .from('content_tags')
      .select('id')
      .like('slug', `${SEED_PREFIX}%`);

    // The failure mode this whole sweep exists for: a short body, HTTP 200,
    // and error === null. If this ever stops truncating, the cap changed
    // and the pagination helpers' assumptions should be revisited.
    if (error) throw new Error(`expected no error, got ${error.message}`);
    if (data?.length !== 1000) {
      throw new Error(
        `expected the server to cap at 1000, got ${data?.length}`,
      );
    }

    return `capped at ${data.length}, error=null`;
  });

  await step('fetchAllRows returns every row', async () => {
    const rows = await fetchAllRows<{ id: string }>(
      (from, to) =>
        admin
          .from('content_tags')
          .select('id')
          .like('slug', `${SEED_PREFIX}%`)
          .order('id')
          .range(from, to),
      'content_tags',
    );

    if (rows.length !== SEED_ROWS) {
      throw new Error(`expected ${SEED_ROWS}, got ${rows.length}`);
    }

    const unique = new Set(rows.map((r) => r.id)).size;

    // Ordering by a unique column is what makes the pages disjoint; without
    // it range boundaries skip and repeat rows.
    if (unique !== SEED_ROWS) {
      throw new Error(`expected ${SEED_ROWS} distinct ids, got ${unique}`);
    }

    return `${rows.length} rows, all distinct`;
  });

  await step('fetchAllByIds chunks and de-duplicates', async () => {
    const ids = await fetchAllRows<{ id: string }>(
      (from, to) =>
        admin
          .from('content_tags')
          .select('id')
          .like('slug', `${SEED_PREFIX}%`)
          .order('id')
          .range(from, to),
      'ids',
    );

    const idList = ids.map((r) => r.id);
    // A repeat that lands in a later chunk would return its row twice
    // without the dedupe inside fetchAllByIds.
    const withDupe = [...idList, idList[0]!];

    const rows = await fetchAllByIds<{ id: string }>(
      withDupe,
      (chunk, from, to) =>
        admin
          .from('content_tags')
          .select('id')
          .in('id', chunk)
          .order('id')
          .range(from, to),
      'content_tags by id',
    );

    if (rows.length !== SEED_ROWS) {
      throw new Error(`expected ${SEED_ROWS}, got ${rows.length}`);
    }

    return `${withDupe.length} ids in, ${rows.length} rows out`;
  });

  await step('RLS hides the rows from an anonymous client', async () => {
    const { data, error } = await anon
      .from('content_tags')
      .select('id')
      .like('slug', `${SEED_PREFIX}%`);

    // Anon must not see these rows. Two acceptable shapes: an outright
    // permission error, or a successful empty result under RLS — this
    // schema denies at the grant level, which is the stricter of the two.
    //
    // The distinction matters. The revenue-alert bug was an admin-client
    // read with no account predicate, and it was invisible precisely
    // because a filtered read succeeds and returns nothing. Anything that
    // returns rows here is the real failure.
    if (data && data.length > 0) {
      throw new Error(`anon client saw ${data.length} rows`);
    }

    return error ? `denied: ${error.message}` : 'anon sees 0 rows';
  });

  await step('cleanup', async () => {
    const { error } = await admin
      .from('content_tags')
      .delete()
      .like('slug', `${SEED_PREFIX}%`);

    if (error) throw new Error(error.message);
    return 'fixture removed';
  });

  const failed = results.filter((r) => !r.ok);

  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(46)} ${r.detail}`);
  }

  console.log(
    `\n${results.length - failed.length} passed, ${failed.length} failed`,
  );

  process.exit(failed.length > 0 ? 1 : 0);
}

void main();
