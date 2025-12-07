import { describe, expect, it } from 'vitest';

import { ConfigBasedTransformer } from '../src/transformers/config-based-transformer';
import type { AuditObjectConfig } from '../src/types';

describe('ConfigBasedTransformer', () => {
  describe('transform()', () => {
    describe('primitive values', () => {
      it('should return primitives unchanged', async () => {
        const config: AuditObjectConfig = { objectType: 'test' };
        const transformer = new ConfigBasedTransformer(config);

        expect(await transformer.transform('string', 'create')).toBe('string');
        expect(await transformer.transform(123, 'create')).toBe(123);
        expect(await transformer.transform(true, 'create')).toBe(true);
        expect(await transformer.transform(false, 'create')).toBe(false);
      });

      it('should return null unchanged', async () => {
        const config: AuditObjectConfig = { objectType: 'test' };
        const transformer = new ConfigBasedTransformer(config);

        expect(await transformer.transform(null, 'create')).toBe(null);
      });

      it('should return undefined unchanged', async () => {
        const config: AuditObjectConfig = { objectType: 'test' };
        const transformer = new ConfigBasedTransformer(config);

        expect(await transformer.transform(undefined, 'create')).toBe(
          undefined,
        );
      });
    });

    describe('field exclusion', () => {
      it('should exclude specified fields', async () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          excludeFields: ['password', 'secret'],
        };
        const transformer = new ConfigBasedTransformer(config);

        const data = {
          id: '123',
          name: 'John',
          password: 'secret123',
          secret: 'hidden',
          email: 'john@example.com',
        };

        const result = (await transformer.transform(data, 'create')) as Record<
          string,
          unknown
        >;

        expect(result.id).toBe('123');
        expect(result.name).toBe('John');
        expect(result.email).toBe('john@example.com');
        expect(result.password).toBeUndefined();
        expect(result.secret).toBeUndefined();
      });

      it('should handle empty excludeFields array', async () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          excludeFields: [],
        };
        const transformer = new ConfigBasedTransformer(config);

        const data = { id: '123', name: 'John' };
        const result = (await transformer.transform(data, 'create')) as Record<
          string,
          unknown
        >;

        expect(result.id).toBe('123');
        expect(result.name).toBe('John');
      });

      it('should handle excludeFields with non-existent fields', async () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          excludeFields: ['nonexistent', 'alsonothere'],
        };
        const transformer = new ConfigBasedTransformer(config);

        const data = { id: '123', name: 'John' };
        const result = (await transformer.transform(data, 'create')) as Record<
          string,
          unknown
        >;

        expect(result.id).toBe('123');
        expect(result.name).toBe('John');
      });

      it('should exclude multiple fields', async () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          excludeFields: ['field1', 'field2', 'field3'],
        };
        const transformer = new ConfigBasedTransformer(config);

        const data = {
          field1: 'value1',
          field2: 'value2',
          field3: 'value3',
          field4: 'value4',
          field5: 'value5',
        };

        const result = (await transformer.transform(data, 'create')) as Record<
          string,
          unknown
        >;

        expect(result.field1).toBeUndefined();
        expect(result.field2).toBeUndefined();
        expect(result.field3).toBeUndefined();
        expect(result.field4).toBe('value4');
        expect(result.field5).toBe('value5');
      });
    });

    describe('field inclusion', () => {
      it('should include only specified fields', async () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          includeFields: ['id', 'name', 'email'],
        };
        const transformer = new ConfigBasedTransformer(config);

        const data = {
          id: '123',
          name: 'John',
          email: 'john@example.com',
          password: 'secret',
          phone: '555-1234',
          address: '123 Main St',
        };

        const result = (await transformer.transform(data, 'create')) as Record<
          string,
          unknown
        >;

        expect(result.id).toBe('123');
        expect(result.name).toBe('John');
        expect(result.email).toBe('john@example.com');
        expect(result.password).toBeUndefined();
        expect(result.phone).toBeUndefined();
        expect(result.address).toBeUndefined();
      });

      it('should handle empty includeFields array (includes all)', async () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          includeFields: [],
        };
        const transformer = new ConfigBasedTransformer(config);

        const data = { id: '123', name: 'John' };
        const result = (await transformer.transform(data, 'create')) as Record<
          string,
          unknown
        >;

        // Empty includeFields array doesn't trigger filtering
        expect(result.id).toBe('123');
        expect(result.name).toBe('John');
      });

      it('should handle includeFields with non-existent fields', async () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          includeFields: ['id', 'nonexistent', 'alsonothere'],
        };
        const transformer = new ConfigBasedTransformer(config);

        const data = { id: '123', name: 'John' };
        const result = (await transformer.transform(data, 'create')) as Record<
          string,
          unknown
        >;

        expect(result.id).toBe('123');
        expect(result.name).toBeUndefined();
        expect(result.nonexistent).toBeUndefined();
      });

      it('should apply excludeFields before includeFields', async () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          includeFields: ['id', 'name'],
          excludeFields: ['password', 'id'], // id excluded first, then included (but already deleted)
        };
        const transformer = new ConfigBasedTransformer(config);

        const data = {
          id: '123',
          name: 'John',
          password: 'secret',
          email: 'john@example.com',
        };

        const result = (await transformer.transform(data, 'create')) as Record<
          string,
          unknown
        >;

        // excludeFields applied first, so 'id' is deleted before includeFields tries to include it
        expect(result.id).toBeUndefined(); // Excluded before inclusion
        expect(result.name).toBe('John');
        expect(result.password).toBeUndefined();
        expect(result.email).toBeUndefined();
      });
    });

    describe('sensitive field redaction', () => {
      it('should redact sensitive fields', async () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          sensitiveFields: ['password', 'api_key'],
        };
        const transformer = new ConfigBasedTransformer(config);

        const data = {
          id: '123',
          name: 'John',
          password: 'secret123',
          api_key: 'key_456',
        };

        const result = (await transformer.transform(data, 'create')) as Record<
          string,
          unknown
        >;

        expect(result.id).toBe('123');
        expect(result.name).toBe('John');
        expect(result.password).toBe('***REDACTED***');
        expect(result.api_key).toBe('***REDACTED***');
      });

      it('should redact after field inclusion', async () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          includeFields: ['id', 'password'],
          sensitiveFields: ['password'],
        };
        const transformer = new ConfigBasedTransformer(config);

        const data = {
          id: '123',
          password: 'secret',
          other: 'value',
        };

        const result = (await transformer.transform(data, 'create')) as Record<
          string,
          unknown
        >;

        expect(result.id).toBe('123');
        expect(result.password).toBe('***REDACTED***');
        expect(result.other).toBeUndefined();
      });

      it('should redact after field exclusion', async () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          excludeFields: ['api_key'],
          sensitiveFields: ['password'],
        };
        const transformer = new ConfigBasedTransformer(config);

        const data = {
          id: '123',
          password: 'secret',
          api_key: 'key_123',
        };

        const result = (await transformer.transform(data, 'create')) as Record<
          string,
          unknown
        >;

        expect(result.id).toBe('123');
        expect(result.password).toBe('***REDACTED***');
        expect(result.api_key).toBeUndefined(); // Excluded, not redacted
      });

      it('should handle empty sensitiveFields array', async () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          sensitiveFields: [],
        };
        const transformer = new ConfigBasedTransformer(config);

        const data = { password: 'secret' };
        const result = (await transformer.transform(data, 'create')) as Record<
          string,
          unknown
        >;

        expect(result.password).toBe('secret');
      });

      it('should handle sensitiveFields with non-existent fields', async () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          sensitiveFields: ['nonexistent'],
        };
        const transformer = new ConfigBasedTransformer(config);

        const data = { id: '123' };
        const result = (await transformer.transform(data, 'create')) as Record<
          string,
          unknown
        >;

        expect(result.id).toBe('123');
      });

      it('should redact multiple sensitive fields', async () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          sensitiveFields: ['field1', 'field2', 'field3'],
        };
        const transformer = new ConfigBasedTransformer(config);

        const data = {
          field1: 'secret1',
          field2: 'secret2',
          field3: 'secret3',
          field4: 'public',
        };

        const result = (await transformer.transform(data, 'create')) as Record<
          string,
          unknown
        >;

        expect(result.field1).toBe('***REDACTED***');
        expect(result.field2).toBe('***REDACTED***');
        expect(result.field3).toBe('***REDACTED***');
        expect(result.field4).toBe('public');
      });
    });

    describe('combined configurations', () => {
      it('should apply exclude, include, and redact together', async () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          excludeFields: ['internal_notes'],
          includeFields: ['id', 'name', 'password'],
          sensitiveFields: ['password'],
        };
        const transformer = new ConfigBasedTransformer(config);

        const data = {
          id: '123',
          name: 'John',
          password: 'secret',
          email: 'john@example.com',
          internal_notes: 'Private notes',
        };

        const result = (await transformer.transform(data, 'create')) as Record<
          string,
          unknown
        >;

        // includeFields takes precedence over excludeFields
        expect(result.id).toBe('123');
        expect(result.name).toBe('John');
        expect(result.password).toBe('***REDACTED***');
        expect(result.email).toBeUndefined();
        expect(result.internal_notes).toBeUndefined();
      });

      it('should redact even with empty includeFields array', async () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          includeFields: [],
          sensitiveFields: ['password'],
        };
        const transformer = new ConfigBasedTransformer(config);

        const data = { id: '123', password: 'secret' };
        const result = (await transformer.transform(data, 'create')) as Record<
          string,
          unknown
        >;

        // Empty includeFields doesn't filter, so all fields present (with redaction)
        expect(result.id).toBe('123');
        expect(result.password).toBe('***REDACTED***');
      });
    });

    describe('edge cases', () => {
      it('should handle empty object', async () => {
        const config: AuditObjectConfig = { objectType: 'test' };
        const transformer = new ConfigBasedTransformer(config);

        const result = (await transformer.transform({}, 'create')) as Record<
          string,
          unknown
        >;

        expect(result).toEqual({});
      });

      it('should not mutate original object', async () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          excludeFields: ['password'],
        };
        const transformer = new ConfigBasedTransformer(config);

        const data = { id: '123', password: 'secret' };
        await transformer.transform(data, 'create');

        // Original object should not be modified
        expect(data.password).toBe('secret');
      });

      it('should handle nested objects (shallow copy)', async () => {
        const config: AuditObjectConfig = { objectType: 'test' };
        const transformer = new ConfigBasedTransformer(config);

        const data = {
          id: '123',
          nested: { key: 'value' },
        };

        const result = (await transformer.transform(data, 'create')) as Record<
          string,
          unknown
        >;

        expect(result.nested).toEqual({ key: 'value' });
      });

      it('should handle arrays', async () => {
        const config: AuditObjectConfig = { objectType: 'test' };
        const transformer = new ConfigBasedTransformer(config);

        const data = {
          id: '123',
          tags: ['tag1', 'tag2'],
        };

        const result = (await transformer.transform(data, 'create')) as Record<
          string,
          unknown
        >;

        expect(result.tags).toEqual(['tag1', 'tag2']);
      });
    });
  });

  describe('calculateChanges()', () => {
    describe('invalid inputs', () => {
      it('should return empty object for non-object before', () => {
        const config: AuditObjectConfig = { objectType: 'test' };
        const transformer = new ConfigBasedTransformer(config);

        const changes = transformer.calculateChanges('string', {
          name: 'After',
        });

        expect(changes).toEqual({});
      });

      it('should return empty object for non-object after', () => {
        const config: AuditObjectConfig = { objectType: 'test' };
        const transformer = new ConfigBasedTransformer(config);

        const changes = transformer.calculateChanges(
          { name: 'Before' },
          'string',
        );

        expect(changes).toEqual({});
      });

      it('should return empty object for null before', () => {
        const config: AuditObjectConfig = { objectType: 'test' };
        const transformer = new ConfigBasedTransformer(config);

        const changes = transformer.calculateChanges(null, { name: 'After' });

        expect(changes).toEqual({});
      });

      it('should return empty object for null after', () => {
        const config: AuditObjectConfig = { objectType: 'test' };
        const transformer = new ConfigBasedTransformer(config);

        const changes = transformer.calculateChanges({ name: 'Before' }, null);

        expect(changes).toEqual({});
      });
    });

    describe('field change detection', () => {
      it('should detect value changes', () => {
        const config: AuditObjectConfig = { objectType: 'test' };
        const transformer = new ConfigBasedTransformer(config);

        const before = { name: 'Old Name', age: 30 };
        const after = { name: 'New Name', age: 31 };

        const changes = transformer.calculateChanges(before, after);

        expect(changes.name).toEqual({
          before: 'Old Name',
          after: 'New Name',
        });
        expect(changes.age).toEqual({
          before: 30,
          after: 31,
        });
      });

      it('should not report unchanged fields', () => {
        const config: AuditObjectConfig = { objectType: 'test' };
        const transformer = new ConfigBasedTransformer(config);

        const before = { name: 'Same', age: 30 };
        const after = { name: 'Same', age: 31 };

        const changes = transformer.calculateChanges(before, after);

        expect(changes.name).toBeUndefined();
        expect(changes.age).toEqual({ before: 30, after: 31 });
      });

      it('should detect new fields in after', () => {
        const config: AuditObjectConfig = { objectType: 'test' };
        const transformer = new ConfigBasedTransformer(config);

        const before = { name: 'John' };
        const after = { name: 'John', email: 'john@example.com' };

        const changes = transformer.calculateChanges(before, after);

        expect(changes.email).toEqual({
          before: undefined,
          after: 'john@example.com',
        });
      });

      it('should detect removed fields', () => {
        const config: AuditObjectConfig = { objectType: 'test' };
        const transformer = new ConfigBasedTransformer(config);

        const before = { name: 'John', email: 'john@example.com' };
        const after = { name: 'John' };

        const changes = transformer.calculateChanges(before, after);

        expect(changes.email).toEqual({
          before: 'john@example.com',
          after: undefined,
        });
      });
    });

    describe('field filtering in changes', () => {
      it('should skip excluded fields in change detection', () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          excludeFields: ['password'],
        };
        const transformer = new ConfigBasedTransformer(config);

        const before = { name: 'Old', password: 'old_pass' };
        const after = { name: 'New', password: 'new_pass' };

        const changes = transformer.calculateChanges(before, after);

        expect(changes.name).toEqual({ before: 'Old', after: 'New' });
        expect(changes.password).toBeUndefined();
      });

      it('should only track included fields', () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          includeFields: ['name', 'email'],
        };
        const transformer = new ConfigBasedTransformer(config);

        const before = { name: 'Old', email: 'old@example.com', age: 30 };
        const after = { name: 'New', email: 'new@example.com', age: 31 };

        const changes = transformer.calculateChanges(before, after);

        expect(changes.name).toEqual({ before: 'Old', after: 'New' });
        expect(changes.email).toEqual({
          before: 'old@example.com',
          after: 'new@example.com',
        });
        expect(changes.age).toBeUndefined();
      });

      it('should track all fields with empty includeFields', () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          includeFields: [],
        };
        const transformer = new ConfigBasedTransformer(config);

        const before = { name: 'Old' };
        const after = { name: 'New' };

        const changes = transformer.calculateChanges(before, after);

        // Empty includeFields doesn't filter, so tracks all changes
        expect(changes.name).toEqual({ before: 'Old', after: 'New' });
      });
    });

    describe('sensitive field redaction in changes', () => {
      it('should redact sensitive field values in changes', () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          sensitiveFields: ['password'],
        };
        const transformer = new ConfigBasedTransformer(config);

        const before = { password: 'old_secret' };
        const after = { password: 'new_secret' };

        const changes = transformer.calculateChanges(before, after);

        expect(changes.password).toEqual({
          before: '***REDACTED***',
          after: '***REDACTED***',
        });
      });

      it('should redact only sensitive fields', () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          sensitiveFields: ['password'],
        };
        const transformer = new ConfigBasedTransformer(config);

        const before = { name: 'Old', password: 'old_secret' };
        const after = { name: 'New', password: 'new_secret' };

        const changes = transformer.calculateChanges(before, after);

        expect(changes.name).toEqual({ before: 'Old', after: 'New' });
        expect(changes.password).toEqual({
          before: '***REDACTED***',
          after: '***REDACTED***',
        });
      });

      it('should redact sensitive fields with empty sensitiveFields array', () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          sensitiveFields: [],
        };
        const transformer = new ConfigBasedTransformer(config);

        const before = { password: 'old_secret' };
        const after = { password: 'new_secret' };

        const changes = transformer.calculateChanges(before, after);

        expect(changes.password).toEqual({
          before: 'old_secret',
          after: 'new_secret',
        });
      });
    });

    describe('combined configurations in changes', () => {
      it('should apply exclude, include, and redact in change detection', () => {
        const config: AuditObjectConfig = {
          objectType: 'test',
          excludeFields: ['internal_notes'],
          includeFields: ['name', 'password'],
          sensitiveFields: ['password'],
        };
        const transformer = new ConfigBasedTransformer(config);

        const before = {
          name: 'Old',
          password: 'old_pass',
          email: 'old@example.com',
          internal_notes: 'Old notes',
        };
        const after = {
          name: 'New',
          password: 'new_pass',
          email: 'new@example.com',
          internal_notes: 'New notes',
        };

        const changes = transformer.calculateChanges(before, after);

        expect(changes.name).toEqual({ before: 'Old', after: 'New' });
        expect(changes.password).toEqual({
          before: '***REDACTED***',
          after: '***REDACTED***',
        });
        expect(changes.email).toBeUndefined(); // Not in includeFields
        expect(changes.internal_notes).toBeUndefined(); // In excludeFields
      });
    });

    describe('edge cases', () => {
      it('should handle empty objects', () => {
        const config: AuditObjectConfig = { objectType: 'test' };
        const transformer = new ConfigBasedTransformer(config);

        const changes = transformer.calculateChanges({}, {});

        expect(changes).toEqual({});
      });

      it('should handle no changes', () => {
        const config: AuditObjectConfig = { objectType: 'test' };
        const transformer = new ConfigBasedTransformer(config);

        const data = { name: 'Same', age: 30 };
        const changes = transformer.calculateChanges(data, data);

        expect(changes).toEqual({});
      });

      it('should handle null to value changes', () => {
        const config: AuditObjectConfig = { objectType: 'test' };
        const transformer = new ConfigBasedTransformer(config);

        const before = { name: null };
        const after = { name: 'John' };

        const changes = transformer.calculateChanges(before, after);

        expect(changes.name).toEqual({ before: null, after: 'John' });
      });

      it('should handle value to null changes', () => {
        const config: AuditObjectConfig = { objectType: 'test' };
        const transformer = new ConfigBasedTransformer(config);

        const before = { name: 'John' };
        const after = { name: null };

        const changes = transformer.calculateChanges(before, after);

        expect(changes.name).toEqual({ before: 'John', after: null });
      });
    });
  });
});
