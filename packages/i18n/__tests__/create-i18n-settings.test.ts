import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createI18nSettings } from '../src/create-i18n-settings';

describe('createI18nSettings', () => {
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleDebugSpy.mockRestore();
  });

  describe('basic configuration', () => {
    it('should create settings with single language', () => {
      const settings = createI18nSettings({
        languages: ['en'],
        language: 'en',
      });

      expect(settings.supportedLngs).toEqual(['en']);
      expect(settings.lng).toBe('en');
      expect(settings.fallbackLng).toBe('en');
    });

    it('should create settings with multiple languages', () => {
      const settings = createI18nSettings({
        languages: ['en', 'es', 'fr'],
        language: 'en',
      });

      expect(settings.supportedLngs).toEqual(['en', 'es', 'fr']);
      expect(settings.lng).toBe('en');
      expect(settings.fallbackLng).toBe('en');
    });

    it('should set current language to specified value', () => {
      const settings = createI18nSettings({
        languages: ['en', 'es', 'fr'],
        language: 'es',
      });

      expect(settings.lng).toBe('es');
    });

    it('should use first language as fallback', () => {
      const settings = createI18nSettings({
        languages: ['fr', 'en', 'es'],
        language: 'es',
      });

      expect(settings.fallbackLng).toBe('fr');
    });
  });

  describe('namespaces', () => {
    it('should handle undefined namespaces', () => {
      const settings = createI18nSettings({
        languages: ['en'],
        language: 'en',
      });

      expect(settings.ns).toBeUndefined();
      expect(settings.fallbackNS).toBeUndefined();
    });

    it('should handle single namespace as string', () => {
      const settings = createI18nSettings({
        languages: ['en'],
        language: 'en',
        namespaces: 'common',
      });

      expect(settings.ns).toBe('common');
      expect(settings.fallbackNS).toBe('common');
    });

    it('should handle multiple namespaces as array', () => {
      const settings = createI18nSettings({
        languages: ['en'],
        language: 'en',
        namespaces: ['common', 'auth', 'errors'],
      });

      expect(settings.ns).toEqual(['common', 'auth', 'errors']);
      expect(settings.fallbackNS).toEqual(['common', 'auth', 'errors']);
    });

    it('should handle empty namespaces array', () => {
      const settings = createI18nSettings({
        languages: ['en'],
        language: 'en',
        namespaces: [],
      });

      expect(settings.ns).toEqual([]);
      expect(settings.fallbackNS).toEqual([]);
    });
  });

  describe('fixed settings', () => {
    it('should disable detection', () => {
      const settings = createI18nSettings({
        languages: ['en'],
        language: 'en',
      });

      expect(settings.detection).toBeUndefined();
    });

    it('should disable preload', () => {
      const settings = createI18nSettings({
        languages: ['en'],
        language: 'en',
      });

      expect(settings.preload).toBe(false);
    });

    it('should enable lowercase language codes', () => {
      const settings = createI18nSettings({
        languages: ['en'],
        language: 'en',
      });

      expect(settings.lowerCaseLng).toBe(true);
    });

    it('should enable react suspense', () => {
      const settings = createI18nSettings({
        languages: ['en'],
        language: 'en',
      });

      expect(settings.react?.useSuspense).toBe(true);
    });
  });

  describe('missingInterpolationHandler', () => {
    it('should have missing interpolation handler defined', () => {
      const settings = createI18nSettings({
        languages: ['en'],
        language: 'en',
      });

      expect(settings.missingInterpolationHandler).toBeDefined();
      expect(typeof settings.missingInterpolationHandler).toBe('function');
    });

    it('should log debug message when interpolation is missing', () => {
      const settings = createI18nSettings({
        languages: ['en'],
        language: 'en',
      });

      settings.missingInterpolationHandler?.(
        'Hello {{name}}',
        { name: undefined },
        { lng: 'en' },
      );

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        'Missing interpolation value for key: Hello {{name}}',
        { name: undefined },
        { lng: 'en' },
      );
    });

    it('should log with all provided parameters', () => {
      const settings = createI18nSettings({
        languages: ['en'],
        language: 'en',
      });

      const text = 'User: {{username}}, Age: {{age}}';
      const value = { username: 'john', age: undefined };
      const options = { lng: 'en', ns: 'common' };

      settings.missingInterpolationHandler?.(text, value, options);

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        `Missing interpolation value for key: ${text}`,
        value,
        options,
      );
    });
  });

  describe('edge cases', () => {
    it('should handle single language in array', () => {
      const settings = createI18nSettings({
        languages: ['en'],
        language: 'en',
      });

      expect(settings.supportedLngs).toHaveLength(1);
      expect(settings.fallbackLng).toBe('en');
    });

    it('should handle language codes with region', () => {
      const settings = createI18nSettings({
        languages: ['en-US', 'en-GB', 'fr-FR'],
        language: 'en-US',
      });

      expect(settings.supportedLngs).toEqual(['en-US', 'en-GB', 'fr-FR']);
      expect(settings.lng).toBe('en-US');
      expect(settings.lowerCaseLng).toBe(true); // Should lowercase
    });

    it('should handle non-English default language', () => {
      const settings = createI18nSettings({
        languages: ['ar', 'he', 'fa'],
        language: 'ar',
      });

      expect(settings.fallbackLng).toBe('ar');
      expect(settings.lng).toBe('ar');
    });

    it('should handle current language different from first', () => {
      const settings = createI18nSettings({
        languages: ['en', 'es', 'fr'],
        language: 'fr',
      });

      expect(settings.lng).toBe('fr');
      expect(settings.fallbackLng).toBe('en'); // Still uses first as fallback
    });
  });

  describe('return type validation', () => {
    it('should return object with all required i18next InitOptions', () => {
      const settings = createI18nSettings({
        languages: ['en'],
        language: 'en',
      });

      expect(settings).toHaveProperty('supportedLngs');
      expect(settings).toHaveProperty('fallbackLng');
      expect(settings).toHaveProperty('lng');
      expect(settings).toHaveProperty('preload');
      expect(settings).toHaveProperty('lowerCaseLng');
      expect(settings).toHaveProperty('detection');
      expect(settings).toHaveProperty('missingInterpolationHandler');
      expect(settings).toHaveProperty('react');
    });

    it('should have correct types for all properties', () => {
      const settings = createI18nSettings({
        languages: ['en', 'es'],
        language: 'en',
        namespaces: 'common',
      });

      expect(Array.isArray(settings.supportedLngs)).toBe(true);
      expect(typeof settings.lng).toBe('string');
      expect(typeof settings.fallbackLng).toBe('string');
      expect(typeof settings.preload).toBe('boolean');
      expect(typeof settings.lowerCaseLng).toBe('boolean');
      expect(typeof settings.missingInterpolationHandler).toBe('function');
      expect(typeof settings.react).toBe('object');
    });
  });

  describe('integration scenarios', () => {
    it('should create valid config for multi-language app', () => {
      const settings = createI18nSettings({
        languages: ['en', 'es', 'fr', 'de', 'it'],
        language: 'en',
        namespaces: ['common', 'auth', 'dashboard', 'errors'],
      });

      expect(settings.supportedLngs).toHaveLength(5);
      expect(settings.ns).toHaveLength(4);
      expect(settings.fallbackLng).toBe('en');
      expect(settings.lng).toBe('en');
    });

    it('should create valid config for single namespace app', () => {
      const settings = createI18nSettings({
        languages: ['en'],
        language: 'en',
        namespaces: 'translation',
      });

      expect(settings.ns).toBe('translation');
      expect(settings.fallbackNS).toBe('translation');
    });

    it('should create valid config without namespaces', () => {
      const settings = createI18nSettings({
        languages: ['en', 'es'],
        language: 'es',
      });

      expect(settings.ns).toBeUndefined();
      expect(settings.lng).toBe('es');
      expect(settings.supportedLngs).toEqual(['en', 'es']);
    });
  });
});
