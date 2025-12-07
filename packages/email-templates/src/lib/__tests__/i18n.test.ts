import type { i18n } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Import after mocking
import { initializeServerI18n } from '@kit/i18n/server';

import { initializeEmailI18n } from '../i18n';

// Mock @kit/i18n/server
vi.mock('@kit/i18n/server', () => ({
  initializeServerI18n: vi.fn(),
}));

// Get mocked function with proper type
const mockInitializeServerI18n = vi.mocked(initializeServerI18n);

describe('email-templates i18n', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitializeServerI18n.mockResolvedValue({
      t: vi.fn(),
      language: 'en',
    } as unknown as i18n);
  });

  describe('initializeEmailI18n', () => {
    describe('language handling', () => {
      it('should use provided language', async () => {
        await initializeEmailI18n({
          language: 'fr',
          namespace: 'test',
        });

        expect(mockInitializeServerI18n).toHaveBeenCalledWith(
          expect.objectContaining({
            lng: 'fr',
            supportedLngs: ['fr'],
          }),
          expect.any(Function),
        );
      });

      it('should default to en when language is undefined', async () => {
        await initializeEmailI18n({
          language: undefined,
          namespace: 'test',
        });

        expect(mockInitializeServerI18n).toHaveBeenCalledWith(
          expect.objectContaining({
            lng: 'en',
            supportedLngs: ['en'],
          }),
          expect.any(Function),
        );
      });

      it('should use language for both lng and supportedLngs', async () => {
        await initializeEmailI18n({
          language: 'es',
          namespace: 'welcome',
        });

        const callArgs = mockInitializeServerI18n.mock.calls[0];
        const config = callArgs?.[0];

        expect(config?.lng).toBe('es');
        expect(config?.supportedLngs).toEqual(['es']);
      });

      it('should handle null language by defaulting to en', async () => {
        await initializeEmailI18n({
          language: null as any,
          namespace: 'test',
        });

        expect(mockInitializeServerI18n).toHaveBeenCalledWith(
          expect.objectContaining({
            lng: 'en',
            supportedLngs: ['en'],
          }),
          expect.any(Function),
        );
      });

      it('should handle empty string language by using it', async () => {
        await initializeEmailI18n({
          language: '',
          namespace: 'test',
        });

        expect(mockInitializeServerI18n).toHaveBeenCalledWith(
          expect.objectContaining({
            lng: '',
            supportedLngs: [''],
          }),
          expect.any(Function),
        );
      });
    });

    describe('namespace handling', () => {
      it('should use provided namespace', async () => {
        await initializeEmailI18n({
          language: 'en',
          namespace: 'welcome',
        });

        expect(mockInitializeServerI18n).toHaveBeenCalledWith(
          expect.objectContaining({
            ns: 'welcome',
          }),
          expect.any(Function),
        );
      });

      it('should handle different namespace values', async () => {
        const namespaces = [
          'welcome',
          'password-reset',
          'invitation',
          'notification',
        ];

        for (const namespace of namespaces) {
          vi.clearAllMocks();

          await initializeEmailI18n({
            language: 'en',
            namespace,
          });

          expect(mockInitializeServerI18n).toHaveBeenCalledWith(
            expect.objectContaining({
              ns: namespace,
            }),
            expect.any(Function),
          );
        }
      });
    });

    describe('resolver function', () => {
      it('should provide resolver function to initializeServerI18n', async () => {
        await initializeEmailI18n({
          language: 'en',
          namespace: 'test',
        });

        const callArgs = mockInitializeServerI18n.mock.calls[0];
        const resolver = callArgs?.[1];

        expect(typeof resolver).toBe('function');
      });

      it('should resolver attempt to load translation file', async () => {
        await initializeEmailI18n({
          language: 'en',
          namespace: 'welcome',
        });

        const callArgs = mockInitializeServerI18n.mock.calls[0];
        const resolver = callArgs?.[1];

        // The resolver should be an async function
        expect(resolver).toBeInstanceOf(Function);

        // Try to call it (it will fail in test environment but we verify structure)
        if (resolver) {
          const result = await resolver('en', 'welcome');
          expect(result).toBeDefined();
        }
      });

      it('should return empty object on import error', async () => {
        await initializeEmailI18n({
          language: 'en',
          namespace: 'non-existent',
        });

        const callArgs = mockInitializeServerI18n.mock.calls[0];
        const resolver = callArgs?.[1];

        // Call resolver with non-existent namespace
        if (resolver) {
          const result = await resolver('en', 'non-existent-namespace');

          // Should return empty object on error
          expect(result).toEqual({});
        }
      });

      it('should log error when translation file not found', async () => {
        const consoleLogSpy = vi
          .spyOn(console, 'log')
          .mockImplementation(() => {});

        await initializeEmailI18n({
          language: 'en',
          namespace: 'test',
        });

        const callArgs = mockInitializeServerI18n.mock.calls[0];
        const resolver = callArgs?.[1];

        if (resolver) {
          await resolver('invalid-lang', 'invalid-namespace');

          expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining('Error loading i18n file'),
            expect.any(Error),
          );
        }

        consoleLogSpy.mockRestore();
      });
    });

    describe('return value', () => {
      it('should return result from initializeServerI18n', async () => {
        const mockResult = { t: vi.fn(), language: 'en' } as unknown as i18n;
        mockInitializeServerI18n.mockResolvedValue(mockResult);

        const result = await initializeEmailI18n({
          language: 'en',
          namespace: 'test',
        });

        expect(result).toBe(mockResult);
      });

      it('should return i18n instance with t function', async () => {
        const result = await initializeEmailI18n({
          language: 'en',
          namespace: 'test',
        });

        expect(result).toHaveProperty('t');
        expect(typeof result.t).toBe('function');
      });
    });

    describe('integration scenarios', () => {
      it('should work with typical email welcome scenario', async () => {
        await initializeEmailI18n({
          language: 'en',
          namespace: 'welcome',
        });

        expect(mockInitializeServerI18n).toHaveBeenCalledWith(
          {
            supportedLngs: ['en'],
            lng: 'en',
            ns: 'welcome',
          },
          expect.any(Function),
        );
      });

      it('should work with password reset email', async () => {
        await initializeEmailI18n({
          language: 'fr',
          namespace: 'password-reset',
        });

        expect(mockInitializeServerI18n).toHaveBeenCalledWith(
          {
            supportedLngs: ['fr'],
            lng: 'fr',
            ns: 'password-reset',
          },
          expect.any(Function),
        );
      });

      it('should work with invitation email in different languages', async () => {
        const languages = ['en', 'fr', 'es', 'de'];

        for (const language of languages) {
          vi.clearAllMocks();

          await initializeEmailI18n({
            language,
            namespace: 'invitation',
          });

          expect(mockInitializeServerI18n).toHaveBeenCalledWith(
            {
              supportedLngs: [language],
              lng: language,
              ns: 'invitation',
            },
            expect.any(Function),
          );
        }
      });

      it('should handle user with no language preference', async () => {
        await initializeEmailI18n({
          language: undefined,
          namespace: 'notification',
        });

        expect(mockInitializeServerI18n).toHaveBeenCalledWith(
          {
            supportedLngs: ['en'],
            lng: 'en',
            ns: 'notification',
          },
          expect.any(Function),
        );
      });
    });

    describe('edge cases', () => {
      it('should handle language with region code', async () => {
        await initializeEmailI18n({
          language: 'en-US',
          namespace: 'test',
        });

        expect(mockInitializeServerI18n).toHaveBeenCalledWith(
          expect.objectContaining({
            lng: 'en-US',
            supportedLngs: ['en-US'],
          }),
          expect.any(Function),
        );
      });

      it('should handle long namespace names', async () => {
        const longNamespace =
          'very-long-namespace-name-for-specific-email-template';

        await initializeEmailI18n({
          language: 'en',
          namespace: longNamespace,
        });

        expect(mockInitializeServerI18n).toHaveBeenCalledWith(
          expect.objectContaining({
            ns: longNamespace,
          }),
          expect.any(Function),
        );
      });

      it('should handle special characters in namespace', async () => {
        await initializeEmailI18n({
          language: 'en',
          namespace: 'email-template_v2',
        });

        expect(mockInitializeServerI18n).toHaveBeenCalledWith(
          expect.objectContaining({
            ns: 'email-template_v2',
          }),
          expect.any(Function),
        );
      });

      it('should handle initialization errors gracefully', async () => {
        mockInitializeServerI18n.mockRejectedValue(new Error('Init failed'));

        await expect(
          initializeEmailI18n({
            language: 'en',
            namespace: 'test',
          }),
        ).rejects.toThrow('Init failed');
      });
    });

    describe('configuration structure', () => {
      it('should pass correct configuration structure', async () => {
        await initializeEmailI18n({
          language: 'fr',
          namespace: 'welcome',
        });

        const callArgs = mockInitializeServerI18n.mock.calls[0];
        const config = callArgs?.[0];

        expect(config).toMatchObject({
          supportedLngs: expect.any(Array),
          lng: expect.any(String),
          ns: expect.any(String),
        });

        if (config) {
          expect(Object.keys(config)).toEqual(['supportedLngs', 'lng', 'ns']);
        }
      });

      it('should create single-language configuration', async () => {
        await initializeEmailI18n({
          language: 'es',
          namespace: 'test',
        });

        const callArgs = mockInitializeServerI18n.mock.calls[0];
        const config = callArgs?.[0];

        if (config && Array.isArray(config.supportedLngs)) {
          expect(config.supportedLngs).toHaveLength(1);
          expect(config.supportedLngs[0]).toBe(config.lng);
        }
      });
    });
  });
});
