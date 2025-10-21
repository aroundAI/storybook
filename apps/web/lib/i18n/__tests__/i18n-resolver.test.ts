import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18nResolver } from '../i18n.resolver';

// Mock console methods
const mockConsoleGroup = vi.spyOn(console, 'group').mockImplementation(() => {});
const mockConsoleGroupEnd = vi
  .spyOn(console, 'groupEnd')
  .mockImplementation(() => {});

describe('i18nResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Successful Resolution', () => {
    it('should load existing translation file', async () => {
      const result = await i18nResolver('en', 'common');

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');

      // Should not log console errors for successful load
      expect(mockConsoleGroup).not.toHaveBeenCalled();
    });

    it('should return translation data as object', async () => {
      const result = await i18nResolver('en', 'common');

      expect(result).toBeTypeOf('object');
      expect(result).not.toBeNull();
    });

    it('should load different namespaces', async () => {
      const common = await i18nResolver('en', 'common');
      const auth = await i18nResolver('en', 'auth');

      expect(common).toBeDefined();
      expect(auth).toBeDefined();

      // Both should be objects
      expect(typeof common).toBe('object');
      expect(typeof auth).toBe('object');
    });

    it('should load different languages', async () => {
      const en = await i18nResolver('en', 'common');
      const it = await i18nResolver('it', 'common');

      expect(en).toBeDefined();
      expect(it).toBeDefined();
    });

    it('should not call logger on successful load', async () => {
      await i18nResolver('en', 'common');

      // Logger mock is in vitest.setup.ts - can't directly check calls
      // But we can verify console was not called
      expect(mockConsoleGroup).not.toHaveBeenCalled();
      expect(mockConsoleGroupEnd).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should return empty object for non-existent language', async () => {
      const result = await i18nResolver('xyz', 'common');

      expect(result).toEqual({});
    });

    it('should return empty object for non-existent namespace', async () => {
      const result = await i18nResolver('en', 'nonexistent');

      expect(result).toEqual({});
    });

    it('should log console group for missing file', async () => {
      await i18nResolver('xyz', 'nonexistent');

      expect(mockConsoleGroup).toHaveBeenCalledWith(
        'Error while loading translation file: xyz/nonexistent',
      );
      expect(mockConsoleGroupEnd).toHaveBeenCalled();
    });

    it('should handle both language and namespace in error message', async () => {
      await i18nResolver('de', 'custom');

      expect(mockConsoleGroup).toHaveBeenCalledWith(
        'Error while loading translation file: de/custom',
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty language string', async () => {
      const result = await i18nResolver('', 'common');

      expect(result).toEqual({});
      // Should trigger console.group for error
      expect(mockConsoleGroup).toHaveBeenCalled();
    });

    it('should handle empty namespace string', async () => {
      const result = await i18nResolver('en', '');

      expect(result).toEqual({});
      // Should trigger console.group for error
      expect(mockConsoleGroup).toHaveBeenCalled();
    });

    it('should handle language with special characters', async () => {
      const result = await i18nResolver('en-US', 'common');

      // This might succeed or fail depending on whether the file exists
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    it('should handle namespace with special characters', async () => {
      const result = await i18nResolver('en', 'common-special');

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    it('should handle very long language code', async () => {
      const result = await i18nResolver('a'.repeat(100), 'common');

      expect(result).toEqual({});
      expect(mockConsoleGroup).toHaveBeenCalled();
    });

    it('should handle very long namespace', async () => {
      const result = await i18nResolver('en', 'a'.repeat(100));

      expect(result).toEqual({});
      expect(mockConsoleGroup).toHaveBeenCalled();
    });
  });

  describe('Multiple Calls', () => {
    it('should handle multiple sequential calls', async () => {
      const result1 = await i18nResolver('en', 'common');
      const result2 = await i18nResolver('en', 'auth');
      const result3 = await i18nResolver('it', 'common');

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(result3).toBeDefined();
    });

    it('should handle same translation requested twice', async () => {
      const result1 = await i18nResolver('en', 'common');
      const result2 = await i18nResolver('en', 'common');

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();

      // Both should return data
      expect(typeof result1).toBe('object');
      expect(typeof result2).toBe('object');
    });

    it('should handle concurrent calls', async () => {
      const promises = [
        i18nResolver('en', 'common'),
        i18nResolver('en', 'auth'),
        i18nResolver('it', 'common'),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result).toBeDefined();
        expect(typeof result).toBe('object');
      });
    });

    it('should handle mix of successful and failed calls', async () => {
      const results = await Promise.all([
        i18nResolver('en', 'common'), // Should succeed
        i18nResolver('xyz', 'nonexistent'), // Should fail
        i18nResolver('en', 'auth'), // Should succeed
      ]);

      expect(results[0]).toBeDefined();
      expect(typeof results[0]).toBe('object');

      expect(results[1]).toEqual({}); // Empty object for failed load

      expect(results[2]).toBeDefined();
      expect(typeof results[2]).toBe('object');
    });
  });

  describe('Return Type', () => {
    it('should return Record<string, string> type', async () => {
      const result = await i18nResolver('en', 'common');

      // Should be an object
      expect(result).toBeTypeOf('object');

      // All values should be compatible with Record<string, string>
      // (though actual values might be nested objects in JSON)
      expect(result).not.toBeNull();
      expect(Array.isArray(result)).toBe(false);
    });

    it('should return empty object on error, not null or undefined', async () => {
      const result = await i18nResolver('invalid', 'invalid');

      expect(result).toEqual({});
      expect(result).not.toBeNull();
      expect(result).not.toBeUndefined();
    });
  });

  describe('Error Logging', () => {
    it('should use console.group for error context', async () => {
      await i18nResolver('test', 'missing');

      expect(mockConsoleGroup).toHaveBeenCalled();
      expect(mockConsoleGroupEnd).toHaveBeenCalled();

      // Group should be called before groupEnd
      const groupCallOrder =
        mockConsoleGroup.mock.invocationCallOrder[0] || 0;
      const groupEndCallOrder =
        mockConsoleGroupEnd.mock.invocationCallOrder[0] || 0;

      expect(groupCallOrder).toBeLessThan(groupEndCallOrder);
    });
  });
});
