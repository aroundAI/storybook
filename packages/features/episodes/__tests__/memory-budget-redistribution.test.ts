import { describe, expect, it } from 'vitest';

import { redistributeBudgets } from '../src/lib/canon/memory-context-builder';
import type { MemoryBudgets } from '../src/lib/canon/types';

const budgets: MemoryBudgets = {
  immutableEvents: 350,
  characterStates: 250,
  worldStates: 100,
  narrativeThreads: 150,
  episodeSummaries: 150,
  parentContext: 0,
  sourcesCitations: 0,
};

const noNeed = {
  immutableEvents: 0,
  characterStates: 0,
  narrativeThreads: 0,
  episodeSummaries: 0,
  sourcesCitations: 0,
  worldStates: 0,
};

describe('redistributeBudgets (FILM-1004)', () => {
  it('caps a category at its need when none overflows', () => {
    expect(
      redistributeBudgets(budgets, {
        ...noNeed,
        immutableEvents: 350,
        characterStates: 100,
      }),
    ).toMatchObject({ immutableEvents: 350, characterStates: 100 });
  });

  it('gives an overflowing category exactly its overflow from the unused pool', () => {
    const result = redistributeBudgets(budgets, {
      ...noNeed,
      characterStates: 400,
    });

    expect(result.characterStates).toBe(400);
    expect(result.immutableEvents).toBe(0);
  });

  it('caps the grant at the pool and serves overflow in a fixed order', () => {
    // Events need 900 more than their share, characters 900 more.
    const result = redistributeBudgets(budgets, {
      ...noNeed,
      immutableEvents: 1250,
      characterStates: 1150,
      narrativeThreads: 150,
      episodeSummaries: 150,
    });

    // Pool = the world's 100 only; events come first in the order and take it.
    expect(result.immutableEvents).toBe(450);
    expect(result.characterStates).toBe(250);
  });

  it('never grants more than the total allocated', () => {
    const result = redistributeBudgets(budgets, {
      immutableEvents: 5000,
      characterStates: 5000,
      narrativeThreads: 5000,
      episodeSummaries: 0,
      sourcesCitations: 0,
      worldStates: 0,
    });

    const total = (b: MemoryBudgets) =>
      b.immutableEvents +
      b.characterStates +
      b.narrativeThreads +
      b.episodeSummaries +
      b.sourcesCitations +
      b.worldStates;

    expect(total(result)).toBeLessThanOrEqual(total(budgets));
  });

  it('does not give a category with no budget any, nor touch the sequel reserve', () => {
    const result = redistributeBudgets(
      { ...budgets, parentContext: 500 },
      { ...noNeed, sourcesCitations: 300 },
    );

    expect(result.sourcesCitations).toBe(0);
    expect(result.parentContext).toBe(500);
  });

  it('is deterministic', () => {
    const needs = { ...noNeed, characterStates: 900, narrativeThreads: 900 };

    expect(redistributeBudgets(budgets, needs)).toEqual(
      redistributeBudgets(budgets, needs),
    );
  });
});
