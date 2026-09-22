import { describe, expect, it, vi } from 'vitest';

import {
  ActionRefusal,
  refusalMessage,
  unwrap,
} from '../src/refusals/action-result';
import { returnRefusals } from '../src/refusals/with-refusals';

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ error: vi.fn() }),
}));

/** What a production build puts in an error thrown from a server action. */
const PRODUCTION_SENTENCE =
  'An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.';

describe('returnRefusals', () => {
  it('returns a refusal with its own wording', async () => {
    const action = returnRefusals(async () => {
      throw new ActionRefusal('Episode not found');
    });

    expect(await action({})).toEqual({
      ok: false,
      error: 'Episode not found',
    });
  });

  it('returns what succeeded under data', async () => {
    const action = returnRefusals(async (input: { id: string }) => ({
      success: true,
      id: input.id,
    }));

    expect(await action({ id: 'e1' })).toEqual({
      ok: true,
      data: { success: true, id: 'e1' },
    });
  });

  it('leaves an unexpected failure thrown, as the same error', async () => {
    const crash = new Error('relation "secret_table" does not exist');

    const action = returnRefusals(async () => {
      throw crash;
    });

    await expect(action({})).rejects.toBe(crash);
  });

  it("leaves Next's redirect thrown", async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/auth/sign-in;307;',
    });

    const action = returnRefusals(async () => {
      throw redirect;
    });

    await expect(action({})).rejects.toBe(redirect);
  });
});

describe('unwrap and refusalMessage', () => {
  it('shows a returned refusal as written', async () => {
    const shown = await unwrap({ ok: false, error: 'Episode not found' }).catch(
      (error: unknown) => refusalMessage(error, 'Failed to delete episode'),
    );

    expect(shown).toBe('Episode not found');
  });

  it("shows the fallback, not the production build's sentence, for a thrown error", () => {
    expect(
      refusalMessage(
        new Error(PRODUCTION_SENTENCE),
        'Failed to delete episode',
      ),
    ).toBe('Failed to delete episode');
  });

  it('shows the fallback for a thrown database detail', () => {
    expect(
      refusalMessage(
        new Error('duplicate key value violates unique constraint "x_key"'),
        'Failed to create project',
      ),
    ).toBe('Failed to create project');
  });

  it('passes the data of a success through', async () => {
    expect(await unwrap({ ok: true, data: 7 })).toBe(7);
  });
});
