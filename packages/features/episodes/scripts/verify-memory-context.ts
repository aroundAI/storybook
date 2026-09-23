/**
 * Verifies the canon memory context builder against a real database
 * (FILM-1110).
 *
 * The unit tests run the builder over a fake client, which records the
 * filters it is given but cannot reject one. Two of the builder's reads
 * named columns that do not exist (`assets.asset_type`,
 * `episodes.episode_number`); PostgREST answered both with HTTP 400 and the
 * builder returned empty sections, so character states and episode
 * summaries never reached generation. Only a real server shows that — and
 * shows that the fix clears it.
 *
 * It seeds, through the API, one team and a project per content type with
 * the same canon in each, builds a context with the service-role client the
 * LLM Lambda uses, and checks what came back.
 *
 * Usage (needs `supabase start`):
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     pnpm --filter @kit/episodes verify
 */
import { createLambdaAdminClient } from '@kit/supabase/lambda-admin-client';

import {
  insertRow,
  seedProject,
  seedTeamAccount,
  updateRows,
} from '../../../../apps/e2e/tests/utils/seed';
import { buildMemoryContext } from '../src/lib/canon/memory-context-builder';

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const results: Array<{ name: string; ok: boolean; detail: string }> = [];

function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
}

interface Expected {
  projectType: string;
  canon?: Record<string, unknown>;
  total: number;
  horizon: number;
  horizonSource: string;
  events: number;
  characters: number;
  threads: number;
  summaries: number;
}

/**
 * The same canon in every project: two permanent events, one character
 * with a state, one open thread, and episodes 1–5 each with a summary.
 * Context is built for episode 6.
 */
const SCENARIOS: Expected[] = [
  {
    projectType: 'series',
    total: 7200,
    horizon: 50,
    horizonSource: 'content-type',
    events: 2,
    characters: 1,
    threads: 1,
    summaries: 5,
  },
  {
    projectType: 'series',
    canon: { memoryHorizon: 2, memoryHorizonMode: 'custom' },
    total: 7200,
    horizon: 2,
    horizonSource: 'canon-settings',
    events: 2,
    characters: 1,
    threads: 1,
    summaries: 2,
  },
  {
    projectType: 'documentary',
    total: 4000,
    horizon: 5,
    horizonSource: 'content-type',
    events: 2,
    characters: 1,
    threads: 1,
    summaries: 5,
  },
  {
    projectType: 'ad',
    total: 4000,
    horizon: 1,
    horizonSource: 'content-type',
    events: 2,
    characters: 1,
    threads: 1,
    summaries: 1,
  },
  {
    // Every narrative category is 0% for news (MEMORY_ALLOCATIONS).
    projectType: 'news',
    total: 2000,
    horizon: 1,
    horizonSource: 'content-type',
    events: 0,
    characters: 0,
    threads: 0,
    summaries: 0,
  },
];

async function seedCanon(projectId: string) {
  const auth = { key: SERVICE_KEY! };

  const episodes: Array<{ id: string }> = [];
  for (let number = 1; number <= 5; number++) {
    const episode = await insertRow<{ id: string }>(
      'episodes',
      { project_id: projectId, number, title: `Episode ${number}` },
      auth,
    );
    episodes.push(episode);

    await insertRow(
      'episode_summaries',
      { episode_id: episode.id, plot_summary: `Episode ${number} happens.` },
      auth,
    );
  }

  for (const [key, type] of [
    ['mara-dies', 'death'],
    ['vault-sealed', 'world_fact'],
  ] as const) {
    await insertRow(
      'immutable_events',
      {
        project_id: projectId,
        event_type: type,
        event_key: key,
        established_in: episodes[1]!.id,
        season: 1,
        episode_number: 2,
        description: `${key} (seeded by verify-memory-context)`,
      },
      auth,
    );
  }

  const jon = await insertRow<{ id: string }>(
    'assets',
    { project_id: projectId, name: 'Jon', type: 'character' },
    auth,
  );

  await insertRow(
    'character_states',
    {
      character_id: jon.id,
      episode_id: episodes[2]!.id,
      state_type: 'knowledge',
      state_value: { knows: 'the vault code' },
      trigger_event: 'Overheard it in episode 3',
    },
    auth,
  );

  await insertRow(
    'narrative_threads',
    {
      project_id: projectId,
      thread_name: 'Who sealed the vault',
      opened_at: episodes[0]!.id,
    },
    auth,
  );
}

async function main() {
  const admin = createLambdaAdminClient();

  if (!admin || !SERVICE_KEY) {
    console.error(
      'Missing Supabase env: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
        '(from `supabase status -o env`).',
    );
    process.exit(1);
  }

  const team = await seedTeamAccount({ emailPrefix: 'verify-memory-context' });
  const projectIds: string[] = [];

  // The builder logs every loader error with console.error; a clean run
  // must log none.
  const loaderErrors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    loaderErrors.push(
      args.map((a) => JSON.stringify(a) ?? String(a)).join(' '),
    );
  };

  try {
    for (const expected of SCENARIOS) {
      const label = `${expected.projectType}${expected.canon ? ' (custom horizon)' : ''}`;
      const project = await seedProject(team);
      projectIds.push(project.id);

      await updateRows('projects', `id=eq.${project.id}`, {
        metadata: {
          projectType: expected.projectType,
          ...(expected.canon && { canon: expected.canon }),
        },
      });
      await seedCanon(project.id);

      const errorsBefore = loaderErrors.length;
      const started = performance.now();
      const context = await buildMemoryContext(admin, {
        projectId: project.id,
        episodeNumber: 6,
      });
      const elapsedMs = Math.round(performance.now() - started);

      const got = {
        projectType: context.metadata.projectType,
        total: context.tokenBudget.total,
        horizon: context.metadata.memoryHorizon,
        horizonSource: context.metadata.memoryHorizonSource,
        events: context.immutableEvents.length,
        characters: context.characterStates.length,
        threads: context.activeThreads.length,
        summaries: context.recentSummaries.length,
      };
      const want = {
        projectType: expected.projectType,
        total: expected.total,
        horizon: expected.horizon,
        horizonSource: expected.horizonSource,
        events: expected.events,
        characters: expected.characters,
        threads: expected.threads,
        summaries: expected.summaries,
      };
      const newErrors = loaderErrors.slice(errorsBefore);

      check(
        label,
        JSON.stringify(got) === JSON.stringify(want) && newErrors.length === 0,
        `${JSON.stringify(got)} in ${elapsedMs}ms` +
          (JSON.stringify(got) === JSON.stringify(want)
            ? ''
            : ` — expected ${JSON.stringify(want)}`) +
          (newErrors.length
            ? ` — loader errors: ${newErrors.join(' | ')}`
            : ''),
      );
    }
  } finally {
    console.error = originalError;

    for (const id of projectIds) {
      await admin.from('projects').delete().eq('id', id);
    }
  }

  const failed = results.filter((r) => !r.ok);

  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: ${r.detail}`);
  }
  console.log(
    `\n${results.length - failed.length} passed, ${failed.length} failed`,
  );

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
