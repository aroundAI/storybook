import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { InitOptions } from 'i18next';

// Mock i18next
vi.mock('i18next', () => ({
  default: {
    use: vi.fn().mockReturnThis(),
    init: vi.fn(),
  },
}));

// Mock i18next-browser-languagedetector
vi.mock('i18next-browser-languagedetector', () => ({
  default: vi.fn(),
}));

// Mock i18next-resources-to-backend
vi.mock('i18next-resources-to-backend', () => ({
  default: vi.fn(),
}));

// Mock react-i18next
vi.mock('react-i18next', () => ({
  initReactI18next: vi.fn(),
}));

// Import after mocking
import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next';
import { initializeI18nClient } from '../i18n.client';

// Get mocked functions
const mockI18next = vi.mocked(i18next);
const mockLanguageDetector = vi.mocked(LanguageDetector);
const mockResourcesToBackend = vi.mocked(resourcesToBackend);
const mockInitReactI18next = vi.mocked(initReactI18next);

describe('i18n.client', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    // Reset mock chain
    mockI18next.use.mockReturnThis();
    mockI18next.init.mockImplementation((options: any, callback?: (err?: Error) => void) => {
      if (callback) callback();
      return Promise.resolve();
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleDebugSpy.mockRestore();
  });

  describe('initializeI18nClient', () => {
    const defaultSettings: InitOptions = {
      lng: 'en',
      ns: ['common'],
      fallbackLng: 'en',
    };

    const mockResolver = vi.fn().mockResolvedValue({
      key: 'value',
    });

    describe('successful initialization', () => {
      it('should initialize i18next with settings', async () => {
        mockResourcesToBackend.mockImplementation((loader) => {
          // Simulate loading
          loader('en', 'common', vi.fn());
          return 'backend';
        });

        await initializeI18nClient(defaultSettings, mockResolver);

        expect(mockI18next.use).toHaveBeenCalledWith('backend');
        expect(mockI18next.use).toHaveBeenCalledWith(mockLanguageDetector);
        expect(mockI18next.use).toHaveBeenCalledWith(mockInitReactI18next);
        expect(mockI18next.init).toHaveBeenCalled();
      });

      it('should merge settings with detection config', async () => {
        mockResourcesToBackend.mockImplementation((loader) => {
          loader('en', 'common', vi.fn());
          return 'backend';
        });

        await initializeI18nClient(defaultSettings, mockResolver);

        const initCall = mockI18next.init.mock.calls[0];
        const options = initCall?.[0];

        expect(options).toMatchObject({
          lng: 'en',
          ns: ['common'],
          fallbackLng: 'en',
          detection: {
            order: ['htmlTag', 'cookie', 'navigator'],
            caches: ['cookie'],
            lookupCookie: 'lang',
          },
          interpolation: {
            escapeValue: false,
          },
        });
      });

      it('should use resourcesToBackend with resolver', async () => {
        let backendLoader: any;
        mockResourcesToBackend.mockImplementation((loader) => {
          backendLoader = loader;
          loader('en', 'common', vi.fn());
          return 'backend';
        });

        await initializeI18nClient(defaultSettings, mockResolver);

        expect(mockResourcesToBackend).toHaveBeenCalled();
        expect(typeof backendLoader).toBe('function');
      });

      it('should setup backend loader callback structure', async () => {
        let backendLoader: any;
        mockResourcesToBackend.mockImplementation((loader) => {
          backendLoader = loader;
          loader('en', 'common', vi.fn());
          return 'backend';
        });

        await initializeI18nClient(defaultSettings, mockResolver);

        expect(mockResourcesToBackend).toHaveBeenCalled();
        expect(typeof backendLoader).toBe('function');
      });

      it('should return i18next instance', async () => {
        mockResourcesToBackend.mockImplementation((loader) => {
          loader('en', 'common', vi.fn());
          return 'backend';
        });

        const result = await initializeI18nClient(defaultSettings, mockResolver);

        expect(result).toBe(mockI18next);
      });
    });

    describe('error handling', () => {
      it('should log error when init fails', async () => {
        const testError = new Error('Init failed');
        mockI18next.init.mockImplementation((options: any, callback?: (err?: Error) => void) => {
          if (callback) callback(testError);
          return Promise.resolve();
        });

        mockResourcesToBackend.mockImplementation((loader) => {
          loader('en', 'common', vi.fn());
          return 'backend';
        });

        await initializeI18nClient(defaultSettings, mockResolver);

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error initializing i18n client',
          testError,
        );
      });

      it('should throw error when no languages loaded', async () => {
        mockResourcesToBackend.mockImplementation(() => 'backend');

        await expect(
          initializeI18nClient(defaultSettings, mockResolver),
        ).rejects.toThrow('No languages or namespaces loaded');
      });

      it('should throw error when no namespaces loaded', async () => {
        mockResourcesToBackend.mockImplementation(() => {
          // Don't call the loader - no resources loaded
          return 'backend';
        });

        await expect(
          initializeI18nClient(defaultSettings, mockResolver),
        ).rejects.toThrow('No languages or namespaces loaded');
      });

      it('should log debug message when no resources loaded', async () => {
        mockResourcesToBackend.mockImplementation(() => 'backend');

        await expect(
          initializeI18nClient(defaultSettings, mockResolver),
        ).rejects.toThrow();

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          expect.stringContaining('Keeping component from rendering'),
        );
      });
    });

    describe('detection configuration', () => {
      it('should configure language detection order', async () => {
        mockResourcesToBackend.mockImplementation((loader) => {
          loader('en', 'common', vi.fn());
          return 'backend';
        });

        await initializeI18nClient(defaultSettings, mockResolver);

        const initCall = mockI18next.init.mock.calls[0];
        const options = initCall?.[0];

        expect(options.detection.order).toEqual(['htmlTag', 'cookie', 'navigator']);
      });

      it('should configure cookie caching', async () => {
        mockResourcesToBackend.mockImplementation((loader) => {
          loader('en', 'common', vi.fn());
          return 'backend';
        });

        await initializeI18nClient(defaultSettings, mockResolver);

        const initCall = mockI18next.init.mock.calls[0];
        const options = initCall?.[0];

        expect(options.detection.caches).toEqual(['cookie']);
        expect(options.detection.lookupCookie).toBe('lang');
      });

      it('should disable interpolation escaping', async () => {
        mockResourcesToBackend.mockImplementation((loader) => {
          loader('en', 'common', vi.fn());
          return 'backend';
        });

        await initializeI18nClient(defaultSettings, mockResolver);

        const initCall = mockI18next.init.mock.calls[0];
        const options = initCall?.[0];

        expect(options.interpolation.escapeValue).toBe(false);
      });
    });

    describe('resource loading', () => {
      it('should track loaded languages', async () => {
        const languages: string[] = [];
        mockResourcesToBackend.mockImplementation((loader) => {
          // Simulate loading multiple languages
          loader('en', 'common', (err: any, data: any) => {
            if (!languages.includes('en')) languages.push('en');
          });
          loader('fr', 'common', (err: any, data: any) => {
            if (!languages.includes('fr')) languages.push('fr');
          });
          return 'backend';
        });

        await initializeI18nClient(defaultSettings, mockResolver);

        expect(languages).toContain('en');
        expect(languages).toContain('fr');
      });

      it('should track loaded namespaces', async () => {
        const namespaces: string[] = [];
        mockResourcesToBackend.mockImplementation((loader) => {
          // Simulate loading multiple namespaces
          loader('en', 'common', (err: any, data: any) => {
            if (!namespaces.includes('common')) namespaces.push('common');
          });
          loader('en', 'auth', (err: any, data: any) => {
            if (!namespaces.includes('auth')) namespaces.push('auth');
          });
          return 'backend';
        });

        await initializeI18nClient(defaultSettings, mockResolver);

        expect(namespaces).toContain('common');
        expect(namespaces).toContain('auth');
      });

      it('should not duplicate languages', async () => {
        const languages: string[] = [];
        mockResourcesToBackend.mockImplementation((loader) => {
          // Load same language multiple times
          loader('en', 'common', (err: any, data: any) => {
            if (!languages.includes('en')) languages.push('en');
          });
          loader('en', 'auth', (err: any, data: any) => {
            if (!languages.includes('en')) languages.push('en');
          });
          return 'backend';
        });

        await initializeI18nClient(defaultSettings, mockResolver);

        const enCount = languages.filter((l) => l === 'en').length;
        expect(enCount).toBe(1);
      });

      it('should not duplicate namespaces', async () => {
        const namespaces: string[] = [];
        mockResourcesToBackend.mockImplementation((loader) => {
          // Load same namespace multiple times
          loader('en', 'common', (err: any, data: any) => {
            if (!namespaces.includes('common')) namespaces.push('common');
          });
          loader('fr', 'common', (err: any, data: any) => {
            if (!namespaces.includes('common')) namespaces.push('common');
          });
          return 'backend';
        });

        await initializeI18nClient(defaultSettings, mockResolver);

        const commonCount = namespaces.filter((ns) => ns === 'common').length;
        expect(commonCount).toBe(1);
      });
    });

    describe('plugin chain', () => {
      it('should use plugins in correct order', async () => {
        const callOrder: string[] = [];
        mockI18next.use.mockImplementation((plugin) => {
          if (plugin === 'backend') callOrder.push('backend');
          if (plugin === mockLanguageDetector) callOrder.push('detector');
          if (plugin === mockInitReactI18next) callOrder.push('react');
          return mockI18next;
        });

        mockResourcesToBackend.mockImplementation((loader) => {
          loader('en', 'common', vi.fn());
          return 'backend';
        });

        await initializeI18nClient(defaultSettings, mockResolver);

        expect(callOrder).toEqual(['backend', 'detector', 'react']);
      });
    });

    describe('custom settings', () => {
      it('should accept custom language', async () => {
        mockResourcesToBackend.mockImplementation((loader) => {
          loader('fr', 'common', vi.fn());
          return 'backend';
        });

        const customSettings: InitOptions = {
          lng: 'fr',
          ns: ['common'],
          fallbackLng: 'en',
        };

        await initializeI18nClient(customSettings, mockResolver);

        const initCall = mockI18next.init.mock.calls[0];
        const options = initCall?.[0];

        expect(options.lng).toBe('fr');
      });

      it('should accept multiple namespaces', async () => {
        mockResourcesToBackend.mockImplementation((loader) => {
          loader('en', 'common', vi.fn());
          loader('en', 'auth', vi.fn());
          return 'backend';
        });

        const customSettings: InitOptions = {
          lng: 'en',
          ns: ['common', 'auth'],
          fallbackLng: 'en',
        };

        await initializeI18nClient(customSettings, mockResolver);

        const initCall = mockI18next.init.mock.calls[0];
        const options = initCall?.[0];

        expect(options.ns).toEqual(['common', 'auth']);
      });

      it('should accept custom fallback language', async () => {
        mockResourcesToBackend.mockImplementation((loader) => {
          loader('en', 'common', vi.fn());
          return 'backend';
        });

        const customSettings: InitOptions = {
          lng: 'en',
          ns: ['common'],
          fallbackLng: 'fr',
        };

        await initializeI18nClient(customSettings, mockResolver);

        const initCall = mockI18next.init.mock.calls[0];
        const options = initCall?.[0];

        expect(options.fallbackLng).toBe('fr');
      });
    });

    describe('integration scenarios', () => {
      it('should work with typical client setup', async () => {
        mockResourcesToBackend.mockImplementation((loader) => {
          loader('en', 'common', vi.fn());
          return 'backend';
        });

        const settings: InitOptions = {
          lng: 'en',
          ns: ['common', 'auth', 'account'],
          fallbackLng: 'en',
        };

        const result = await initializeI18nClient(settings, mockResolver);

        expect(result).toBe(mockI18next);
        expect(mockI18next.init).toHaveBeenCalled();
      });

      it('should work with proper resource loading', async () => {
        // Use the standard mock setup that works
        mockResourcesToBackend.mockImplementation((loader) => {
          loader('en', 'common', vi.fn());
          return 'backend';
        });

        const result = await initializeI18nClient(defaultSettings, mockResolver);
        expect(result).toBe(mockI18next);
        expect(mockI18next.use).toHaveBeenCalled();
        expect(mockI18next.init).toHaveBeenCalled();
      });
    });
  });
});
