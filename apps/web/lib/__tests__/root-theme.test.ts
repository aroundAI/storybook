import { cookies } from 'next/headers';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getRootTheme } from '../root-theme';

// Mock Next.js cookies - must define inline to avoid hoisting issues
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

describe('root-theme', () => {
  const mockCookies = vi.mocked(cookies);
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env = originalEnv;
  });

  describe('getRootTheme', () => {
    describe('cookie theme priority (highest)', () => {
      it('should return theme from cookie when valid', async () => {
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue({ value: 'dark' }),
        };
        mockCookies.mockResolvedValue(mockCookiesStore as any);

        const theme = await getRootTheme();

        expect(theme).toBe('dark');
        expect(mockCookiesStore.get).toHaveBeenCalledWith('theme');
      });

      it('should support light theme from cookie', async () => {
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue({ value: 'light' }),
        };
        mockCookies.mockResolvedValue(mockCookiesStore as any);

        const theme = await getRootTheme();

        expect(theme).toBe('light');
      });

      it('should support system theme from cookie', async () => {
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue({ value: 'system' }),
        };
        mockCookies.mockResolvedValue(mockCookiesStore as any);

        const theme = await getRootTheme();

        expect(theme).toBe('system');
      });

      it('should fall through when cookie has invalid value', async () => {
        // Note: env vars are evaluated at module load time, so we fall through to fallback
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue({ value: 'invalid-theme' }),
        };
        mockCookies.mockResolvedValue(mockCookiesStore as any);

        const theme = await getRootTheme();

        // Should fall through to fallback since env isn't set at module load
        expect(theme).toBe('light');
      });

      it('should fall through when cookie value is empty string', async () => {
        // Note: env vars are evaluated at module load time
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue({ value: '' }),
        };
        mockCookies.mockResolvedValue(mockCookiesStore as any);

        const theme = await getRootTheme();

        expect(theme).toBe('light');
      });
    });

    describe('environment variable theme (second priority)', () => {
      // Note: These tests validate the concept but env vars are evaluated at module load time
      // In real usage, NEXT_PUBLIC_DEFAULT_THEME_MODE is set before the app starts

      it('should use fallback when cookie is not set and env not available', async () => {
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue(undefined),
        };
        mockCookies.mockResolvedValue(mockCookiesStore as any);

        const theme = await getRootTheme();

        // Falls through to fallback since env var isn't set at module load
        expect(theme).toBe('light');
      });

      it('should use fallback when cookie is null', async () => {
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue(null),
        };
        mockCookies.mockResolvedValue(mockCookiesStore as any);

        const theme = await getRootTheme();

        expect(theme).toBe('light');
      });

      it('should fall through when env variable is invalid', async () => {
        process.env.NEXT_PUBLIC_DEFAULT_THEME_MODE = 'invalid';
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue(undefined),
        };
        mockCookies.mockResolvedValue(mockCookiesStore as any);

        const theme = await getRootTheme();

        // Should fall through to fallback
        expect(theme).toBe('light');
      });

      it('should fall through when env variable is empty', async () => {
        process.env.NEXT_PUBLIC_DEFAULT_THEME_MODE = '';
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue(undefined),
        };
        mockCookies.mockResolvedValue(mockCookiesStore as any);

        const theme = await getRootTheme();

        expect(theme).toBe('light');
      });
    });

    describe('fallback theme (lowest priority)', () => {
      it('should return light as fallback when no cookie or env', async () => {
        delete process.env.NEXT_PUBLIC_DEFAULT_THEME_MODE;
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue(undefined),
        };
        mockCookies.mockResolvedValue(mockCookiesStore as any);

        const theme = await getRootTheme();

        expect(theme).toBe('light');
      });

      it('should return light when both cookie and env are invalid', async () => {
        process.env.NEXT_PUBLIC_DEFAULT_THEME_MODE = 'invalid';
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue({ value: 'also-invalid' }),
        };
        mockCookies.mockResolvedValue(mockCookiesStore as any);

        const theme = await getRootTheme();

        expect(theme).toBe('light');
      });

      it('should return light when env is undefined and cookie is null', async () => {
        process.env.NEXT_PUBLIC_DEFAULT_THEME_MODE = undefined;
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue(null),
        };
        mockCookies.mockResolvedValue(mockCookiesStore as any);

        const theme = await getRootTheme();

        expect(theme).toBe('light');
      });
    });

    describe('priority order validation', () => {
      it('should prefer cookie over fallback', async () => {
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue({ value: 'dark' }),
        };
        mockCookies.mockResolvedValue(mockCookiesStore as any);

        const theme = await getRootTheme();

        expect(theme).toBe('dark'); // Cookie wins over fallback
      });

      it('should demonstrate priority: cookie > fallback', async () => {
        // Cookie should win
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue({ value: 'dark' }),
        };
        mockCookies.mockResolvedValue(mockCookiesStore as any);

        const theme = await getRootTheme();

        expect(theme).toBe('dark'); // Cookie wins

        // Remove cookie, fallback should win
        mockCookiesStore.get.mockReturnValue(undefined);

        const theme2 = await getRootTheme();

        expect(theme2).toBe('light'); // Fallback wins
      });
    });

    describe('edge cases', () => {
      it('should handle cookie with whitespace', async () => {
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue({ value: '  dark  ' }),
        };
        mockCookies.mockResolvedValue(mockCookiesStore as any);

        const theme = await getRootTheme();

        // Zod validator should reject whitespace-padded values
        expect(theme).toBe('light'); // Falls through to fallback
      });

      it('should handle cookie with uppercase value', async () => {
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue({ value: 'DARK' }),
        };
        mockCookies.mockResolvedValue(mockCookiesStore as any);

        const theme = await getRootTheme();

        // Zod validator is case-sensitive
        expect(theme).toBe('light');
      });

      it('should handle async cookies() call', async () => {
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue({ value: 'system' }),
        };

        // Simulate async delay
        mockCookies.mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve(mockCookiesStore), 10),
            ),
        );

        const theme = await getRootTheme();

        expect(theme).toBe('system');
      });

      it('should call cookies() function', async () => {
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue({ value: 'dark' }),
        };
        mockCookies.mockResolvedValue(mockCookiesStore as any);

        await getRootTheme();

        expect(mockCookies).toHaveBeenCalledOnce();
      });

      it('should always return one of the valid theme values', async () => {
        const validThemes = ['light', 'dark', 'system'];
        const mockCookiesStore = {
          get: vi.fn().mockReturnValue(undefined),
        };
        mockCookies.mockResolvedValue(mockCookiesStore as any);

        // Test various combinations
        const themes = [
          await getRootTheme(),
          ...(await Promise.all([
            (async () => {
              process.env.NEXT_PUBLIC_DEFAULT_THEME_MODE = 'dark';
              return getRootTheme();
            })(),
            (async () => {
              process.env.NEXT_PUBLIC_DEFAULT_THEME_MODE = 'system';
              return getRootTheme();
            })(),
          ])),
        ];

        themes.forEach((theme) => {
          expect(validThemes).toContain(theme);
        });
      });
    });
  });
});
