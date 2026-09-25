import { describe, expect, it } from 'vitest';

import { findThrownRefusals } from './thrown-refusals';

/**
 * KB-6, the server half: what `findThrownRefusals` flags and what it leaves
 * alone. The repository-wide check is in kb6-caught-action-message.test.ts.
 */
const scan = (files: Record<string, string>) =>
  findThrownRefusals(
    Object.entries(files).map(([path, source]) => ({ path, source })),
  ).map(({ action }) => action);

describe('findThrownRefusals', () => {
  it('flags an exported action that throws a refusal', () => {
    expect(
      scan({
        'a.ts': `
          export const deleteThingAction = enhanceAction(async () => {
            throw new ActionRefusal('Project not found');
          }, {});
        `,
      }),
    ).toEqual(['deleteThingAction']);
  });

  it('flags a refusal thrown through a local refuse() helper', () => {
    expect(
      scan({
        'a.ts': `
          export const saveAction = enhanceAction(async () => {
            const refuse = (text: string): never => { throw new ActionRefusal(text); };
            refuse('No');
          }, {});
        `,
      }),
    ).toEqual(['saveAction']);
  });

  it('flags a refusal thrown by a helper in another file', () => {
    expect(
      scan({
        'helper.ts': `
          export function assertTransition() { throw new ActionRefusal('Too late'); }
        `,
        'a.ts': `
          export const startAction = enhanceAction(async () => {
            assertTransition();
          }, {});
        `,
      }),
    ).toEqual(['startAction']);
  });

  it('flags an action exported through export { … }', () => {
    expect(
      scan({
        'a.ts': `
          const removeAction = enhanceAction(async () => {
            throw new ActionRefusal('No');
          }, {});
          export { removeAction };
        `,
      }),
    ).toEqual(['removeAction']);
  });

  it('flags a throwing action exported under an alias, skipping the wrapper', () => {
    expect(
      scan({
        'a.ts': `
          const deleteThing = enhanceAction(async () => {
            throw new ActionRefusal('Project not found');
          }, {});
          export const deleteThingAction = deleteThing;
        `,
      }),
    ).toEqual(['deleteThingAction']);
  });

  it('leaves an action returned through returnRefusals alone', () => {
    expect(
      scan({
        'a.ts': `
          const deleteThing = enhanceAction(async () => {
            throw new ActionRefusal('Project not found');
          }, {});
          export const deleteThingAction = returnRefusals(deleteThing);
        `,
      }),
    ).toEqual([]);
  });

  it('leaves an action that calls a wrapped action alone: that returns', () => {
    expect(
      scan({
        'a.ts': `
          const inner = enhanceAction(async () => { throw new ActionRefusal('x'); }, {});
          export const innerAction = returnRefusals(inner);
          export const outerAction = enhanceAction(async () => {
            return await innerAction({});
          }, {});
        `,
      }),
    ).toEqual([]);
  });

  it('flags an action that unwraps a returned refusal: unwrap rethrows it', () => {
    expect(
      scan({
        'a.ts': `
          export const outerAction = enhanceAction(async () => {
            await unwrap(innerAction({}));
          }, {});
        `,
      }),
    ).toEqual(['outerAction']);
  });

  it('leaves an action whose only throws are ordinary errors alone', () => {
    expect(
      scan({
        'a.ts': `
          export const readAction = enhanceAction(async () => {
            throw new Error('Failed to read');
          }, {});
        `,
      }),
    ).toEqual([]);
  });
});
