/**
 * Shared inputs for the FILM-1901 parity tests of the story, ideation,
 * season_outline and season_analysis stages.
 *
 * The fixtures in `../fixtures/*-parity.json` were captured by running the
 * old handlers (before their bodies were deleted) with exactly these inputs:
 * the orchestrator (or executor) input each handler built, and every write
 * it issued. The parity tests run the rewritten handlers with the same
 * inputs and expect the same inputs and writes back.
 */
import type { RecordedCall, Responder } from '@kit/generation/testing';
import { tableResponder } from '@kit/generation/testing';

import type { EpisodeContext } from '../../utils/context-builder';

export const NOW = new Date('2026-10-03T12:00:00.000Z');

export const IDS = {
  accountId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  episodeId: '55555555-5555-4555-8555-555555555555',
  userId: '44444444-4444-4444-8444-444444444444',
  seasonId: '66666666-6666-4666-8666-666666666666',
};

export const EPISODE_CONTEXT: EpisodeContext = {
  premise: 'A lonely astronaut hears a signal that should not exist.',
  synopsis: undefined,
  episodeNumber: 2,
  seasonNumber: 1,
  characters: [
    {
      id: 'c1',
      name: 'Maya Chen',
      role: 'protagonist',
      description: 'Commander of the relay mission.',
      personality: 'Methodical, lonely, dry humour',
      physicalAttributes: { gender: 'female', age: 38 },
      clothingStyle: { defaultOutfit: 'grey flight suit' },
    },
    {
      id: 'c2',
      name: 'Director Williams',
      role: 'supporting',
      description: 'Mission director back on Earth.',
    },
  ],
  locations: [
    {
      id: 'l1',
      name: 'Observation Deck',
      setting: 'spacecraft interior',
      description: 'A glass-walled deck facing Earth.',
      atmosphere: 'silent, blue-lit',
    },
  ],
  seasonPremise: 'Humanity builds its first deep-space relay.',
  seasonDirectionNotes: 'Keep every episode under ten minutes.',
  previousEpisodes: [
    {
      number: 1,
      title: 'Launch Day',
      summary: 'Maya leaves Earth and settles into the relay station.',
      keyEvents: ['Maya launches', 'First transmission home'],
      relation: 'recent',
    },
  ],
  genre: 'sci-fi',
  targetAudience: 'adults',
  visualStyle: 'cinematic',
  recurringElements: [
    {
      id: 'r1',
      name: 'Log entry',
      enabled: true,
      placement: 'end',
      purpose: 'Maya records a log entry',
    },
  ],
  episodeFacts: [],
  projectType: 'series',
  verifiedFacts: [],
};

export const STORY_PAYLOAD = {
  ...IDS,
  title: 'The Last Signal',
  logline: 'A lonely astronaut hears a signal that carries her own voice.',
  targetDuration: 300,
  contentStyle: 'dialogue-heavy',
  version: 1,
  themes: ['isolation', 'purpose'],
  hook: 'The signal is her own voice from the future.',
  visualDirection: 'Tight interiors against the vastness outside.',
  threadCandidates: [
    { threadId: 't1', threadName: 'The missing memo', action: 'progress' },
  ],
};

export const STORY_TEXT =
  'Commander Maya Chen floats in the silence of the observation deck. '.repeat(
    12,
  );

export const STORY_ORCHESTRATOR_RESULT = {
  success: true,
  viralQuality: {
    overallScore: 0.72,
    decision: 'pass',
    whyThisWorks: 'A tight curiosity gap.',
    whatToImprove: 'The ending resolves too quickly.',
    dimensionScores: {
      hookStrength: 0.8,
      curiosityGap: 0.9,
      emotionalArc: 0.7,
      setupPayoff: 0.6,
      dialogueSubtext: 0.7,
      loopability: 0.6,
      memorableMoment: 0.7,
    },
    revisionsApplied: [],
    orchestratorSteps: 5,
    reelCandidates: [],
  },
  storyText: STORY_TEXT,
  storyTitle: 'The Last Signal',
  actBreakdown: {
    act1: 'Maya hears the signal.',
    act2: 'Maya decodes it.',
    act3: 'Maya sends it.',
  },
  storyCharacters: [
    { name: 'Maya Chen', role: 'protagonist', arc: 'From routine to purpose.' },
    {
      name: 'Director Williams',
      role: 'supporting',
      arc: 'From control to trust.',
    },
  ],
  newCharacters: [
    {
      name: 'Kai',
      role: 'supporting',
      description: 'A voice on the relay.',
      physicalDescription: 'Unseen; a warm baritone.',
    },
  ],
  newLocations: [
    {
      name: 'The Relay Core',
      setting: 'machine room',
      description: 'The humming heart of the station.',
    },
  ],
  themes: ['isolation', 'purpose'],
  tone: 'contemplative',
  estimatedSceneCount: 6,
  episodeSummary: 'Maya hears, decodes and finally sends the signal herself.',
  sentimentScore: 0.6,
  keyEvents: ['Maya hears the signal', 'Maya sends the warning'],
  viralStructure: {
    openingHook: 'An alarm from coordinates that do not exist.',
    curiosityGap: 'Who sent the signal?',
    emotionalArc: ['unease', 'dread', 'awe'],
    setupPayoffPair: { setup: 'A recurring dream', payoff: 'Her own voice' },
    loopBeat: 'Maya alone at the console, now sending.',
    memorableScene: 'Maya hears her own voice describe the present.',
  },
  orchestratorSteps: 5,
};

