import { describe, expect, it } from 'vitest';

import {
  type ContinuityContextInput,
  type ContinuitySceneInput,
  MAX_EVENTS,
  buildContinuityView,
} from '../continuity-view';

const scene: ContinuitySceneInput = {
  heading: 'INT. LIGHTHOUSE - NIGHT',
  description: 'Mara studies the map by lamplight, recalling the pact.',
  dialogue: [{ character: 'MARA', text: 'The key was here.' }],
};

function event(
  id: string,
  eventType: string,
  eventKey: string,
  description: string,
) {
  return { id, eventType, eventKey, description, episodeNumber: 1 };
}

const context: ContinuityContextInput = {
  immutableEvents: [
    event('e1', 'world_fact', 'world:no_magic', 'Magic does not exist'),
    event('e2', 'death', 'character:ilya:dead', 'Ilya died in the flood'),
    event('e3', 'timeline', 'timeline:pact', 'The pact was sworn at the lighthouse'),
  ],
  activeThreads: [
    { id: 't1', threadName: 'The tide', status: 'open' },
    { id: 't2', threadName: 'The missing key', status: 'progressed' },
    { id: 't3', threadName: 'Old debt', status: 'resolved' },
  ],
  characterStates: [
    {
      characterId: 'c1',
      characterName: 'Ilya',
      constraints: [],
      currentStates: [],
    },
    {
      characterId: 'c2',
      characterName: 'Mara',
      constraints: ['cannot be trusting'],
      currentStates: [
        { stateType: 'emotional', stateValue: { state: 'betrayed' } },
      ],
    },
  ],
};

describe('buildContinuityView', () => {
  it('puts events the scene names first, then deaths', () => {
    const view = buildContinuityView(context, scene);

    expect(view.mustNotContradict.map((e) => e.id)).toEqual(['e3', 'e2', 'e1']);
    expect(view.mustNotContradict[1]).toMatchObject({
      label: 'death',
      description: 'Ilya died in the flood',
    });
  });

  it('caps the events it lists', () => {
    const many = {
      ...context,
      immutableEvents: Array.from({ length: 20 }, (_, i) =>
        event(`e${i}`, 'timeline', `timeline:${i}`, `Event ${i}`),
      ),
    };

    expect(buildContinuityView(many, scene).mustNotContradict).toHaveLength(
      MAX_EVENTS,
    );
  });

  it('lists only open and progressed threads, the ones the scene names first', () => {
    const named = { ...scene, description: 'Mara chases the missing key.' };

    expect(buildContinuityView(context, named).openThreads).toEqual([
      { id: 't2', name: 'The missing key', status: 'progressed' },
      { id: 't1', name: 'The tide', status: 'open' },
    ]);
  });

  it('shows the characters in the scene with their state and constraints', () => {
    expect(buildContinuityView(context, scene).characters).toEqual([
      {
        id: 'c2',
        name: 'Mara',
        state: 'emotional: betrayed',
        constraints: ['cannot be trusting'],
      },
    ]);
  });

  it('falls back to the characters canon holds when the scene names none of them', () => {
    const empty = { ...scene, description: 'Rain.', dialogue: [] };

    expect(
      buildContinuityView(context, empty).characters.map((c) => c.name),
    ).toEqual(['Ilya', 'Mara']);
  });

  it('labels a state that has no readable value by its type', () => {
    const view = buildContinuityView(
      {
        ...context,
        characterStates: [
          {
            characterId: 'c3',
            characterName: 'Mara',
            constraints: [],
            currentStates: [{ stateType: 'physical', stateValue: { hurt: true } }],
          },
        ],
      },
      scene,
    );

    expect(view.characters[0]!.state).toBe('physical');
  });

  it('orders violations with errors first', () => {
    const view = buildContinuityView(context, scene, [
      { code: 'CANON_009', severity: 'info', message: 'i', suggestion: '' },
      { code: 'CANON_001', severity: 'error', message: 'e', suggestion: '' },
      { code: 'CANON_005', severity: 'warning', message: 'w', suggestion: '' },
    ]);

    expect(view.violations.map((v) => v.code)).toEqual([
      'CANON_001',
      'CANON_005',
      'CANON_009',
    ]);
  });

  it('is empty only when there is nothing at all to show', () => {
    expect(
      buildContinuityView(
        { immutableEvents: [], activeThreads: [], characterStates: [] },
        scene,
      ).isEmpty,
    ).toBe(true);
    expect(buildContinuityView(context, scene).isEmpty).toBe(false);
  });
});
