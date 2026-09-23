import { describe, expect, it } from 'vitest';

import { ActionRefusal } from '@kit/next/action-result';

import { throwIfWriteRefused } from '../src/server/write-refusal';

describe('throwIfWriteRefused (KB-40)', () => {
  it('turns the database write refusal (42501) into a refusal the page shows as written', () => {
    const call = () =>
      throwIfWriteRefused(
        { code: '42501', message: "No write access to this episode's timeline" },
        'assemble its timeline',
      );

    expect(call).toThrow(ActionRefusal);
    expect(call).toThrow(
      "Only the project's owner, admins and members can assemble its timeline.",
    );
  });

  it('leaves every other error to the caller', () => {
    expect(() =>
      throwIfWriteRefused({ code: 'PGRST202' }, 'assemble its timeline'),
    ).not.toThrow();
    expect(() =>
      throwIfWriteRefused({ code: '22P02' }, 'assemble its timeline'),
    ).not.toThrow();
  });

  it('does nothing when there is no error', () => {
    expect(() => throwIfWriteRefused(null, 'assemble its timeline')).not.toThrow();
    expect(() =>
      throwIfWriteRefused(undefined, 'assemble its timeline'),
    ).not.toThrow();
  });
});
