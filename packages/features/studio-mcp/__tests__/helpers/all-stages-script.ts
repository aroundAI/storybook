import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * FILM-1909's scripted MCP client: what an agent does to take one episode
 * through every stage over MCP, in external mode, with outputs built from
 * each brief the way an agent reads it (the part's scene number, the
 * scene's shots and lines, the constraints). The contract test and the
 * Playwright spec both run it, so the browser reads exactly what the
 * contract test checked in the database.
 *
 * It throws on any refusal, naming the stage, part and errors, so a red run
 * says what the server refused.
 */
export type ToolResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

export type Call = (
  name: string,
  args: Record<string, unknown>,
) => Promise<ToolResult>;

/**
 * A call that waits out RATE_LIMITED, as an agent should: a whole episode
 * is more writes than a minute's default allowance (20).
 */
export function patient(call: Call, maxWaitS = 70): Call {
  return async (name, args) => {
    for (;;) {
      const result = await call(name, args);
      const body = result.structuredContent as
        | { code?: string; details?: { retry_after_s?: number } }
        | undefined;

      if (!(result.isError && body?.code === 'RATE_LIMITED')) return result;

      const wait = Math.min(body.details?.retry_after_s ?? 5, maxWaitS);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    }
  };
}

export interface Brief {
  stage: string;
  part: { key: string; index: number; total: number; label: string };
  context: Record<string, unknown>;
  constraints: Record<string, unknown>;
}

export interface StageRun {
  stage: string;
  runId: string;
  parts: string[];
  finalized: Record<string, unknown>;
}

/**
 * The cast the scripted episode is written with: the team's assets, linked
 * to the episode as the web's episode header links them (an MCP client
 * cannot link existing assets yet, KB-183). `linkCast` writes that link.
 */
export const WORLD = {
  characters: ['Maya Chen', 'Director Williams'],
  location: 'Observation Deck',
};

/** episodes.metadata as linkAssetToEpisodeAction leaves it for the cast */
export function linkedCast(
  metadata: Record<string, unknown>,
  assets: Array<{ id: string; name: string; type: string }>,
) {
  const of = (type: string) => assets.filter((a) => a.type === type);

  return {
    ...metadata,
    character_ids: of('character').map((a) => a.id),
    character_names: of('character').map((a) => a.name),
    location_ids: of('location').map((a) => a.id),
    location_names: of('location').map((a) => a.name),
  };
}

const here = __dirname;

const STORY = JSON.parse(
  readFileSync(path.join(here, '../fixtures/story-submission.json'), 'utf8'),
).output as { story: Record<string, unknown> };

const SHOTS_FIXTURE = JSON.parse(
  readFileSync(
    path.join(
      here,
      '../../../generation/__tests__/fixtures/shots-model-output.json',
    ),
    'utf8',
  ),
) as {
  scenes: Array<{ shots: Array<Record<string, unknown>> }>;
};

/** The shots each scene part carries: the fixture's first scene. */
export const SHOTS_PER_SCENE = SHOTS_FIXTURE.scenes[0]!.shots.length;

/** The shots fixture's first scene, recast into this world. */
function templateShots(): Array<Record<string, unknown>> {
  const recast = JSON.stringify(SHOTS_FIXTURE.scenes[0]!.shots)
    .replaceAll('Dev Patel', WORLD.characters[1]!)
    .replaceAll('Dev ', 'Williams ')
    .replaceAll('The Office', WORLD.location);

  return JSON.parse(recast) as Array<Record<string, unknown>>;
}

function structured<T = Record<string, unknown>>(
  result: ToolResult,
  what: string,
): T {
  if (result.isError) {
    throw new Error(`${what} failed: ${JSON.stringify(result.structuredContent)}`);
  }

  return result.structuredContent as T;
}

/**
 * Submits every part of an open run, each built from its own brief, and
 * finalizes it (a single-part stage finalizes on submit).
 */
export async function drive(
  call: Call,
  stage: string,
  runId: string,
  first: Brief,
  outputFor: (brief: Brief) => unknown,
): Promise<StageRun> {
  const parts: string[] = [];
  let brief: Brief | null = first;

  while (brief) {
    const submitted: {
      status: string;
      errors?: unknown;
      nextBrief?: Brief;
      next: unknown;
      finalized?: Record<string, unknown>;
    } = structured(
      await call('submit_generation', {
        runId,
        partKey: brief.part.key,
        output: outputFor(brief),
        model: 'claude-scripted',
      }),
      `${stage} ${brief.part.key}`,
    );

    if (submitted.status !== 'accepted') {
      throw new Error(
        `${stage} ${brief.part.key} was refused: ${JSON.stringify(submitted.errors)}`,
      );
    }

    parts.push(brief.part.key);

    if (submitted.finalized) {
      return { stage, runId, parts, finalized: submitted.finalized };
    }

    brief = submitted.nextBrief ?? null;
  }

  const finalized = structured(
    await call('finalize_generation', { runId }),
    `${stage} finalize`,
  );

  return { stage, runId, parts, finalized };
}

export async function runStage(
  call: Call,
  start: {
    stage: string;
    episodeId?: string;
    projectId?: string;
    assetId?: string;
    options?: Record<string, unknown>;
  },
  outputFor: (brief: Brief) => unknown,
): Promise<StageRun> {
  const started = structured<{ run: { runId: string }; brief: Brief }>(
    await call('start_generation', start),
    `${start.stage} start`,
  );

  return drive(
    call,
    start.stage,
    started.run.runId,
    started.brief,
    outputFor,
  );
}

/** A child run a commit opened (shots → audio_cues): its first pending part. */
export async function driveChild(
  call: Call,
  stage: string,
  runId: string,
  outputFor: (brief: Brief) => unknown,
): Promise<StageRun> {
  const run = structured<{ run: { parts: Array<{ partKey: string }> } }>(
    await call('get_run', { runId }),
    `${stage} get_run`,
  );
  const firstPart = run.run.parts[0]!.partKey;
  const { brief } = structured<{ brief: Brief }>(
    await call('get_brief', { runId, partKey: firstPart }),
    `${stage} get_brief`,
  );

  return drive(call, stage, runId, brief, outputFor);
}

// ---------------------------------------------------------------------------
// What the agent writes, stage by stage
// ---------------------------------------------------------------------------

const [MAYA, WILLIAMS] = WORLD.characters as [string, string];

export const outputs = {
  ideation: () => ({
    ideas: [
      {
        title: 'The Last Signal',
        logline: 'An astronaut hears a signal that carries her own voice.',
        hook: 'The voice is hers.',
        conflict: 'Obey mission control or answer the signal.',
        themes: ['isolation'],
        visualPotential: 'One lit console in a dark deck.',
      },
      {
        title: 'Static',
        logline: 'The signal leaks to Earth before Maya understands it.',
        hook: 'Someone on Earth already knew.',
        themes: ['trust'],
        visualPotential: 'Screens flickering in sync.',
      },
    ],
  }),

  story: () => STORY,

  storyRefinement: () => ({
    story: {
      fullText: `${String(STORY.story.fullText)} In the end, nobody answers but her.`,
    },
  }),

  /** Part i is scene i+1: a scene on the deck, both characters speaking. */
  screenplay: (brief: Brief) => {
    const number = brief.part.index + 1;

    return {
      scenes: [
        {
          number,
          heading: `INT. OBSERVATION DECK - NIGHT`,
          location: WORLD.location,
          timeOfDay: 'night',
          description: `Scene ${number}: Maya listens at the console.`,
          dialogue: [
            { character: MAYA, text: `Signal ${number}. It is my voice.` },
            { character: WILLIAMS, text: `Log it, Commander. Scene ${number}.` },
          ],
          estimatedDuration: 30,
        },
      ],
    };
  },

  /** The stored screenplay, scene 1 made calmer. */
  screenplayRefinement: (brief: Brief) => {
    const current = brief.context.currentScreenplay as {
      scenes: Array<Record<string, unknown>>;
    };
    const scenes = current.scenes.map((scene, index) =>
      index === 0
        ? { ...scene, description: 'Maya listens, calmer now.' }
        : scene,
    );

    return {
      screenplay: {
        scenes,
        metadata: {
          totalScenes: scenes.length,
          estimatedDuration: scenes.length * 30,
          locations: [WORLD.location],
          characters: [MAYA, WILLIAMS],
        },
      },
    };
  },

  /** reel_scout first, then each scene's shots from the template. */
  shots: (brief: Brief) => {
    const scenes = (brief.context.scenes as Array<{ number: number }>).map(
      (scene) => scene.number,
    );

    if (brief.part.key === 'reel_scout') {
      return {
        kind: 'reel_scout',
        sceneAnalyses: scenes.map((number) => ({
          sceneNumber: number,
          isReelCandidate: number === 1,
          viralScore: number === 1 ? 8.5 : 3,
          hookType: number === 1 ? 'conflict' : null,
          estimatedDurationSeconds: 30,
          keyMoment: number === 1 ? 'Maya hears her own voice' : null,
          sceneEmotionalArc: 'calm → dread',
          whyThisWorksAsReel: number === 1 ? 'Stands alone.' : null,
          whyItDoesntWork: number === 1 ? null : 'Needs context.',
          improvementSuggestion: null,
        })),
        topReelCandidates: [1],
        orchestratorNote: 'Scene 1 is the reel: open on the console.',
      };
    }

    const sceneNumber = Number(brief.part.key.split(':')[1]);

    return {
      kind: 'scene',
      sceneNumber,
      sceneSummary: `Scene ${sceneNumber} on the deck.`,
      sceneViralScore: sceneNumber === 1 ? 8.5 : 3,
      sceneHookType: sceneNumber === 1 ? 'conflict' : null,
      shots: templateShots(),
    };
  },

  /** An ambience under the scene's first shot and a music bed, per scene. */
  audioCues: (brief: Brief) => {
    const shots = brief.constraints.shots as Array<{
      seq: number;
      duration: number;
    }>;
    const first = shots[0]!;
    const total = shots.reduce((sum, shot) => sum + shot.duration, 0);

    return {
      cues: [
        {
          type: 'ambient',
          prompt: 'Low hum of a space station, air recyclers',
          startShotSequence: first.seq,
          startOffsetInShot: 0,
          durationSeconds: total,
        },
        {
          type: 'music',
          prompt: 'Sparse synth pads, slow, uneasy, 60 BPM',
          startShotSequence: first.seq,
          startOffsetInShot: 1,
          durationSeconds: Math.max(1, total * 0.8),
        },
      ],
    };
  },

  dialogueTranslation: (brief: Brief) => ({
    translations: (
      brief.context.lines as Array<{ sourceDialogueId: string; text: string }>
    ).map((line) => ({
      sourceDialogueId: line.sourceDialogueId,
      text: `ES: ${line.text}`,
    })),
  }),

  assetDescription: () => ({
    description:
      'Commander Maya Chen: mid-forties, close-cropped grey hair, a calm voice.',
  }),

  factExtraction: () => ({
    facts: [
      {
        claim: 'The relay station orbits at 400 km.',
        category: 'technical',
        confidence: 0.9,
        source_context: 'The relay station orbits at 400 km.',
      },
    ],
  }),

  episodeSummary: () => ({
    extraction: {
      immutableEvents: [
        {
          type: 'world_fact',
          eventKey: 'signal-is-maya',
          description: 'The signal carries Maya’s own voice',
          confidence: 'high',
        },
      ],
      characterStateChanges: [],
      threadUpdates: [],
    },
  }),

  seasonAnalysis: () => ({
    premise: 'A relay crew answers signals nobody else can hear.',
    tone: 'contemplative',
    target_audience: 'adults',
    characters: [
      { name: MAYA, role: 'protagonist', description: 'Relay commander.' },
    ],
    locations: [
      {
        name: WORLD.location,
        description: 'A glass-walled deck facing Earth.',
        setting: 'station',
      },
    ],
    episodes: [
      {
        number: 1,
        title: 'The Last Signal',
        synopsis: 'Maya hears her own voice.',
        beats: [{ label: 'The Signal', content: 'A voice from nowhere' }],
        moral: 'Listen.',
        signature_line: null,
        character_names: [MAYA],
        location_names: [WORLD.location],
        tags: ['sci-fi'],
        fact_ids: [],
      },
    ],
  }),

  publishMetadata: () => ({
    translations: [
      {
        id: 'full-video-es',
        targetLanguage: 'es',
        title: 'La última señal',
        description: 'Una astronauta oye su propia voz.',
      },
    ],
  }),

  seasonOutline: (startingNumber: number) => () => ({
    episodes: [
      {
        number: startingNumber,
        title: 'The Relay',
        premise: 'The crew traces the signal to its source.',
        mainPlot:
          'Maya and Williams follow the signal to an abandoned relay where a second voice answers.',
        characterFocus: [MAYA],
        arcPosition: 'rising',
      },
    ],
  }),
};

export interface WorkflowIds {
  projectId: string;
  episodeId: string;
}

/**
 * The five stages a person drives an episode through, ideation → story →
 * screenplay → shots → audio cues (the cues as the external child run the
 * shots commit opens), in external mode.
 */
export async function driveEpisode(call: Call, ids: WorkflowIds) {
  const episode = { episodeId: ids.episodeId };
  const runs: StageRun[] = [];

  runs.push(
    await runStage(
      call,
      { stage: 'ideation', ...episode, options: { numberOfIdeas: 2 } },
      outputs.ideation,
    ),
  );
  runs.push(await runStage(call, { stage: 'story', ...episode }, outputs.story));
  runs.push(
    await runStage(call, { stage: 'screenplay', ...episode }, outputs.screenplay),
  );

  const shots = await runStage(
    call,
    { stage: 'shots', ...episode },
    outputs.shots,
  );
  runs.push(shots);

  const children = shots.finalized.children as Array<{
    runId: string;
    stage: string;
    mode: string;
  }>;
  const audio = children.find((child) => child.stage === 'audio_cues');

  if (!audio) {
    throw new Error(
      `the shots commit opened no audio_cues child: ${JSON.stringify(children)}`,
    );
  }

  runs.push(await driveChild(call, 'audio_cues', audio.runId, outputs.audioCues));

  return { runs, audioChild: audio };
}

/**
 * Every other registered stage on the same episode and project, in the
 * order the spec gives: the single-part stages, the multi-part ones, then
 * season_outline, whose commit creates episodes.
 */
export async function driveRemainingStages(
  call: Call,
  ids: WorkflowIds & {
    /** A character asset of the project, for asset_description */
    assetId: string;
  },
) {
  const episode = { episodeId: ids.episodeId };
  const project = { projectId: ids.projectId };
  const runs: StageRun[] = [];

  runs.push(
    await runStage(
      call,
      {
        stage: 'story_refinement',
        ...episode,
        options: { feedback: 'End on silence.' },
      },
      outputs.storyRefinement,
    ),
  );
  runs.push(
    await runStage(
      call,
      {
        stage: 'screenplay_refinement',
        ...episode,
        options: { feedback: 'Make Maya calmer in scene 1.' },
      },
      outputs.screenplayRefinement,
    ),
  );
  runs.push(
    await runStage(
      call,
      {
        stage: 'asset_description',
        assetId: ids.assetId,
        ...project,
        options: {
          asset: { name: MAYA, type: 'character', role: 'protagonist' },
          storyContext: 'Maya hears her own voice on the relay.',
        },
      },
      outputs.assetDescription,
    ),
  );
  runs.push(
    await runStage(
      call,
      {
        stage: 'episode_summary',
        ...episode,
        options: {
          storyContent: 'Maya hears the signal and answers it herself.',
        },
      },
      outputs.episodeSummary,
    ),
  );
  runs.push(
    await runStage(
      call,
      {
        stage: 'fact_extraction',
        ...project,
        options: {
          content: 'The relay station orbits at 400 km.',
          sourceTitle: 'Relay station handbook',
        },
      },
      outputs.factExtraction,
    ),
  );
  runs.push(
    await runStage(
      call,
      {
        stage: 'publish_metadata',
        ...episode,
        options: {
          items: [
            {
              id: 'full-video-es',
              contentType: 'full-video',
              title: 'The Last Signal',
              description: 'An astronaut hears her own voice.',
              targetLanguage: 'es',
            },
          ],
        },
      },
      outputs.publishMetadata,
    ),
  );
  runs.push(
    await runStage(
      call,
      {
        stage: 'season_analysis',
        ...project,
        options: { roadmap: '* **The Signal:** a voice from nowhere' },
      },
      outputs.seasonAnalysis,
    ),
  );
  runs.push(
    await runStage(
      call,
      {
        stage: 'dialogue_translation',
        ...episode,
        options: { targetLanguage: 'es', preserveTiming: true },
      },
      outputs.dialogueTranslation,
    ),
  );
  runs.push(
    await runStage(
      call,
      {
        stage: 'season_outline',
        ...project,
        options: {
          seasonPremise: 'The crew follows the signal home.',
          episodeCount: 1,
          startingNumber: 9,
        },
      },
      outputs.seasonOutline(9),
    ),
  );

  return runs;
}
