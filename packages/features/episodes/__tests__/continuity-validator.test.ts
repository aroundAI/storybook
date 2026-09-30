import { describe, expect, it } from 'vitest';

import {
  getRulesForCheckpoint,
  validatePlotSkeleton,
  validateSceneBlocks,
} from '../src/lib/canon/continuity-validator';
import type {
  CharacterStateContext,
  ImmutableEvent,
  MemoryContext,
  NarrativeThread,
  PlotSkeleton,
  ViolationCode,
} from '../src/lib/canon/types';

function thread(
  name: string,
  lastActiveEpisodeNumber: number | undefined,
): NarrativeThread {
  return {
    id: name,
    projectId: 'p',
    threadName: name,
    threadType: 'mystery',
    status: 'open',
    openedAt: 'e-opened',
    episodesTouched: ['e-opened', 'e-touched'],
    promises: ['who took the key'],
    payoffs: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastActiveEpisodeNumber,
  };
}

function canon007(threads: NarrativeThread[], episodeNumber: number) {
  const context = {
    projectId: 'p',
    episodeNumber,
    immutableEvents: [],
    characterStates: [],
    activeThreads: threads,
    recentSummaries: [],
    sources: [],
  } as unknown as MemoryContext;

  return validatePlotSkeleton(
    { premise: '', episodeNumber, characters: [], scenes: [] },
    context,
  ).violations.filter((v) => v.code === 'CANON_007');
}

describe('CANON_007 thread staleness (KB-72)', () => {
  it('does not call a thread touched in the previous episode stale', () => {
    // Opened in 58, touched in 58 and 59, checked at 60. Before KB-72 this
    // read "untouched for 58 episodes".
    expect(canon007([thread('The missing key', 59)], 60)).toEqual([]);
  });

  it('flags a thread last active five episodes ago, with that count', () => {
    const violations = canon007([thread('The missing key', 55)], 60);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toBe(
      'Thread "The missing key" has 1 unfulfilled promise(s), untouched for 5 episodes.',
    );
  });

  it('does not flag a thread last active four episodes ago', () => {
    expect(canon007([thread('The missing key', 56)], 60)).toEqual([]);
  });

  it('does not flag a thread whose last episode is unknown', () => {
    expect(canon007([thread('The missing key', undefined)], 60)).toEqual([]);
  });
});

const EPOCH = '2026-01-01T00:00:00Z';

function event(
  eventType: ImmutableEvent['eventType'],
  eventKey: string,
  description: string,
): ImmutableEvent {
  return {
    id: `ev-${eventKey}`,
    projectId: 'p',
    eventType,
    eventKey,
    establishedIn: 'e1',
    season: 1,
    episodeNumber: 1,
    description,
    createdAt: EPOCH,
  };
}

function character(
  characterId: string,
  characterName: string,
  overrides: Partial<CharacterStateContext> = {},
): CharacterStateContext {
  return {
    characterId,
    characterName,
    currentStates: [],
    constraints: [],
    ...overrides,
  };
}

function contextOf(overrides: Partial<MemoryContext> = {}): MemoryContext {
  return {
    projectId: 'p',
    episodeNumber: 10,
    immutableEvents: [],
    characterStates: [],
    activeThreads: [],
    recentSummaries: [],
    sources: [],
    metadata: { projectType: 'series' },
    ...overrides,
  } as unknown as MemoryContext;
}

function skeletonOf(overrides: Partial<PlotSkeleton> = {}): PlotSkeleton {
  return {
    premise: '',
    episodeNumber: 10,
    scenes: [],
    characters: [],
    ...overrides,
  };
}

function codes(result: { violations: Array<{ code: ViolationCode }> }) {
  return result.violations.map((v) => v.code);
}

describe('CANON_001 resurrection failure', () => {
  const context = contextOf({
    immutableEvents: [event('death', 'character:mara:dead', 'Mara died in 3')],
  });

  it('flags a dead character present in a scene', () => {
    const result = validatePlotSkeleton(
      skeletonOf({
        characters: [{ characterId: 'c1', name: 'Mara', role: 'lead' }],
        scenes: [
          { sceneNumber: 2, summary: 'x', charactersPresent: ['c1'] },
        ],
      }),
      context,
    );

    const violation = result.violations.find((v) => v.code === 'CANON_001');
    expect(violation?.severity).toBe('error');
    expect(violation?.location?.sceneNumber).toBe(2);
    expect(violation?.relatedEvents).toEqual(['ev-character:mara:dead']);
    expect(result.valid).toBe(false);
  });

  it('ignores a present character with no name in the skeleton', () => {
    const result = validatePlotSkeleton(
      skeletonOf({
        scenes: [{ sceneNumber: 1, summary: 'x', charactersPresent: ['c1'] }],
      }),
      context,
    );

    expect(codes(result)).not.toContain('CANON_001');
  });

  it('is quiet when nobody has died', () => {
    const result = validatePlotSkeleton(
      skeletonOf({
        characters: [{ characterId: 'c1', name: 'Mara', role: 'lead' }],
        scenes: [{ sceneNumber: 1, summary: 'x', charactersPresent: ['c1'] }],
      }),
      contextOf(),
    );

    expect(codes(result)).not.toContain('CANON_001');
  });
});

