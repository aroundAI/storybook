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
 * FILM-1111 adds three scenarios (`verifyStrategies`): ranking at episode
 * 60 of a series, verified-only sources, and a news project that returns no
 * narrative canon.
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
import {
  type CanonReadClient,
  buildMemoryContext,
} from '../src/lib/canon/memory-context-builder';

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

async function seedProjectOfType(
  team: Awaited<ReturnType<typeof seedTeamAccount>>,
  projectType: string,
  projectIds: string[],
) {
  const project = await seedProject(team);
  projectIds.push(project.id);
  await updateRows('projects', `id=eq.${project.id}`, {
    metadata: { projectType },
  });
  return project.id;
}

async function seedFact(
  projectId: string,
  claim: string,
  verificationStatus: string,
  confidence: number,
) {
  await insertRow(
    'verified_facts',
    {
      project_id: projectId,
      claim,
      source_type: 'other',
      source_citation: `Citation for: ${claim}`,
      verification_status: verificationStatus,
      confidence_score: confidence,
    },
    { key: SERVICE_KEY! },
  );
}

/** Runs one scenario; a scenario that throws fails alone, not the run. */
async function scenario(name: string, run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    check(name, false, `threw: ${(error as Error).message}`);
  }
}

/**
 * FILM-1111: ranking, sources and news, against real PostgREST — the
 * filters (`in`, `order … nullslast`, `range`) are the part a fake client
 * cannot reject.
 */
async function verifyStrategies(
  admin: CanonReadClient,
  team: Awaited<ReturnType<typeof seedTeamAccount>>,
  projectIds: string[],
) {
  const auth = { key: SERVICE_KEY! };

  // (a) Series at episode 60, §3 of the FILM-1111 EDD. Threads are inserted
  // in the expected order, so `updated_at desc` (the order before ranking)
  // would return them reversed; characters are inserted least recent first.
  await scenario('series ranking at episode 60', async () => {
    const projectId = await seedProjectOfType(team, 'series', projectIds);
    const ep = new Map<number, string>();
    for (const number of [1, 2, 3, 30, 40, 48, 52, 55, 57, 58]) {
      const row = await insertRow<{ id: string }>(
        'episodes',
        { project_id: projectId, number, title: `Episode ${number}` },
        auth,
      );
      ep.set(number, row.id);
    }
    const ids = (...numbers: number[]) => numbers.map((n) => ep.get(n)!);

    for (const [name, opened, touched] of [
      ['T-hot', 40, [40, 48, 52, 55]],
      ['T-once', 57, [57]],
      ['T-mid', 30, [30]],
      ['T-old', 1, [1, 2]],
    ] as const) {
      await insertRow(
        'narrative_threads',
        {
          project_id: projectId,
          thread_name: name,
          opened_at: ep.get(opened),
          episodes_touched: ids(...touched),
        },
        auth,
      );
    }

    for (const [name, episode] of [
      ['Mara', 3],
      ['Jon', 58],
    ] as const) {
      const character = await insertRow<{ id: string }>(
        'assets',
        { project_id: projectId, name, type: 'character' },
        auth,
      );
      await insertRow(
        'character_states',
        {
          character_id: character.id,
          episode_id: ep.get(episode),
          state_type: 'emotional',
          state_value: { mood: 'tense' },
          trigger_event: `Seeded for episode ${episode}`,
        },
        auth,
      );
    }

    const full = await buildMemoryContext(admin, {
      projectId,
      episodeNumber: 60,
    });

    // A budget with room for the first-ranked character and half of the
    // second: series gives characters 25% of the total, so total = 4 × that.
    const tokens = (value: unknown) =>
      Math.ceil(JSON.stringify(value).length / 4);
    const [first, second] = full.characterStates;
    const roomForOne = tokens(first) + Math.floor(tokens(second) / 2);
    const tight = await buildMemoryContext(admin, {
      projectId,
      episodeNumber: 60,
      tokenBudgetPercent: (roomForOne * 4 * 100) / 40_000,
    });

    const got = {
      threads: full.activeThreads.map((t) => t.threadName),
      characters: full.characterStates.map((c) => c.characterName),
      charactersWhenOneFits: tight.characterStates.map((c) => c.characterName),
      decay: full.metadata.decayFunction,
    };
    const want = {
      threads: ['T-hot', 'T-once', 'T-mid', 'T-old'],
      characters: ['Jon', 'Mara'],
      charactersWhenOneFits: ['Jon'],
      decay: 'exponential',
    };
    check(
      'series ranking at episode 60',
      JSON.stringify(got) === JSON.stringify(want),
      JSON.stringify(got),
    );
  });

  // (b) Documentary: only verified facts, highest confidence first.
  await scenario('documentary sources are verified facts only', async () => {
    const projectId = await seedProjectOfType(team, 'documentary', projectIds);
    await seedFact(projectId, 'Unverified claim', 'unverified', 0.99);
    await seedFact(projectId, 'Second verified claim', 'verified', 0.6);
    await seedFact(projectId, 'Disputed claim', 'disputed', 0.95);
    await seedFact(projectId, 'Retracted claim', 'retracted', 0.97);
    await seedFact(projectId, 'First verified claim', 'verified', 0.9);

    const context = await buildMemoryContext(admin, {
      projectId,
      episodeNumber: 2,
    });

    const got = context.sources.map((s) => `${s.claim} (${s.confidence})`);
    const want = ['First verified claim (0.9)', 'Second verified claim (0.6)'];
    check(
      'documentary sources are verified facts only',
      JSON.stringify(got) === JSON.stringify(want),
      JSON.stringify(got),
    );
  });

  // (c) News: canon rows present, nothing narrative returned, facts loaded.
  await scenario('news carries no episode history', async () => {
    const projectId = await seedProjectOfType(team, 'news', projectIds);
    await seedCanon(projectId);
    const { data: episode } = await admin
      .from('episodes')
      .select('id')
      .eq('project_id', projectId)
      .eq('number', 5)
      .single();
    await insertRow(
      'world_states',
      { project_id: projectId, episode_id: episode!.id, location: 'Newsroom' },
      auth,
    );
    await seedFact(projectId, 'Rates rose 0.25%', 'verified', 0.95);

    const context = await buildMemoryContext(admin, {
      projectId,
      episodeNumber: 6,
    });

    const got = {
      events: context.immutableEvents.length,
      characters: context.characterStates.length,
      threads: context.activeThreads.length,
      summaries: context.recentSummaries.length,
      world: context.worldState ? 1 : 0,
      sources: context.sources.length,
    };
    const want = {
      events: 0,
      characters: 0,
      threads: 0,
      summaries: 0,
      world: 0,
      sources: 1,
    };
    check(
      'news carries no episode history',
      JSON.stringify(got) === JSON.stringify(want),
      JSON.stringify(got),
    );
  });
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

    const errorsBefore = loaderErrors.length;
    await verifyStrategies(admin, team, projectIds);
    const strategyErrors = loaderErrors.slice(errorsBefore);
    check(
      'FILM-1111 scenarios log no loader errors',
      strategyErrors.length === 0,
      strategyErrors.join(' | ') || 'none',
    );
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