export const CANON_EXTRACTION = {
  threadUpdates: [
    {
      threadName: 'The signal',
      threadType: 'mystery',
      action: 'open',
      description: 'Where the signal comes from.',
      promises: ['Reveal the sender'],
    },
    {
      threadName: 'The missing memo',
      action: 'progress',
      description: 'Williams admits the memo exists.',
    },
  ],
  episodeSummary: 'Maya receives a signal carrying her own voice.',
  sentimentScore: 0.4,
  keyEvents: ['Maya hears the signal'],
  characterStateChanges: [
    { characterName: 'Maya Chen', fromState: 'bored', toState: 'alert' },
  ],
  worldState: { location: 'The relay station', timePeriod: 'Month three' },
};

export const IDEATION_PAYLOAD = {
  accountId: IDS.accountId,
  episodeId: IDS.episodeId,
  userId: IDS.userId,
  premise: 'A signal from nowhere.',
  numberOfIdeas: 2,
};

export const IDEATION_ORCHESTRATOR_RESULT = {
  success: true,
  ideas: [
    {
      title: 'The Last Signal',
      logline: 'An astronaut hears her own voice from the future.',
      hook: 'The voice is hers.',
      conflict: 'Obey the mission or act on the warning.',
      themes: ['isolation', 'time'],
      visualPotential: 'Space against a single lit console.',
      qualityScore: 0.8,
    },
    {
      title: 'Static',
      logline: 'The signal leaks and the world splits over it.',
      hook: 'Someone knew for decades.',
      conflict: 'Truth against stability.',
      themes: ['trust'],
      visualPotential: 'Crowds, screens, one quiet lab.',
      qualityScore: 0.6,
    },
  ],
  orchestratorSteps: 3,
};

export const SEASON_OUTLINE_PAYLOAD = {
  accountId: IDS.accountId,
  projectId: IDS.projectId,
  userId: IDS.userId,
  seasonId: IDS.seasonId,
  seasonPremise: 'Humanity builds its first deep-space relay.',
  episodeCount: 2,
  startingNumber: 3,
  genre: 'sci-fi',
  style: 'cinematic',
};

export const SEASON_OUTLINE_ORCHESTRATOR_RESULT = {
  success: true,
  episodes: [
    {
      number: 3,
      title: 'The First Light',
      premise: 'A mysterious signal from deep space awakens humanity.',
      mainPlot:
        'Dr. Sarah Chen discovers a pattern in cosmic background radiation that defies natural explanation and races to decode it.',
      characterFocus: ['Maya Chen'],
      arcPosition: 'setup',
      fact_ids: ['f1'],
    },
    {
      number: 4,
      title: 'Static',
      premise: 'As the world learns about the signal, factions emerge.',
      mainPlot:
        'The discovery leaks to the press, sparking global chaos while Marcus uncovers evidence that someone has known for decades.',
      characterFocus: ['Director Williams'],
      arcPosition: 'rising',
      fact_ids: ['f2'],
    },
  ],
  arcScore: 0.81,
  arcSummary: 'Stakes escalate cleanly.',
  orchestratorSteps: 4,
};

export const SEASON_ANALYSIS_PAYLOAD = {
  accountId: IDS.accountId,
  projectId: IDS.projectId,
  userId: IDS.userId,
  roadmap:
    '* **Creature:** The Dragon\n* **The Mystery:** Something is missing\n* **Moral:** Be kind.',
  externalFacts: [
    { id: 'f1', claim: 'Dragons hoard gold.', source_citation: 'Lore, p.3' },
  ],
};