describe('CANON_002 state reversal', () => {
  const context = contextOf({
    characterStates: [
      character('c1', 'Mara', {
        constraints: ['cannot be trusting'],
        currentStates: [
          {
            id: 's1',
            characterId: 'c1',
            episodeId: 'e1',
            stateType: 'emotional',
            stateValue: { state: 'betrayed' },
            triggerEvent: 't',
            createdAt: EPOCH,
          },
        ],
      }),
    ],
  });

  it('flags an arc that returns to a constrained state', () => {
    const result = validatePlotSkeleton(
      skeletonOf({
        characters: [
          {
            characterId: 'c1',
            name: 'Mara',
            role: 'lead',
            emotionalArc: 'Mara is trusting again',
          },
        ],
      }),
      context,
    );

    const violation = result.violations.find((v) => v.code === 'CANON_002');
    expect(violation?.message).toContain('Current state: "betrayed"');
  });

  it('accepts an arc that does not touch the constraint', () => {
    const result = validatePlotSkeleton(
      skeletonOf({
        characters: [
          {
            characterId: 'c1',
            name: 'Mara',
            role: 'lead',
            emotionalArc: 'Mara grows wary',
          },
        ],
      }),
      context,
    );

    expect(codes(result)).not.toContain('CANON_002');
  });
});

describe('CANON_003 knowledge violation', () => {
  const scene = {
    sceneNumber: 4,
    summary: 'x',
    charactersPresent: ['c1'],
    keyEvents: ['Mara reveals the vault code'],
  };
  const characters = [{ characterId: 'c1', name: 'Mara', role: 'lead' }];

  it('flags a reveal by a character with no established knowledge', () => {
    const result = validatePlotSkeleton(
      skeletonOf({ scenes: [scene], characters }),
      contextOf({ characterStates: [character('c1', 'Mara')] }),
    );

    expect(codes(result)).toContain('CANON_003');
  });

  it('accepts a reveal by a character who knows something', () => {
    const result = validatePlotSkeleton(
      skeletonOf({ scenes: [scene], characters }),
      contextOf({
        characterStates: [
          character('c1', 'Mara', {
            currentStates: [
              {
                id: 's1',
                characterId: 'c1',
                episodeId: 'e1',
                stateType: 'knowledge',
                stateValue: { fact: 'The vault code' },
                triggerEvent: 't',
                createdAt: EPOCH,
              },
            ],
          }),
        ],
      }),
    );

    expect(codes(result)).not.toContain('CANON_003');
  });
});

describe('CANON_004 authorization missing', () => {
  it('flags a major arc change with no authorization triplet', () => {
    const result = validatePlotSkeleton(
      skeletonOf({
        characters: [
          {
            characterId: 'c1',
            name: 'Mara',
            role: 'lead',
            emotionalArc: 'Mara becomes ruthless',
          },
        ],
      }),
      contextOf(),
    );

    expect(codes(result)).toContain('CANON_004');
  });

  it('accepts a steady arc', () => {
    const result = validatePlotSkeleton(
      skeletonOf({
        characters: [
          {
            characterId: 'c1',
            name: 'Mara',
            role: 'lead',
            emotionalArc: 'Mara stays calm',
          },
        ],
      }),
      contextOf(),
    );

    expect(codes(result)).not.toContain('CANON_004');
  });
});

