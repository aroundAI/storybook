import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock next/headers
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

// Mock @kit/i18n/server
vi.mock('@kit/i18n/server', () => ({
  initializeServerI18n: vi.fn(),
  parseAcceptLanguageHeader: vi.fn(),
}));

// Mock i18n.settings
vi.mock('~/lib/i18n/i18n.settings', () => ({
  I18N_COOKIE_NAME: 'lang',
  getI18nSettings: vi.fn(),
  languages: ['en', 'fr', 'es'],
}));

// Mock feature flags
vi.mock('~/config/feature-flags.config', () => ({
  default: {
    languagePriority: 'app',
  },
}));

// Mock i18n.resolver
vi.mock('../i18n.resolver', () => ({
  i18nResolver: vi.fn(),
}));

// Import after mocking
import { cookies, headers } from 'next/headers';
import { initializeServerI18n, parseAcceptLanguageHeader } from '@kit/i18n/server';
import { getI18nSettings } from '~/lib/i18n/i18n.settings';
import { i18nResolver } from '../i18n.resolver';
import { createI18nServerInstance } from '../i18n.server';

// Get mocked functions
const mockCookies = vi.mocked(cookies);
const mockHeaders = vi.mocked(headers);
const mockInitializeServerI18n = vi.mocked(initializeServerI18n);
const mockParseAcceptLanguageHeader = vi.mocked(parseAcceptLanguageHeader);
const mockGetI18nSettings = vi.mocked(getI18nSettings);
const mockI18nResolver = vi.mocked(i18nResolver);

