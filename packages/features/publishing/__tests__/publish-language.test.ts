import { describe, expect, it } from 'vitest';

import { PlatformConfigSchema } from '../src/lib/schemas/publish.schema';

const REQUEST = {
  platform: 'youtube',
  connectionId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  title: 'A video',
};

describe('the language a publish request carries (FILM-1702)', () => {
  it('leaves an omitted language absent instead of stamping English on it', () => {
    // `.default('en')` here ran before the server action's own fallback to
    // the channel's target language, so that fallback never fired and every
    // request without a language was recorded as English.
    const parsed = PlatformConfigSchema.parse(REQUEST);

    expect(parsed.language).toBeUndefined();
  });

  it('keeps a language the request names, English included', () => {
    expect(
      PlatformConfigSchema.parse({ ...REQUEST, language: 'en' }).language,
    ).toBe('en');
    expect(
      PlatformConfigSchema.parse({ ...REQUEST, language: 'pt-BR' }).language,
    ).toBe('pt-BR');
  });

  it('refuses a blank or one-character language, as the column does', () => {
    expect(() =>
      PlatformConfigSchema.parse({ ...REQUEST, language: '' }),
    ).toThrow();
    expect(() =>
      PlatformConfigSchema.parse({ ...REQUEST, language: 'e' }),
    ).toThrow();
  });
});