describe('CANON_005 world contradiction', () => {
  it('flags magic in a world with no magic', () => {
    const result = validatePlotSkeleton(
      skeletonOf({
        scenes: [{ sceneNumber: 1, summary: 'She uses magic', charactersPresent: [] }],
      }),
      contextOf({
        immutableEvents: [event('world_fact', 'world:no_magic', 'No magic')],
      }),
    );

    expect(codes(result)).toContain('CANON_005');
  });

  it('flags a scene set in a destroyed location', () => {
    const result = validatePlotSkeleton(
      skeletonOf({
        scenes: [{ sceneNumber: 3, summary: 'They meet at the harbor', charactersPresent: [] }],
      }),
      contextOf({
        immutableEvents: [
          event('world_fact', 'world:harbor_destroyed', 'The harbor burned'),
        ],
      }),
    );

    const violation = result.violations.find((v) => v.code === 'CANON_005');
    expect(violation?.message).toContain('destroyed');
  });

  it('is quiet with no world facts', () => {
    const result = validatePlotSkeleton(
      skeletonOf({
        scenes: [{ sceneNumber: 1, summary: 'She uses magic', charactersPresent: [] }],
      }),
      contextOf(),
    );

    expect(codes(result)).not.toContain('CANON_005');
  });
});

describe('CANON_006 reference violation', () => {
  it('flags a character canon has never seen', () => {
    const result = validatePlotSkeleton(
      skeletonOf({
        characters: [{ characterId: 'x9', name: 'Stranger', role: 'extra' }],
        scenes: [{ sceneNumber: 1, summary: 'x', charactersPresent: ['x9'] }],
      }),
      contextOf({ characterStates: [character('c1', 'Mara')] }),
    );

    const violation = result.violations.find((v) => v.code === 'CANON_006');
    expect(violation?.message).toContain('Stranger');
  });

  it('knows a character through an immutable event', () => {
    const known = event('death', 'character:x9:dead', 'x');
    known.metadata = { character_id: 'x9' };

    const result = validatePlotSkeleton(
      skeletonOf({
        scenes: [{ sceneNumber: 1, summary: 'x', charactersPresent: ['x9'] }],
      }),
      contextOf({ immutableEvents: [known] }),
    );

    expect(codes(result)).not.toContain('CANON_006');
  });
});

describe('CANON_008 escalation overflow', () => {
  const grim = { plotSummary: 'A massacre' } as MemoryContext['recentSummaries'][number];
  const calm = { plotSummary: 'A picnic' } as MemoryContext['recentSummaries'][number];
  const highStakes = skeletonOf({
    scenes: [
      { sceneNumber: 1, summary: 'war breaks out', charactersPresent: [] },
      { sceneNumber: 2, summary: 'a betrayal', charactersPresent: [] },
    ],
  });

  it('flags a high-stakes episode after four high-stakes ones', () => {
    const result = validatePlotSkeleton(
      highStakes,
      contextOf({ recentSummaries: [grim, grim, grim, grim] }),
    );

    expect(codes(result)).toContain('CANON_008');
  });

  it('accepts it after calm episodes', () => {
    const result = validatePlotSkeleton(
      highStakes,
      contextOf({ recentSummaries: [calm, calm, calm, calm] }),
    );

    expect(codes(result)).not.toContain('CANON_008');
  });
});

describe('CANON_009 tone drift', () => {
  function summaries(scores: Array<number | undefined>) {
    return scores.map(
      (sentimentScore) =>
        ({ plotSummary: 'x', sentimentScore }) as MemoryContext['recentSummaries'][number],
    );
  }
  const joyful = skeletonOf({
    scenes: [
      { sceneNumber: 1, summary: 'hope and joy and love', charactersPresent: [] },
    ],
  });

  it('flags a joyful episode after a run of grim ones', () => {
    const result = validatePlotSkeleton(
      joyful,
      contextOf({ recentSummaries: summaries([0.1, 0.1, 0.1]) }),
    );

    expect(codes(result)).toContain('CANON_009');
  });

  it('needs three scored episodes to judge', () => {
    const result = validatePlotSkeleton(
      joyful,
      contextOf({ recentSummaries: summaries([0.1, 0.1, undefined]) }),
    );

    expect(codes(result)).not.toContain('CANON_009');
  });

  it('accepts a matching tone', () => {
    const result = validatePlotSkeleton(
      joyful,
      contextOf({ recentSummaries: summaries([0.7, 0.75, 0.7]) }),
    );

    expect(codes(result)).not.toContain('CANON_009');
  });
});