describe('i18n.server', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    mockCookies.mockResolvedValue({
      get: vi.fn(),
    } as any);

    mockHeaders.mockResolvedValue({
      get: vi.fn(),
    } as any);

    mockGetI18nSettings.mockReturnValue({
      language: 'en',
      namespaces: ['common'],
    } as any);

    mockInitializeServerI18n.mockResolvedValue({
      t: vi.fn(),
      language: 'en',
    } as any);

    mockParseAcceptLanguageHeader.mockReturnValue(['en']);
  });

  describe('createI18nServerInstance', () => {
    describe('language detection from cookie', () => {
      it('should use language from cookie when available', async () => {
        const mockCookieStore = {
          get: vi.fn().mockReturnValue({ value: 'en' }),
        };
        mockCookies.mockResolvedValue(mockCookieStore);

        await createI18nServerInstance();

        expect(mockCookieStore.get).toHaveBeenCalledWith('lang');
        expect(mockGetI18nSettings).toHaveBeenCalledWith('en');
      });

      it('should validate cookie language against supported languages', async () => {
        const mockCookieStore = {
          get: vi.fn().mockReturnValue({ value: 'fr' }),
        };
        mockCookies.mockResolvedValue(mockCookieStore);

        await createI18nServerInstance();

        expect(mockGetI18nSettings).toHaveBeenCalledWith('fr');
      });

      it('should fallback to default for unsupported cookie language', async () => {
        const mockCookieStore = {
          get: vi.fn().mockReturnValue({ value: 'unsupported' }),
        };
        mockCookies.mockResolvedValue(mockCookieStore);

        const consoleWarnSpy = vi
          .spyOn(console, 'warn')
          .mockImplementation(() => {});

        await createI18nServerInstance();

        expect(consoleWarnSpy).toHaveBeenCalled();
        consoleWarnSpy.mockRestore();
      });

      it('should handle missing cookie gracefully', async () => {
        const mockCookieStore = {
          get: vi.fn().mockReturnValue(undefined),
        };
        mockCookies.mockResolvedValue(mockCookieStore);

        await createI18nServerInstance();

        expect(mockGetI18nSettings).toHaveBeenCalled();
      });

      it('should handle empty cookie value', async () => {
        const mockCookieStore = {
          get: vi.fn().mockReturnValue({ value: '' }),
        };
        mockCookies.mockResolvedValue(mockCookieStore);

        await createI18nServerInstance();

        expect(mockGetI18nSettings).toHaveBeenCalled();
      });
    });

    describe('language detection from accept-language header', () => {
      beforeEach(() => {
        // Override feature flag mock for these tests
        vi.doMock('~/config/feature-flags.config', () => ({
          default: {
            languagePriority: 'user',
          },
        }));
      });

      it('should use accept-language when priority is user and no cookie', async () => {
        // Re-import to get updated feature flag
        vi.resetModules();
        vi.doMock('~/config/feature-flags.config', () => ({
          default: {
            languagePriority: 'user',
          },
        }));

        const mockCookieStore = {
          get: vi.fn().mockReturnValue(undefined),
        };
        mockCookies.mockResolvedValue(mockCookieStore);

        const mockHeadersStore = {
          get: vi.fn().mockReturnValue('en-US,en;q=0.9,fr;q=0.8'),
        };
        mockHeaders.mockResolvedValue(mockHeadersStore);

        mockParseAcceptLanguageHeader.mockReturnValue(['en']);

        const { createI18nServerInstance: newInstance } = await import(
          '../i18n.server'
        );

        await newInstance();

        expect(mockHeadersStore.get).toHaveBeenCalledWith('accept-language');
        expect(mockParseAcceptLanguageHeader).toHaveBeenCalledWith(
          'en-US,en;q=0.9,fr;q=0.8',
          expect.any(Array),
        );
      });

      it('should prioritize cookie over accept-language header', async () => {
        const mockCookieStore = {
          get: vi.fn().mockReturnValue({ value: 'es' }),
        };
        mockCookies.mockResolvedValue(mockCookieStore);

        const mockHeadersStore = {
          get: vi.fn().mockReturnValue('en-US,en;q=0.9'),
        };
        mockHeaders.mockResolvedValue(mockHeadersStore);

        await createI18nServerInstance();

        expect(mockGetI18nSettings).toHaveBeenCalledWith('es');
        expect(mockParseAcceptLanguageHeader).not.toHaveBeenCalled();
      });

      it('should handle missing accept-language header', async () => {
        vi.resetModules();
        vi.doMock('~/config/feature-flags.config', () => ({
          default: {
            languagePriority: 'user',
          },
        }));

        const mockCookieStore = {
          get: vi.fn().mockReturnValue(undefined),
        };
        mockCookies.mockResolvedValue(mockCookieStore);

        const mockHeadersStore = {
          get: vi.fn().mockReturnValue(null),
        };
        mockHeaders.mockResolvedValue(mockHeadersStore);

        const { createI18nServerInstance: newInstance } = await import(
          '../i18n.server'
        );

        await newInstance();

        expect(mockParseAcceptLanguageHeader).not.toHaveBeenCalled();
      });
    });

    describe('initialization', () => {
      it('should call initializeServerI18n with settings and resolver', async () => {
        await createI18nServerInstance();

        expect(mockInitializeServerI18n).toHaveBeenCalledWith(
          expect.objectContaining({
            language: 'en',
            namespaces: ['common'],
          }),
          mockI18nResolver,
        );
      });

      it('should return initialized i18n instance', async () => {
        const mockInstance = { t: vi.fn(), language: 'en' };
        mockInitializeServerI18n.mockResolvedValue(mockInstance);

        const result = await createI18nServerInstance();

        expect(result).toBe(mockInstance);
      });

      it('should use React cache wrapper', async () => {
        // Call twice - should use cached result
        const first = await createI18nServerInstance();
        const second = await createI18nServerInstance();

        // With React.cache, these should be the same reference
        expect(first).toBe(second);
      });
    });

    describe('language priority modes', () => {
      it('should respect app priority setting', async () => {
        vi.resetModules();
        vi.doMock('~/config/feature-flags.config', () => ({
          default: {
            languagePriority: 'app',
          },
        }));

        const mockCookieStore = {
          get: vi.fn().mockReturnValue(undefined),
        };
        mockCookies.mockResolvedValue(mockCookieStore);

        const mockHeadersStore = {
          get: vi.fn().mockReturnValue('fr-FR,fr;q=0.9'),
        };
        mockHeaders.mockResolvedValue(mockHeadersStore);

        const { createI18nServerInstance: newInstance } = await import(
          '../i18n.server'
        );

        await newInstance();

        // Should not parse accept-language when priority is app
        expect(mockParseAcceptLanguageHeader).not.toHaveBeenCalled();
      });
    });

    describe('edge cases', () => {
      it('should handle cookie with special characters', async () => {
        const mockCookieStore = {
          get: vi.fn().mockReturnValue({ value: 'en-US' }),
        };
        mockCookies.mockResolvedValue(mockCookieStore);

        await createI18nServerInstance();

        expect(mockCookieStore.get).toHaveBeenCalled();
      });

      it('should handle very long accept-language header', async () => {
        vi.resetModules();
        vi.doMock('~/config/feature-flags.config', () => ({
          default: {
            languagePriority: 'user',
          },
        }));

        const mockCookieStore = {
          get: vi.fn().mockReturnValue(undefined),
        };
        mockCookies.mockResolvedValue(mockCookieStore);

        const longHeader = 'en-US,' + 'fr;q=0.9,'.repeat(100);
        const mockHeadersStore = {
          get: vi.fn().mockReturnValue(longHeader),
        };
        mockHeaders.mockResolvedValue(mockHeadersStore);

        const { createI18nServerInstance: newInstance } = await import(
          '../i18n.server'
        );

        await newInstance();

        expect(mockParseAcceptLanguageHeader).toHaveBeenCalled();
      });

      it('should handle null cookie value', async () => {
        const mockCookieStore = {
          get: vi.fn().mockReturnValue(null),
        };
        mockCookies.mockResolvedValue(mockCookieStore);

        await createI18nServerInstance();

        expect(mockGetI18nSettings).toHaveBeenCalled();
      });

      it('should handle async cookie/header operations', async () => {
        // Simulate slow operations
        mockCookies.mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ get: vi.fn() }), 10)),
        );

        const result = await createI18nServerInstance();

        expect(result).toBeDefined();
      });
    });

    describe('integration scenarios', () => {
      it('should work with all supported languages', async () => {
        const supportedLanguages = ['en', 'fr', 'es'];

        for (const lang of supportedLanguages) {
          const mockCookieStore = {
            get: vi.fn().mockReturnValue({ value: lang }),
          };
          mockCookies.mockResolvedValue(mockCookieStore);

          await createI18nServerInstance();

          expect(mockGetI18nSettings).toHaveBeenCalledWith(lang);
        }
      });

      it('should handle rapid successive calls', async () => {
        const promises = Array.from({ length: 10 }, () =>
          createI18nServerInstance(),
        );

        const results = await Promise.all(promises);

        expect(results).toHaveLength(10);
        results.forEach((result) => {
          expect(result).toBeDefined();
        });
      });

      it('should maintain language consistency across calls', async () => {
        const mockCookieStore = {
          get: vi.fn().mockReturnValue({ value: 'fr' }),
        };
        mockCookies.mockResolvedValue(mockCookieStore);

        await createI18nServerInstance();
        await createI18nServerInstance();

        // Both calls should use the same language
        expect(mockGetI18nSettings).toHaveBeenCalledWith('fr');
      });
    });

    describe('error handling', () => {
      it('should handle cookies() throwing error', async () => {
        mockCookies.mockRejectedValue(new Error('Cookie error'));

        await expect(createI18nServerInstance()).rejects.toThrow(
          'Cookie error',
        );
      });

      it('should handle headers() throwing error', async () => {
        vi.resetModules();
        vi.doMock('~/config/feature-flags.config', () => ({
          default: {
            languagePriority: 'user',
          },
        }));

        const mockCookieStore = {
          get: vi.fn().mockReturnValue(undefined),
        };
        mockCookies.mockResolvedValue(mockCookieStore);

        mockHeaders.mockRejectedValue(new Error('Header error'));

        const { createI18nServerInstance: newInstance } = await import(
          '../i18n.server'
        );

        await expect(newInstance()).rejects.toThrow('Header error');
      });

      it('should handle initializeServerI18n throwing error', async () => {
        mockInitializeServerI18n.mockRejectedValue(
          new Error('Init error'),
        );

        await expect(createI18nServerInstance()).rejects.toThrow('Init error');
      });
    });
  });
});
