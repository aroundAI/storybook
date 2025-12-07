import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the @kit/i18n module
const mockCreateI18nSettings = vi.fn();

vi.mock('@kit/i18n', () => ({
  createI18nSettings: mockCreateI18nSettings,
}));

describe('i18n.settings', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    mockCreateI18nSettings.mockReturnValue({
      language: 'en',
      namespaces: ['common'],
      languages: ['en'],
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // Import after mocking to get fresh module each time
  async function importSettings() {
    // Clear module cache to get fresh imports
    vi.resetModules();

    return await import('../i18n.settings');
  }

  describe('configuration constants', () => {
    it('should export default language as en', async () => {
      const { languages } = await importSettings();

      expect(languages).toContain('en');
    });

    it('should export I18N_COOKIE_NAME as lang', async () => {
      const { I18N_COOKIE_NAME } = await importSettings();

      expect(I18N_COOKIE_NAME).toBe('lang');
    });

    it('should export defaultI18nNamespaces array', async () => {
      const { defaultI18nNamespaces } = await importSettings();

      expect(Array.isArray(defaultI18nNamespaces)).toBe(true);
      expect(defaultI18nNamespaces.length).toBeGreaterThan(0);
    });

    it('should include common namespaces', async () => {
      const { defaultI18nNamespaces } = await importSettings();

      expect(defaultI18nNamespaces).toContain('common');
      expect(defaultI18nNamespaces).toContain('auth');
      expect(defaultI18nNamespaces).toContain('account');
    });

    it('should use environment variable for default language', async () => {
      process.env.NEXT_PUBLIC_DEFAULT_LOCALE = 'fr';

      const { languages } = await importSettings();

      expect(languages).toContain('fr');
    });

    it('should fallback to en when no environment variable', async () => {
      delete process.env.NEXT_PUBLIC_DEFAULT_LOCALE;

      const { languages } = await importSettings();

      expect(languages).toContain('en');
    });
  });

  describe('getI18nSettings', () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    describe('language selection', () => {
      it('should use provided language when supported', async () => {
        const { getI18nSettings } = await importSettings();

        getI18nSettings('en');

        expect(mockCreateI18nSettings).toHaveBeenCalledWith({
          language: 'en',
          namespaces: expect.any(Array),
          languages: expect.any(Array),
        });
      });

      it('should fallback to default language when language is undefined', async () => {
        const { getI18nSettings } = await importSettings();

        getI18nSettings(undefined);

        expect(mockCreateI18nSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            language: 'en',
          }),
        );
      });

      it('should fallback to default language when unsupported language', async () => {
        const { getI18nSettings } = await importSettings();

        getI18nSettings('unsupported-lang');

        expect(mockCreateI18nSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            language: 'en',
          }),
        );
      });

      it('should warn when using unsupported language', async () => {
        const { getI18nSettings } = await importSettings();

        getI18nSettings('xyz');

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('not supported'),
        );
      });

      it('should include language name in warning', async () => {
        const { getI18nSettings } = await importSettings();

        getI18nSettings('xyz');

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('xyz'),
        );
      });
    });

    describe('namespace handling', () => {
      it('should use default namespaces when not provided', async () => {
        const { getI18nSettings, defaultI18nNamespaces } =
          await importSettings();

        getI18nSettings('en');

        expect(mockCreateI18nSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            namespaces: defaultI18nNamespaces,
          }),
        );
      });

      it('should use provided namespace string', async () => {
        const { getI18nSettings } = await importSettings();

        getI18nSettings('en', 'custom');

        expect(mockCreateI18nSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            namespaces: 'custom',
          }),
        );
      });

      it('should use provided namespace array', async () => {
        const { getI18nSettings } = await importSettings();

        getI18nSettings('en', ['auth', 'common']);

        expect(mockCreateI18nSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            namespaces: ['auth', 'common'],
          }),
        );
      });

      it('should handle empty namespace array', async () => {
        const { getI18nSettings } = await importSettings();

        getI18nSettings('en', []);

        expect(mockCreateI18nSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            namespaces: [],
          }),
        );
      });
    });

    describe('return value', () => {
      it('should return result from createI18nSettings', async () => {
        const { getI18nSettings } = await importSettings();
        const mockResult = { language: 'en', namespaces: ['common'] };
        mockCreateI18nSettings.mockReturnValue(mockResult);

        const result = getI18nSettings('en');

        expect(result).toBe(mockResult);
      });

      it('should pass languages array to createI18nSettings', async () => {
        const { getI18nSettings, languages } = await importSettings();

        getI18nSettings('en');

        expect(mockCreateI18nSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            languages,
          }),
        );
      });
    });

    describe('edge cases', () => {
      it('should handle empty string language', async () => {
        const { getI18nSettings } = await importSettings();

        getI18nSettings('');

        expect(mockCreateI18nSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            language: 'en',
          }),
        );
      });

      it('should handle language with special characters', async () => {
        const { getI18nSettings } = await importSettings();

        getI18nSettings('en-US');

        expect(consoleWarnSpy).toHaveBeenCalled();
      });

      it('should handle very long language code', async () => {
        const { getI18nSettings } = await importSettings();

        getI18nSettings('a'.repeat(100));

        expect(consoleWarnSpy).toHaveBeenCalled();
      });

      it('should handle null language by treating as undefined', async () => {
        const { getI18nSettings } = await importSettings();

        getI18nSettings(null as any);

        expect(mockCreateI18nSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            language: 'en',
          }),
        );
      });
    });

    describe('integration scenarios', () => {
      it('should work with custom environment language', async () => {
        process.env.NEXT_PUBLIC_DEFAULT_LOCALE = 'fr';
        const { getI18nSettings } = await importSettings();

        getI18nSettings('fr');

        expect(mockCreateI18nSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            language: 'fr',
          }),
        );
      });

      it('should support multiple namespaces', async () => {
        const { getI18nSettings } = await importSettings();
        const namespaces = ['auth', 'common', 'billing', 'teams'];

        getI18nSettings('en', namespaces);

        expect(mockCreateI18nSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            namespaces,
          }),
        );
      });

      it('should maintain consistent behavior on multiple calls', async () => {
        const { getI18nSettings } = await importSettings();

        getI18nSettings('en', 'common');
        getI18nSettings('en', 'common');

        expect(mockCreateI18nSettings).toHaveBeenCalledTimes(2);
        expect(mockCreateI18nSettings).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({ language: 'en', namespaces: 'common' }),
        );
        expect(mockCreateI18nSettings).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ language: 'en', namespaces: 'common' }),
        );
      });
    });
  });

  describe('defaultI18nNamespaces', () => {
    it('should contain all expected namespaces', async () => {
      const { defaultI18nNamespaces } = await importSettings();

      const expectedNamespaces = [
        'common',
        'auth',
        'account',
        'teams',
        'billing',
        'marketing',
        'projects',
      ];

      expectedNamespaces.forEach((ns) => {
        expect(defaultI18nNamespaces).toContain(ns);
      });
    });

    it('should have correct length', async () => {
      const { defaultI18nNamespaces } = await importSettings();

      expect(defaultI18nNamespaces).toHaveLength(7);
    });

    it('should be an array', async () => {
      const { defaultI18nNamespaces } = await importSettings();

      expect(Array.isArray(defaultI18nNamespaces)).toBe(true);
    });
  });

  describe('languages array', () => {
    it('should contain at least one language', async () => {
      const { languages } = await importSettings();

      expect(languages.length).toBeGreaterThan(0);
    });

    it('should be an array', async () => {
      const { languages } = await importSettings();

      expect(Array.isArray(languages)).toBe(true);
    });

    it('should contain default language', async () => {
      const { languages } = await importSettings();

      expect(languages[0]).toBe('en');
    });
  });
});
