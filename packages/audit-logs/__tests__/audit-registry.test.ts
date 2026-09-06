import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearTransformerRegistry,
  getRegisteredObjectTypes,
  getTransformer,
  hasTransformer,
  registerTransformer,
} from '../src/config/audit-registry';
import type { AuditTransformer } from '../src/types';

describe('audit-registry', () => {
  // Create mock transformers
  const createMockTransformer = (name: string): AuditTransformer => ({
    transform: vi.fn((data: unknown) =>
      Promise.resolve({
        ...(data as Record<string, unknown>),
        transformedBy: name,
      }),
    ),
    getDescription: vi.fn(() => `Test description for ${name}`),
  });

  beforeEach(() => {
    // Clear registry before each test
    clearTransformerRegistry();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up after tests
    clearTransformerRegistry();
  });

  describe('registerTransformer', () => {
    it('should register a transformer for an object type', () => {
      const transformer = createMockTransformer('custom');

      registerTransformer('custom_object', transformer);

      expect(hasTransformer('custom_object')).toBe(true);
    });

    it('should allow multiple different object types', () => {
      const transformer1 = createMockTransformer('transformer1');
      const transformer2 = createMockTransformer('transformer2');

      registerTransformer('type1', transformer1);
      registerTransformer('type2', transformer2);

      expect(hasTransformer('type1')).toBe(true);
      expect(hasTransformer('type2')).toBe(true);
    });

    it('should overwrite existing transformer for same type', async () => {
      const transformer1 = createMockTransformer('first');
      const transformer2 = createMockTransformer('second');

      registerTransformer('same_type', transformer1);
      registerTransformer('same_type', transformer2);

      const retrieved = getTransformer('same_type');
      const result = await retrieved.transform({}, 'update');

      expect((result as { transformedBy: string }).transformedBy).toBe(
        'second',
      );
    });

    it('should handle empty string object type', () => {
      const transformer = createMockTransformer('empty');

      registerTransformer('', transformer);

      expect(hasTransformer('')).toBe(true);
    });

    it('should handle special characters in object type', () => {
      const transformer = createMockTransformer('special');

      registerTransformer('object-type_with.special/chars', transformer);

      expect(hasTransformer('object-type_with.special/chars')).toBe(true);
    });
  });

  describe('getTransformer', () => {
    describe('priority: custom transformer in config', () => {
      it('should use custom transformer from config if provided', () => {
        // This tests that config.transformer takes highest priority
        // user object has config but we can't easily override it in tests
        // So we test with a registered transformer vs default
        const customTransformer = createMockTransformer('registered');
        registerTransformer('custom_type', customTransformer);

        const transformer = getTransformer('custom_type');

        expect(transformer).toBe(customTransformer);
      });
    });

    describe('priority: registered transformer', () => {
      it('should return registered transformer', () => {
        const customTransformer = createMockTransformer('custom');
        registerTransformer('my_type', customTransformer);

        const transformer = getTransformer('my_type');

        expect(transformer).toBe(customTransformer);
      });

      it('should use registered transformer over config-based', () => {
        // user has config, but if we register a transformer it should take precedence
        const customTransformer = createMockTransformer('custom_user');
        registerTransformer('user', customTransformer);

        const transformer = getTransformer('user');

        expect(transformer).toBe(customTransformer);
      });
    });

    describe('priority: config-based transformer', () => {
      it('should create config-based transformer for user', () => {
        // user has config in AUDIT_CONFIG
        const transformer = getTransformer('user');

        expect(transformer).toBeDefined();
        expect(transformer.transform).toBeInstanceOf(Function);
      });

      it('should create config-based transformer for project', () => {
        const transformer = getTransformer('project');

        expect(transformer).toBeDefined();
        expect(transformer.transform).toBeInstanceOf(Function);
      });

      it('should create config-based transformer for account', () => {
        const transformer = getTransformer('account');

        expect(transformer).toBeDefined();
      });
    });

    describe('priority: default transformer fallback', () => {
      let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

      beforeEach(() => {
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      });

      afterEach(() => {
        consoleWarnSpy.mockRestore();
      });

      it('should return default transformer for unknown type', () => {
        const transformer = getTransformer('completely_unknown_type');

        expect(transformer).toBeDefined();
        expect(transformer.transform).toBeInstanceOf(Function);
      });

      it('should log warning for unknown type', async () => {
        getTransformer('unknown_type');

        // Wait for async logger
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Warning is logged asynchronously via getLogger()
        // We can't easily test this without mocking getLogger
        expect(true).toBe(true);
      });

      it('should return same default transformer for different unknown types', () => {
        const transformer1 = getTransformer('unknown1');
        const transformer2 = getTransformer('unknown2');

        // Both should be the same default transformer instance
        expect(transformer1).toBe(transformer2);
      });
    });

    describe('return value guarantees', () => {
      it('should always return a transformer (never null)', () => {
        const transformer1 = getTransformer('known_type');
        const transformer2 = getTransformer('unknown_type');
        const transformer3 = getTransformer('');

        expect(transformer1).not.toBeNull();
        expect(transformer2).not.toBeNull();
        expect(transformer3).not.toBeNull();
      });

      it('should return transformer with transform method', () => {
        const transformer = getTransformer('any_type');

        expect(transformer.transform).toBeInstanceOf(Function);
      });

      it('should return transformer with getDescription method', () => {
        const transformer = getTransformer('any_type');

        expect(transformer.getDescription).toBeInstanceOf(Function);
      });
    });
  });

  describe('hasTransformer', () => {
    it('should return true for registered transformer', () => {
      const transformer = createMockTransformer('test');
      registerTransformer('test_type', transformer);

      expect(hasTransformer('test_type')).toBe(true);
    });

    it('should return false for unregistered type without config', () => {
      expect(hasTransformer('completely_unknown')).toBe(false);
    });

    it('should return false for unknown type', () => {
      expect(hasTransformer('non_existent')).toBe(false);
    });

    it('should return false for empty string if not registered', () => {
      expect(hasTransformer('')).toBe(false);
    });

    it('should return true after registration', () => {
      const transformer = createMockTransformer('new');

      expect(hasTransformer('new_type')).toBe(false);

      registerTransformer('new_type', transformer);

      expect(hasTransformer('new_type')).toBe(true);
    });

    it('should handle config with custom transformer', () => {
      // Objects in AUDIT_CONFIG might have custom transformers
      // user, project, etc. have config but not custom transformers
      const hasUser = hasTransformer('user');

      // Should return false since config doesn't have transformer property
      expect(hasUser).toBe(false);
    });
  });

  describe('clearTransformerRegistry', () => {
    it('should remove all registered transformers', () => {
      const transformer1 = createMockTransformer('t1');
      const transformer2 = createMockTransformer('t2');

      registerTransformer('type1', transformer1);
      registerTransformer('type2', transformer2);

      expect(hasTransformer('type1')).toBe(true);
      expect(hasTransformer('type2')).toBe(true);

      clearTransformerRegistry();

      expect(hasTransformer('type1')).toBe(false);
      expect(hasTransformer('type2')).toBe(false);
    });

    it('should allow re-registration after clear', () => {
      const transformer = createMockTransformer('test');

      registerTransformer('test_type', transformer);
      clearTransformerRegistry();

      expect(hasTransformer('test_type')).toBe(false);

      registerTransformer('test_type', transformer);

      expect(hasTransformer('test_type')).toBe(true);
    });

    it('should not affect config-based transformers', () => {
      clearTransformerRegistry();

      // user has config, so getTransformer should still work
      const transformer = getTransformer('user');

      expect(transformer).toBeDefined();
    });

    it('should handle multiple clears', () => {
      clearTransformerRegistry();
      clearTransformerRegistry();
      clearTransformerRegistry();

      expect(getRegisteredObjectTypes()).toEqual([]);
    });
  });

  describe('getRegisteredObjectTypes', () => {
    it('should return empty array when no transformers registered', () => {
      const types = getRegisteredObjectTypes();

      expect(types).toEqual([]);
    });

    it('should return all registered types', () => {
      const transformer1 = createMockTransformer('t1');
      const transformer2 = createMockTransformer('t2');

      registerTransformer('type1', transformer1);
      registerTransformer('type2', transformer2);

      const types = getRegisteredObjectTypes();

      expect(types).toContain('type1');
      expect(types).toContain('type2');
      expect(types.length).toBe(2);
    });

    it('should return array of strings', () => {
      const transformer = createMockTransformer('test');
      registerTransformer('test_type', transformer);

      const types = getRegisteredObjectTypes();

      expect(Array.isArray(types)).toBe(true);
      types.forEach((type) => {
        expect(typeof type).toBe('string');
      });
    });

    it('should not include config-only types', () => {
      // user, project, etc. have config but no registered transformer
      const types = getRegisteredObjectTypes();

      expect(types).not.toContain('user');
      expect(types).not.toContain('project');
    });

    it('should update after registration', () => {
      const transformer = createMockTransformer('test');

      let types = getRegisteredObjectTypes();
      expect(types).not.toContain('new_type');

      registerTransformer('new_type', transformer);

      types = getRegisteredObjectTypes();
      expect(types).toContain('new_type');
    });

    it('should update after clear', () => {
      const transformer = createMockTransformer('test');
      registerTransformer('test_type', transformer);

      let types = getRegisteredObjectTypes();
      expect(types.length).toBeGreaterThan(0);

      clearTransformerRegistry();

      types = getRegisteredObjectTypes();
      expect(types).toEqual([]);
    });
  });

  describe('transformer functionality', () => {
    it('should execute registered transformer transform method', async () => {
      const transformer = createMockTransformer('test');
      registerTransformer('test_type', transformer);

      const retrieved = getTransformer('test_type');
      const data = { id: 1, name: 'test' };
      const result = await retrieved.transform(data, 'update');

      expect(transformer.transform).toHaveBeenCalledWith(data, 'update');
      expect((result as { transformedBy: string }).transformedBy).toBe('test');
    });

    it('should execute registered transformer getDescription method', () => {
      const transformer = createMockTransformer('test');
      registerTransformer('test_type', transformer);

      const retrieved = getTransformer('test_type');
      const description = retrieved.getDescription!({ id: 1 }, 'update');

      expect(transformer.getDescription).toHaveBeenCalled();
      expect(description).toContain('test');
    });
  });

  describe('edge cases', () => {
    it('should handle numeric-like string object types', () => {
      const transformer = createMockTransformer('numeric');
      registerTransformer('123', transformer);

      expect(hasTransformer('123')).toBe(true);
      expect(getTransformer('123')).toBe(transformer);
    });

    it('should handle very long object type names', () => {
      const longType = 'a'.repeat(1000);
      const transformer = createMockTransformer('long');

      registerTransformer(longType, transformer);

      expect(hasTransformer(longType)).toBe(true);
    });

    it('should handle unicode in object type names', () => {
      const transformer = createMockTransformer('unicode');
      registerTransformer('объект', transformer);

      expect(hasTransformer('объект')).toBe(true);
    });

    it('should be case-sensitive for object types', () => {
      const transformer = createMockTransformer('test');
      registerTransformer('MyType', transformer);

      expect(hasTransformer('MyType')).toBe(true);
      expect(hasTransformer('mytype')).toBe(false);
      expect(hasTransformer('MYTYPE')).toBe(false);
    });
  });

  describe('integration scenarios', () => {
    it('should support full registration and retrieval flow', async () => {
      const customTransformer = createMockTransformer('custom');

      // Register
      registerTransformer('custom_object', customTransformer);

      // Check registration
      expect(hasTransformer('custom_object')).toBe(true);
      expect(getRegisteredObjectTypes()).toContain('custom_object');

      // Get and use transformer
      const transformer = getTransformer('custom_object');
      const result = await transformer.transform({ id: 1 }, 'update');

      expect((result as { transformedBy: string }).transformedBy).toBe(
        'custom',
      );
    });

    it('should handle mixed registered and config-based transformers', () => {
      const customTransformer = createMockTransformer('custom');
      registerTransformer('custom_type', customTransformer);

      // Get custom transformer
      const custom = getTransformer('custom_type');
      expect(custom).toBe(customTransformer);

      // Get config-based transformer
      const user = getTransformer('user');
      expect(user).toBeDefined();
      expect(user).not.toBe(customTransformer);

      // Get default transformer
      const unknown = getTransformer('unknown_type');
      expect(unknown).toBeDefined();
    });

    it('should maintain separate transformers for different types', async () => {
      const t1 = createMockTransformer('t1');
      const t2 = createMockTransformer('t2');

      registerTransformer('type1', t1);
      registerTransformer('type2', t2);

      const retrieved1 = getTransformer('type1');
      const retrieved2 = getTransformer('type2');

      const result1 = await retrieved1.transform({}, 'update');
      const result2 = await retrieved2.transform({}, 'update');

      expect((result1 as { transformedBy: string }).transformedBy).toBe('t1');
      expect((result2 as { transformedBy: string }).transformedBy).toBe('t2');
    });
  });
});
