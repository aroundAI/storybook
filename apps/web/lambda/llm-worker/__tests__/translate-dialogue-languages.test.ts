import { describe, expect, it, vi } from 'vitest';

import { processTranslateDialogue } from '../handlers/translate-dialogue';

/**
 * FILM-2007: one translate-dialogue run translates every language a
 * localization needs, in turn (one translation run per episode may be
 * open). A language that fails does not stop the others; the run fails
 * only when every language did. The stage itself is the parity tests'.
 */
const payload = {
  accountId: '11111111-1111-4111-8111-111111111111',
  episodeId: '33333333-3333-4333-8333-333333333333',
  userId: '44444444-4444-4444-8444-444444444444',
  targetLanguage: 'hi',
  preserveTiming: true,
};

const ok = (count: number) => ({
  success: true,
  data: { translatedCount: count },
});

describe('translate-dialogue over several languages (FILM-2007)', () => {
  it('translates the target language, then each additional one, once each', async () => {
    const translate = vi.fn(
      async (_db: unknown, _data: unknown, language: string) =>
        ok(language === 'hi' ? 4 : 3),
    );

    const result = await processTranslateDialogue(
      { ...payload, additionalLanguages: ['es', 'hi', 'ja'] },
      {} as never,
      { translate },
    );

    expect(translate.mock.calls.map((call) => call[2])).toEqual([
      'hi',
      'es',
      'ja',
    ]);
    expect(result).toEqual({
      success: true,
      data: { translatedCount: 10, languages: ['hi', 'es', 'ja'] },
    });
  });

  it('goes on past a failed language, and fails only when all do', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const partly = await processTranslateDialogue(
      { ...payload, additionalLanguages: ['es'] },
      {} as never,
      {
        translate: async (_db, _data, language) => {
          if (language === 'hi') throw new Error('mostly untranslated');
          return ok(3);
        },
      },
    );

    expect(partly.data).toMatchObject({
      translatedCount: 3,
      languages: ['es'],
      failures: [{ language: 'hi', error: 'mostly untranslated' }],
    });

    await expect(
      processTranslateDialogue(
        { ...payload, additionalLanguages: ['es'] },
        {} as never,
        {
          translate: async () => {
            throw new Error('model down');
          },
        },
      ),
    ).rejects.toThrow(/every language/);
  });

  it('runs one language as it always did when there are no others', async () => {
    const translate = vi.fn(async () => ok(2));

    await processTranslateDialogue(payload, {} as never, { translate });

    expect(translate).toHaveBeenCalledTimes(1);
  });
});