describe('CANON_011 causality break', () => {
  const scenes = (dependsOnScenes: number[]) => [
    { sceneNumber: 1, summary: 'a', charactersPresent: [] },
    { sceneNumber: 2, summary: 'b', charactersPresent: [], dependsOnScenes },
    { sceneNumber: 3, summary: 'c', charactersPresent: [] },
  ];

  it('flags a scene that builds on a later scene', () => {
    const result = validatePlotSkeleton(
      skeletonOf({ scenes: scenes([3]) }),
      contextOf(),
    );

    const violation = result.violations.find((v) => v.code === 'CANON_011');
    expect(violation?.severity).toBe('error');
    expect(violation?.message).toBe(
      'Scene 2 builds on the outcome of scene 3, which does not happen before it.',
    );
    expect(result.valid).toBe(false);
  });

  it('flags a scene that depends on itself', () => {
    const result = validatePlotSkeleton(
      skeletonOf({ scenes: scenes([2]) }),
      contextOf(),
    );

    expect(codes(result)).toContain('CANON_011');
  });

  it('accepts a dependency on an earlier scene', () => {
    const result = validatePlotSkeleton(
      skeletonOf({ scenes: scenes([1]) }),
      contextOf(),
    );

    expect(codes(result)).not.toContain('CANON_011');
  });

  it('does not judge a dependency on a scene the episode does not have', () => {
    const result = validatePlotSkeleton(
      skeletonOf({ scenes: scenes([9]) }),
      contextOf(),
    );

    expect(codes(result)).not.toContain('CANON_011');
  });
});

describe('CANON_012 standalone episode', () => {
  const canon = contextOf({
    characterStates: [character('c1', 'Mara'), character('c2', 'Ilya')],
    activeThreads: [thread('The missing key', 9), thread('The tide', 9)],
  });
  const standalone = skeletonOf({
    scenes: [{ sceneNumber: 1, summary: 'A new stranger arrives', charactersPresent: [] }],
  });

  it('flags a series episode that touches none of four canon items', () => {
    const result = validatePlotSkeleton(standalone, canon);

    const violation = result.violations.find((v) => v.code === 'CANON_012');
    expect(violation?.severity).toBe('info');
    expect(violation?.message).toContain('0 callback(s) to 4 established canon item(s)');
  });

  it('accepts an episode that calls back to a thread and a character', () => {
    const result = validatePlotSkeleton(
      skeletonOf({
        characters: [{ characterId: 'c1', name: 'Mara', role: 'lead' }],
        scenes: [
          { sceneNumber: 1, summary: 'The missing key resurfaces', charactersPresent: ['c1'] },
        ],
      }),
      canon,
    );

    expect(codes(result)).not.toContain('CANON_012');
  });

  it('counts a location and an immutable event as callbacks', () => {
    const result = validatePlotSkeleton(
      skeletonOf({
        scenes: [
          {
            sceneNumber: 1,
            summary: 'At the lighthouse, the pact is remembered',
            charactersPresent: [],
          },
        ],
      }),
      contextOf({
        worldState: { location: 'Lighthouse' } as MemoryContext['worldState'],
        immutableEvents: [event('timeline', 'pact', 'x')],
      }),
    );

    expect(codes(result)).not.toContain('CANON_012');
  });

  it('skips the check while there is no canon', () => {
    const result = validatePlotSkeleton(standalone, contextOf());

    expect(codes(result)).not.toContain('CANON_012');
  });

  it('holds a documentary to a 5% threshold and news to none', () => {
    const documentary = contextOf({
      ...canon,
      metadata: { projectType: 'documentary' } as MemoryContext['metadata'],
    });
    const news = contextOf({
      ...canon,
      metadata: { projectType: 'news' } as MemoryContext['metadata'],
    });

    expect(codes(validatePlotSkeleton(standalone, documentary))).toContain('CANON_012');
    expect(codes(validatePlotSkeleton(standalone, news))).not.toContain('CANON_012');
  });

  it('applies to screenplay scene blocks by their text', () => {
    const result = validateSceneBlocks(
      [{ sceneNumber: 1, content: 'A new stranger arrives' }],
      canon,
    );

    expect(codes(result)).toContain('CANON_012');
  });
});

describe('validateSceneBlocks and rule registry', () => {
  it('runs the screenplay subset: resurrection, world, tone and connectivity', () => {
    const result = validateSceneBlocks(
      [{ sceneNumber: 1, content: 'She uses magic' }],
      contextOf({
        immutableEvents: [event('world_fact', 'world:no_magic', 'No magic')],
      }),
    );

    expect(codes(result)).toEqual(['CANON_005', 'CANON_012']);
    expect(result.valid).toBe(false);
    expect(result.passedRules).not.toContain('CANON_005');
    expect(result.passedRules).not.toContain('CANON_008');
    expect(result.summary).toEqual({ errors: 1, warnings: 0, infos: 1 });
  });

  it('lists the rules of a checkpoint', () => {
    const story = getRulesForCheckpoint('STORY').map((r) => r.code);
    const publish = getRulesForCheckpoint('PUBLISH').map((r) => r.code);

    expect(story).toContain('CANON_011');
    expect(story).not.toContain('CANON_007');
    expect(publish).toEqual(['CANON_004', 'CANON_007']);
  });
});
