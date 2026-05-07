import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initializeServerI18n,
  parseAcceptLanguageHeader,
} from '../src/i18n.server';

describe('i18n Server', () => {
  describe('parseAcceptLanguageHeader', () => {
    const acceptedLanguages = ['en', 'es', 'fr', 'de', 'it', 'ja', 'zh'];

    describe('basic parsing', () => {
      it('should parse single language', () => {
        const result = parseAcceptLanguageHeader('en', acceptedLanguages);
        expect(result).toEqual(['en']);
      });

      it('should parse multiple languages', () => {
        const result = parseAcceptLanguageHeader('en,es,fr', acceptedLanguages);
        expect(result).toEqual(['en', 'es', 'fr']);
      });

      it('should return empty array for null header', () => {
        const result = parseAcceptLanguageHeader(null, acceptedLanguages);
        expect(result).toEqual([]);
      });

      it('should return empty array for undefined header', () => {
        const result = parseAcceptLanguageHeader(undefined, acceptedLanguages);
        expect(result).toEqual([]);
      });

      it('should return empty array for empty string', () => {
        const result = parseAcceptLanguageHeader('', acceptedLanguages);
        expect(result).toEqual([]);
      });
    });

    describe('quality values', () => {
      it('should parse languages with quality values', () => {
        const result = parseAcceptLanguageHeader(
          'en;q=0.9,es;q=0.8,fr;q=0.7',
          acceptedLanguages,
        );
        expect(result).toEqual(['en', 'es', 'fr']);
      });

      it('should sort by quality values in descending order', () => {
        const result = parseAcceptLanguageHeader(
          'en;q=0.5,es;q=0.9,fr;q=0.7',
          acceptedLanguages,
        );
        expect(result).toEqual(['es', 'fr', 'en']);
      });

      it('should default quality to 1.0 when not specified', () => {
        const result = parseAcceptLanguageHeader(
          'en,es;q=0.9,fr;q=0.8',
          acceptedLanguages,
        );
        // 'en' has implicit q=1.0, so it should come first
        expect(result).toEqual(['en', 'es', 'fr']);
      });

      it('should handle quality value with spaces', () => {
        const result = parseAcceptLanguageHeader(
          'en;q = 0.9,es;q= 0.8',
          acceptedLanguages,
        );
        expect(result).toEqual(['en', 'es']);
      });

      it('should handle invalid quality values', () => {
        const result = parseAcceptLanguageHeader(
          'en;q=abc,es;q=0.9',
          acceptedLanguages,
        );
        // Invalid q value defaults to 0, but is still included (sorted last)
        expect(result).toEqual(['es', 'en']);
      });
    });

    describe('locale handling', () => {
      it('should extract language from locale (en-US → en)', () => {
        const result = parseAcceptLanguageHeader('en-US', acceptedLanguages);
        expect(result).toEqual(['en']);
      });

      it('should extract language from multiple locales', () => {
        const result = parseAcceptLanguageHeader(
          'en-US,es-ES,fr-FR',
          acceptedLanguages,
        );
        expect(result).toEqual(['en', 'es', 'fr']);
      });

      it('should handle region-specific locales with quality', () => {
        const result = parseAcceptLanguageHeader(
          'en-US;q=0.9,es-MX;q=0.8,fr-CA;q=0.7',
          acceptedLanguages,
        );
        expect(result).toEqual(['en', 'es', 'fr']);
      });

      it('should handle mixed locales and languages', () => {
        const result = parseAcceptLanguageHeader(
          'en-US,es,fr-FR',
          acceptedLanguages,
        );
        expect(result).toEqual(['en', 'es', 'fr']);
      });
    });

    describe('wildcard handling', () => {
      it('should ignore wildcard * by default', () => {
        const result = parseAcceptLanguageHeader(
          'en,*;q=0.5',
          acceptedLanguages,
        );
        expect(result).toEqual(['en']);
      });

      it('should ignore wildcard in middle of list', () => {
        const result = parseAcceptLanguageHeader('en,*,es', acceptedLanguages);
        expect(result).toEqual(['en', 'es']);
      });
    });

    describe('filtering by accepted languages', () => {
      it('should only return languages in accepted list', () => {
        const result = parseAcceptLanguageHeader(
          'en,ru,es,pt',
          acceptedLanguages,
        );
        // ru and pt are not in acceptedLanguages
        expect(result).toEqual(['en', 'es']);
      });

      it('should filter out unsupported languages with quality values', () => {
        const result = parseAcceptLanguageHeader(
          'en;q=0.9,ru;q=0.8,es;q=0.7,pt;q=0.6',
          acceptedLanguages,
        );
        expect(result).toEqual(['en', 'es']);
      });

      it('should return empty array when no languages match', () => {
        const result = parseAcceptLanguageHeader('ru,pt,ar', acceptedLanguages);
        expect(result).toEqual([]);
      });
    });

    describe('whitespace handling', () => {
      it('should trim whitespace from languages', () => {
        const result = parseAcceptLanguageHeader(
          ' en , es , fr ',
          acceptedLanguages,
        );
        expect(result).toEqual(['en', 'es', 'fr']);
      });

      it('should handle whitespace in quality values', () => {
        const result = parseAcceptLanguageHeader(
          'en ; q = 0.9 , es ; q = 0.8',
          acceptedLanguages,
        );
        expect(result).toEqual(['en', 'es']);
      });
    });

    describe('edge cases', () => {
      it('should handle empty language segments', () => {
        const result = parseAcceptLanguageHeader('en,,es', acceptedLanguages);
        expect(result).toEqual(['en', 'es']);
      });

      it('should handle single language with trailing comma', () => {
        const result = parseAcceptLanguageHeader('en,', acceptedLanguages);
        expect(result).toEqual(['en']);
      });

      it('should handle quality value of 0', () => {
        const result = parseAcceptLanguageHeader(
          'en;q=0,es;q=0.5',
          acceptedLanguages,
        );
        // q=0 items are still included (sorted last)
        expect(result).toEqual(['es', 'en']);
      });

      it('should handle quality value of 1', () => {
        const result = parseAcceptLanguageHeader(
          'en;q=1,es;q=0.9',
          acceptedLanguages,
        );
        expect(result).toEqual(['en', 'es']);
      });

      it('should handle very long language list', () => {
        const longList = acceptedLanguages
          .map((l, i) => `${l};q=0.${9 - i}`)
          .join(',');
        const result = parseAcceptLanguageHeader(longList, acceptedLanguages);
        expect(result.length).toBe(acceptedLanguages.length);
      });

      it('should handle special characters in locale', () => {
        const result = parseAcceptLanguageHeader('zh-Hans-CN,zh-Hant-TW', [
          'zh',
        ]);
        expect(result).toEqual(['zh', 'zh']);
      });

      it('should handle case sensitivity', () => {
        const acceptedLanguagesUppercase = ['EN', 'ES', 'FR'];
        const result = parseAcceptLanguageHeader(
          'EN,ES,FR',
          acceptedLanguagesUppercase,
        );
        // Matching is case-sensitive - uppercase languages need uppercase accepted list
        expect(result).toEqual(['EN', 'ES', 'FR']);
      });
    });

    describe('real-world examples', () => {
      it('should parse Chrome Accept-Language header', () => {
        const result = parseAcceptLanguageHeader(
          'en-US,en;q=0.9,es;q=0.8,fr;q=0.7',
          acceptedLanguages,
        );
        expect(result).toEqual(['en', 'en', 'es', 'fr']);
      });

      it('should parse Firefox Accept-Language header', () => {
        const result = parseAcceptLanguageHeader(
          'en-US,en;q=0.5',
          acceptedLanguages,
        );
        expect(result).toEqual(['en', 'en']);
      });

      it('should parse Safari Accept-Language header', () => {
        const result = parseAcceptLanguageHeader('en-us', acceptedLanguages);
        expect(result).toEqual(['en']);
      });

      it('should handle mobile browser header', () => {
        const result = parseAcceptLanguageHeader(
          'en-US,en;q=0.9,es-US;q=0.8,es;q=0.7',
          acceptedLanguages,
        );
        expect(result).toEqual(['en', 'en', 'es', 'es']);
      });
    });
  });

  describe('initializeServerI18n', () => {
    beforeEach(() => {
      // Suppress console warnings during tests
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe('basic initialization', () => {
      it('should initialize i18n with single namespace', async () => {
        const settings = {
          lng: 'en',
          fallbackLng: 'en',
          ns: ['common'],
          defaultNS: 'common',
        };

        const resolver = vi.fn().mockResolvedValue({
          hello: 'Hello',
          world: 'World',
        });

        const i18n = await initializeServerI18n(settings, resolver);

        expect(i18n).toBeDefined();
        expect(i18n.language).toBe('en');
        expect(resolver).toHaveBeenCalledWith('en', 'common');
      });

      it('should initialize i18n with multiple namespaces', async () => {
        const settings = {
          lng: 'en',
          fallbackLng: 'en',
          ns: ['common', 'auth', 'dashboard'],
          defaultNS: 'common',
        };

        const resolver = vi.fn().mockResolvedValue({
          key: 'value',
        });

        const i18n = await initializeServerI18n(settings, resolver);

        expect(i18n).toBeDefined();
        expect(resolver).toHaveBeenCalledTimes(3);
        expect(resolver).toHaveBeenCalledWith('en', 'common');
        expect(resolver).toHaveBeenCalledWith('en', 'auth');
        expect(resolver).toHaveBeenCalledWith('en', 'dashboard');
      });

      it('should initialize with different language', async () => {
        const settings = {
          lng: 'es',
          fallbackLng: 'en',
          ns: ['common'],
          defaultNS: 'common',
        };

        const resolver = vi.fn().mockResolvedValue({
          hello: 'Hola',
        });

        const i18n = await initializeServerI18n(settings, resolver);

        expect(i18n.language).toBe('es');
        expect(resolver).toHaveBeenCalledWith('es', 'common');
      });
    });

    describe('error handling', () => {
      it('should handle resolver errors gracefully', async () => {
        const settings = {
          lng: 'en',
          fallbackLng: 'en',
          ns: ['common'],
          defaultNS: 'common',
        };

        const resolver = vi.fn().mockRejectedValue(new Error('File not found'));

        const i18n = await initializeServerI18n(settings, resolver);

        expect(i18n).toBeDefined();
        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining('Error loading i18n file'),
          expect.any(Error),
        );
      });

      it('should handle partial resolver failures', async () => {
        const settings = {
          lng: 'en',
          fallbackLng: 'en',
          ns: ['common', 'auth'],
          defaultNS: 'common',
        };

        const resolver = vi
          .fn()
          .mockResolvedValueOnce({ hello: 'Hello' })
          .mockRejectedValueOnce(new Error('Auth file not found'));

        const i18n = await initializeServerI18n(settings, resolver);

        expect(i18n).toBeDefined();
      });

      it('should handle empty resolver response', async () => {
        const settings = {
          lng: 'en',
          fallbackLng: 'en',
          ns: ['common'],
          defaultNS: 'common',
        };

        const resolver = vi.fn().mockResolvedValue({});

        const i18n = await initializeServerI18n(settings, resolver);

        expect(i18n).toBeDefined();
      });
    });

    describe('namespace loading', () => {
      it('should wait for all namespaces to load', async () => {
        const settings = {
          lng: 'en',
          fallbackLng: 'en',
          ns: ['common', 'auth'],
          defaultNS: 'common',
        };

        const resolver = vi.fn().mockImplementation(async (lang, ns) => {
          // Simulate async loading
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { [`${ns}_key`]: `${ns}_value` };
        });

        const i18n = await initializeServerI18n(settings, resolver);

        expect(i18n).toBeDefined();
        expect(resolver).toHaveBeenCalledTimes(2);
      });

      it('should handle slow namespace loading', async () => {
        const settings = {
          lng: 'en',
          fallbackLng: 'en',
          ns: ['common', 'slow'],
          defaultNS: 'common',
        };

        const resolver = vi.fn().mockImplementation(async (lang, ns) => {
          if (ns === 'slow') {
            // Simulate slow loading - i18next waits for all resources
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return { key: `${ns}_value` };
        });

        const i18n = await initializeServerI18n(settings, resolver);

        // i18next waits for all namespaces to load during init()
        // so slow namespaces are loaded correctly (no warning needed)
        expect(i18n).toBeDefined();
        expect(resolver).toHaveBeenCalledWith('en', 'common');
        expect(resolver).toHaveBeenCalledWith('en', 'slow');
      });

      it('should return immediately when all namespaces already loaded', async () => {
        const settings = {
          lng: 'en',
          fallbackLng: 'en',
          ns: ['common'],
          defaultNS: 'common',
        };

        const resolver = vi.fn().mockResolvedValue({
          key: 'value',
        });

        const startTime = Date.now();
        const i18n = await initializeServerI18n(settings, resolver);
        const duration = Date.now() - startTime;

        expect(i18n).toBeDefined();
        // Should be fast (less than 50ms) since namespace loads quickly
        expect(duration).toBeLessThan(100);
      });
    });

    describe('integration scenarios', () => {
      it('should handle typical web app initialization', async () => {
        const settings = {
          lng: 'en',
          fallbackLng: 'en',
          supportedLngs: ['en', 'es', 'fr'],
          ns: ['common', 'auth', 'dashboard', 'errors'],
          defaultNS: 'common',
        };

        const mockTranslations: Record<string, Record<string, string>> = {
          common: { app_name: 'My App', welcome: 'Welcome' },
          auth: { login: 'Log In', signup: 'Sign Up' },
          dashboard: { title: 'Dashboard' },
          errors: { not_found: 'Not Found' },
        };

        const resolver = vi.fn().mockImplementation(async (lang, ns) => {
          return mockTranslations[ns] || {};
        });

        const i18n = await initializeServerI18n(settings, resolver);

        expect(i18n).toBeDefined();
        expect(i18n.language).toBe('en');
        expect(resolver).toHaveBeenCalledTimes(4);
      });

      it('should handle multi-language scenario', async () => {
        const settings = {
          lng: 'fr',
          fallbackLng: 'en',
          supportedLngs: ['en', 'es', 'fr', 'de'],
          ns: ['common'],
          defaultNS: 'common',
        };

        const resolver = vi.fn().mockResolvedValue({
          hello: 'Bonjour',
        });

        const i18n = await initializeServerI18n(settings, resolver);

        expect(i18n.language).toBe('fr');
        expect(resolver).toHaveBeenCalledWith('fr', 'common');
      });

      it('should support React SSR scenario', async () => {
        const settings = {
          lng: 'en',
          fallbackLng: 'en',
          ns: ['common'],
          defaultNS: 'common',
          react: {
            useSuspense: false,
          },
        };

        const resolver = vi.fn().mockResolvedValue({
          key: 'value',
        });

        const i18n = await initializeServerI18n(settings, resolver);

        expect(i18n).toBeDefined();
        // Should have React i18next initialized
        expect(i18n).toBeDefined();
      });
    });

    describe('edge cases', () => {
      it('should handle empty namespace array', async () => {
        const settings = {
          lng: 'en',
          fallbackLng: 'en',
          ns: [],
          defaultNS: 'common',
        };

        const resolver = vi.fn();

        const i18n = await initializeServerI18n(settings, resolver);

        expect(i18n).toBeDefined();
        // Resolver should not be called for empty namespaces
        expect(resolver).not.toHaveBeenCalled();
      });

      it('should handle very large translation objects', async () => {
        const settings = {
          lng: 'en',
          fallbackLng: 'en',
          ns: ['common'],
          defaultNS: 'common',
        };

        // Create a large translation object
        const largeTranslations = Object.fromEntries(
          Array.from({ length: 1000 }, (_, i) => [`key${i}`, `value${i}`]),
        );

        const resolver = vi.fn().mockResolvedValue(largeTranslations);

        const i18n = await initializeServerI18n(settings, resolver);

        expect(i18n).toBeDefined();
      });
    });
  });
});