export const SEASON_ANALYSIS_RESULT = {
  premise: 'A detective and a dragon solve small mysteries.',
  tone: 'comedic',
  target_audience: 'kids 4-8',
  characters: [
    { name: 'Dante', role: 'protagonist', description: 'A patient detective.' },
  ],
  locations: [
    { name: 'The Market', description: 'A busy square.', setting: 'town' },
  ],
  episodes: [
    {
      number: 1,
      title: 'The Missing Weight',
      synopsis: 'Something goes missing and it was a misunderstanding.',
      beats: [
        { label: 'Creature', content: 'The Dragon' },
        { label: 'The Mystery', content: 'Something is missing' },
      ],
      moral: 'Be kind.',
      signature_line: null,
      character_names: ['Dante'],
      location_names: ['The Market'],
      tags: ['comedy'],
      fact_ids: ['f1'],
    },
  ],
};

/** The rows the fake database serves, keyed by table. */
export const TABLES: Record<string, unknown> = {
  episodes: {
    id: IDS.episodeId,
    project_id: IDS.projectId,
    season_id: IDS.seasonId,
    number: 2,
    title: 'The Last Signal',
    status: 'draft',
    deleted_at: null,
    version: 3,
    story_data: null,
    metadata: { character_ids: ['c1'], location_ids: ['l1'] },
  },
  generation_jobs: { id: 'job-1', status: 'processing' },
  projects: {
    id: IDS.projectId,
    name: 'Relay',
    account_id: IDS.accountId,
    metadata: {
      genre: 'sci-fi',
      projectType: 'documentary',
      recurringElements: [
        {
          id: 'r1',
          name: 'Log entry',
          enabled: true,
          placement: 'end',
          purpose: 'Maya records a log entry',
        },
      ],
    },
  },
  narrative_threads: [
    {
      id: 'thread-1',
      thread_name: 'The missing memo',
      thread_type: 'plot',
      status: 'open',
      description: 'A memo nobody will acknowledge.',
      promises: ['Find the memo'],
      episodes_touched: ['ep-1'],
      version: 1,
      payoffs: [],
    },
  ],
  verified_facts: [
    {
      id: 'f1',
      project_id: IDS.projectId,
      claim: 'The relay orbits at L2.',
      source_citation: 'Mission brief',
      category: 'orbit',
      verification_status: 'verified',
    },
    {
      id: 'f2',
      project_id: IDS.projectId,
      claim: 'Signals take four seconds to reach Earth.',
      source_citation: null,
      category: null,
      verification_status: 'verified',
    },
  ],
  episode_summaries: [],
  world_states: [],
  state_deltas: [],
  immutable_events: [],
  character_states: [],
};

const CHARACTER_ASSETS = [
  { id: 'c1', name: 'Maya Chen', type: 'character', description: 'Commander.' },
  {
    id: 'c2',
    name: 'Director Williams',
    type: 'character',
    description: 'Director.',
  },
];

const LOCATION_ASSETS = [
  {
    id: 'l1',
    name: 'Observation Deck',
    type: 'location',
    description: 'A glass deck.',
  },
];

function has(call: RecordedCall, method: string) {
  return call.chain.some((step) => step.method === method);
}

function filterValue(call: RecordedCall, column: string) {
  return call.chain.find(
    (step) => step.method === 'eq' && step.args[0] === column,
  )?.args[1];
}

/**
 * Serves `TABLES`, answers asset reads by their `type` filter, and returns
 * one row for `.single()` / `.maybeSingle()` reads the way PostgREST does.
 */
export function parityResponder(): Responder {
  const base = tableResponder(TABLES);

  return (call) => {
    const isWrite = call.chain.some((step) =>
      ['insert', 'update', 'upsert', 'delete'].includes(step.method),
    );

    if (call.table === 'assets' && !isWrite) {
      const type = filterValue(call, 'type');
      const rows = type === 'location' ? LOCATION_ASSETS : CHARACTER_ASSETS;
      return { data: has(call, 'single') ? rows[0] : rows };
    }

    if (call.table === 'assets') {
      const payload = call.chain.find((step) =>
        ['insert', 'upsert'].includes(step.method),
      )?.args[0];
      const rows = Array.isArray(payload) ? payload : [payload];
      return {
        data: rows.map((row, index) => ({
          id: `new-${index}`,
          ...(row as object),
        })),
      };
    }

    if (call.table === 'verified_facts' && has(call, 'select')) {
      const options = call.chain.find((step) => step.method === 'select')
        ?.args[1] as { head?: boolean } | undefined;
      const rows = TABLES.verified_facts as unknown[];
      if (options?.head) return { data: null, count: rows.length };
      return { data: rows, count: rows.length };
    }

    const response = base(call);

    if (
      response &&
      !isWrite &&
      Array.isArray(response.data) &&
      (has(call, 'single') || has(call, 'maybeSingle'))
    ) {
      return { data: response.data[0] ?? null };
    }

    if (
      response &&
      isWrite &&
      has(call, 'select') &&
      has(call, 'maybeSingle') &&
      Array.isArray(response.data)
    ) {
      return { data: response.data[0] ?? null };
    }

    return response;
  };
}
