import { describe, expect, it } from 'vitest';

import type { ParentContext } from '../src/lib/canon/sequel-system';
import { formatParentContextsForPrompt } from '../src/lib/canon/sequel-system';

// =============================================================================
// TEST DATA
// =============================================================================

function makeParentContext(
  overrides: Partial<ParentContext> = {},
): ParentContext {
  return {
    parentProjectId: 'parent-1',
    parentProjectName: 'The First Movie',
    parentSummary: 'A detective investigates a series of mysterious events.',
    immutableEvents: [
      {
        eventKey: 'character:villain:dead',
        eventType: 'death',
        description: 'The villain was defeated in the final battle.',
      },
    ],
    finalCharacterStates: [
      {
        characterId: 'char-1',
        characterName: 'Detective Ana',
        isAlive: true,
        finalEmotionalState: 'determined',
        finalLocation: 'City Police Station',
        knownFacts: ['The conspiracy exists'],
      },
      {
        characterId: 'char-2',
        characterName: 'Villain Marcus',
        isAlive: false,
        finalEmotionalState: 'n/a',
        finalLocation: 'Warehouse',
        knownFacts: [],
      },
    ],
    resolvedThreads: [
      {
        threadName: 'The Missing Files',
        resolution: 'Files were recovered from the warehouse.',
      },
    ],
    worldFacts: [
      {
        factKey: 'world:magic:false',
        description: 'Magic does not exist in this world.',
      },
    ],
    characterVisualRegistry: {
      'char-1': {
        characterName: 'Detective Ana',
        visualDescription:
          'Mid-30s Latina woman, short black hair, wearing a leather jacket',
        assetId: 'asset-1',
      },
    },
    locationRegistry: [
      {
        locationName: 'City Police Station',
        visualDescription: 'Brutalist architecture, fluorescent lighting',
      },
    ],
    ...overrides,
  };
}

// =============================================================================
// formatParentContextsForPrompt
// =============================================================================

describe('formatParentContextsForPrompt', () => {
  it('should return empty string for no contexts', () => {
    const result = formatParentContextsForPrompt([]);
    expect(result).toBe('');
  });

  it('should include parent movie title', () => {
    const ctx = makeParentContext();
    const result = formatParentContextsForPrompt([ctx]);

    expect(result).toContain('INHERITED CANON FROM PARENT MOVIE(S)');
    expect(result).toContain('FROM: "The First Movie"');
  });

  it('should include parent summary', () => {
    const ctx = makeParentContext();
    const result = formatParentContextsForPrompt([ctx]);

    expect(result).toContain('### Summary');
    expect(result).toContain(
      'A detective investigates a series of mysterious events.',
    );
  });

  it('should list deceased characters', () => {
    const ctx = makeParentContext();
    const result = formatParentContextsForPrompt([ctx]);

    expect(result).toContain('DECEASED CHARACTERS (MUST NOT APPEAR AS ALIVE)');
    expect(result).toContain('Villain Marcus - DEAD');
  });

  it('should list returning alive characters', () => {
    const ctx = makeParentContext();
    const result = formatParentContextsForPrompt([ctx]);

    expect(result).toContain('RETURNING CHARACTERS (Available for sequel)');
    expect(result).toContain(
      'Detective Ana: determined (last seen at City Police Station)',
    );
  });

  it('should list established world rules', () => {
    const ctx = makeParentContext();
    const result = formatParentContextsForPrompt([ctx]);

    expect(result).toContain('ESTABLISHED WORLD RULES');
    expect(result).toContain('Magic does not exist in this world.');
  });

  it('should list resolved threads', () => {
    const ctx = makeParentContext();
    const result = formatParentContextsForPrompt([ctx]);

    expect(result).toContain('RESOLVED THREADS (DO NOT REOPEN)');
    expect(result).toContain(
      'The Missing Files: Files were recovered from the warehouse.',
    );
  });

  it('should handle multiple parents (crossover)', () => {
    const ctx1 = makeParentContext({ parentProjectName: 'Movie Alpha' });
    const ctx2 = makeParentContext({
      parentProjectId: 'parent-2',
      parentProjectName: 'Movie Beta',
      finalCharacterStates: [
        {
          characterId: 'char-3',
          characterName: 'Agent Nova',
          isAlive: true,
          finalEmotionalState: 'stoic',
          finalLocation: 'Rooftop',
          knownFacts: [],
        },
      ],
      resolvedThreads: [],
      worldFacts: [],
    });

    const result = formatParentContextsForPrompt([ctx1, ctx2]);

    expect(result).toContain('FROM: "Movie Alpha"');
    expect(result).toContain('FROM: "Movie Beta"');
    expect(result).toContain('Detective Ana');
    expect(result).toContain('Agent Nova');
  });

  it('should skip sections when empty', () => {
    const ctx = makeParentContext({
      finalCharacterStates: [],
      resolvedThreads: [],
      worldFacts: [],
    });
    const result = formatParentContextsForPrompt([ctx]);

    expect(result).not.toContain('DECEASED CHARACTERS');
    expect(result).not.toContain('RETURNING CHARACTERS');
    expect(result).not.toContain('ESTABLISHED WORLD RULES');
    expect(result).not.toContain('RESOLVED THREADS');
  });

  it('should handle only deceased characters (no alive)', () => {
    const ctx = makeParentContext({
      finalCharacterStates: [
        {
          characterId: 'char-1',
          characterName: 'Fallen Hero',
          isAlive: false,
          finalEmotionalState: 'n/a',
          finalLocation: 'unknown',
          knownFacts: [],
        },
      ],
    });
    const result = formatParentContextsForPrompt([ctx]);

    expect(result).toContain('Fallen Hero - DEAD');
    expect(result).not.toContain('RETURNING CHARACTERS');
  });

  it('should show fallback header when no parent name', () => {
    const ctx = makeParentContext({ parentProjectName: '' });
    const result = formatParentContextsForPrompt([ctx]);

    expect(result).toContain('FROM PARENT MOVIE');
  });
});
