import { describe, expect, it } from 'vitest';

import { initializeAuditTransformers } from '../src/transformers';
import { accountTransformer } from '../src/transformers/account-transformer';
import { defaultTransformer } from '../src/transformers/default-transformer';
import { userTransformer } from '../src/transformers/user-transformer';

describe('Audit Transformers', () => {
  describe('defaultTransformer', () => {
    describe('transform()', () => {
      it('should return primitive values unchanged', async () => {
        expect(await defaultTransformer.transform('hello', 'create')).toBe(
          'hello',
        );
        expect(await defaultTransformer.transform(123, 'create')).toBe(123);
        expect(await defaultTransformer.transform(true, 'create')).toBe(true);
        expect(await defaultTransformer.transform(null, 'create')).toBe(null);
      });

      it('should redact sensitive fields', async () => {
        const data = {
          id: '123',
          name: 'John Doe',
          password: 'secret123',
          api_key: 'key_123',
          access_token: 'token_456',
        };

        const result = (await defaultTransformer.transform(
          data,
          'create',
        )) as Record<string, unknown>;

        expect(result.id).toBe('123');
        expect(result.name).toBe('John Doe');
        expect(result.password).toBe('***REDACTED***');
        expect(result.api_key).toBe('***REDACTED***');
        expect(result.access_token).toBe('***REDACTED***');
      });

      it('should redact PII fields', async () => {
        const data = {
          id: '123',
          name: 'John',
          email: 'john@example.com',
          phone: '+1234567890',
          address: '123 Main St',
          ip_address: '192.168.1.1',
        };

        const result = (await defaultTransformer.transform(
          data,
          'create',
        )) as Record<string, unknown>;

        expect(result.id).toBe('123');
        expect(result.name).toBe('John');
        expect(result.email).toBe('***REDACTED***');
        expect(result.phone).toBe('***REDACTED***');
        expect(result.address).toBe('***REDACTED***');
        expect(result.ip_address).toBe('***REDACTED***');
      });

      it('should exclude metadata and raw fields', async () => {
        const data = {
          id: '123',
          name: 'Test',
          metadata: { some: 'data' },
          raw_data: 'sensitive',
          encrypted_field: 'encrypted',
          hashed_password: 'hash',
        };

        const result = (await defaultTransformer.transform(
          data,
          'create',
        )) as Record<string, unknown>;

        expect(result.id).toBe('123');
        expect(result.name).toBe('Test');
        expect(result.metadata).toBeUndefined();
        expect(result.raw_data).toBeUndefined();
        expect(result.encrypted_field).toBeUndefined();
        expect(result.hashed_password).toBeUndefined();
      });

      it('should include simple arrays', async () => {
        const data = {
          id: '123',
          tags: ['tag1', 'tag2', 'tag3'],
          numbers: [1, 2, 3],
          flags: [true, false, true],
        };

        const result = (await defaultTransformer.transform(
          data,
          'create',
        )) as Record<string, unknown>;

        expect(result.tags).toEqual(['tag1', 'tag2', 'tag3']);
        expect(result.numbers).toEqual([1, 2, 3]);
        expect(result.flags).toEqual([true, false, true]);
      });

      it('should exclude complex nested arrays', async () => {
        const data = {
          id: '123',
          nested: [{ foo: 'bar' }, { baz: 'qux' }],
        };

        const result = (await defaultTransformer.transform(
          data,
          'create',
        )) as Record<string, unknown>;

        expect(result.id).toBe('123');
        expect(result.nested).toBeUndefined();
      });

      it('should always include standard ID and timestamp fields', async () => {
        const data = {
          id: '123',
          uuid: 'uuid-456',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
          sensitive_field: 'secret',
        };

        const result = (await defaultTransformer.transform(
          data,
          'create',
        )) as Record<string, unknown>;

        expect(result.id).toBe('123');
        expect(result.uuid).toBe('uuid-456');
        expect(result.created_at).toBe('2024-01-01T00:00:00Z');
        expect(result.updated_at).toBe('2024-01-02T00:00:00Z');
      });

      it('should handle PII fields with null values', async () => {
        const data = {
          id: '123',
          email: null,
          phone: null,
        };

        const result = (await defaultTransformer.transform(
          data,
          'create',
        )) as Record<string, unknown>;

        expect(result.email).toBeNull();
        expect(result.phone).toBeNull();
      });
    });

    describe('getDescription()', () => {
      it('should generate description from name field', () => {
        const data = { name: 'Test Object' };
        const description = defaultTransformer.getDescription!(data, 'create');
        expect(description).toBe('create unknown object "Test Object"');
      });

      it('should generate description from title field', () => {
        const data = { title: 'Test Title' };
        const description = defaultTransformer.getDescription!(data, 'create');
        expect(description).toBe('create unknown object "Test Title"');
      });

      it('should use Unknown for missing name/title', () => {
        const data = { id: '123' };
        const description = defaultTransformer.getDescription!(data, 'update');
        expect(description).toBe('update unknown object "Unknown"');
      });
    });

    describe('calculateChanges()', () => {
      it('should return empty object for non-object inputs', () => {
        expect(
          defaultTransformer.calculateChanges!(null, { foo: 'bar' }),
        ).toEqual({});
        expect(
          defaultTransformer.calculateChanges!({ foo: 'bar' }, null),
        ).toEqual({});
      });

      it('should detect and redact sensitive field changes', () => {
        const before = {
          name: 'John',
          password: 'old_pass',
          api_key: 'old_key',
        };
        const after = {
          name: 'Jane',
          password: 'new_pass',
          api_key: 'new_key',
        };

        const changes = defaultTransformer.calculateChanges!(before, after);

        expect(changes.name).toEqual({ before: 'John', after: 'Jane' });
        expect(changes.password).toEqual({
          before: '***REDACTED***',
          after: '***REDACTED***',
        });
        expect(changes.api_key).toEqual({
          before: '***REDACTED***',
          after: '***REDACTED***',
        });
      });

      it('should skip metadata and raw fields', () => {
        const before = {
          name: 'Test',
          metadata: { old: 'data' },
          raw_data: 'old',
        };
        const after = {
          name: 'Test',
          metadata: { new: 'data' },
          raw_data: 'new',
        };

        const changes = defaultTransformer.calculateChanges!(before, after);

        expect(changes.metadata).toBeUndefined();
        expect(changes.raw_data).toBeUndefined();
      });

      it('should detect added and removed fields', () => {
        const before = { name: 'Test', oldField: 'value' };
        const after = { name: 'Test', newField: 'value' };

        const changes = defaultTransformer.calculateChanges!(before, after);

        expect(changes.oldField).toEqual({ before: 'value', after: undefined });
        expect(changes.newField).toEqual({ before: undefined, after: 'value' });
      });
    });
  });

  describe('accountTransformer', () => {
    describe('transform()', () => {
      it('should return primitive values unchanged', async () => {
        expect(await accountTransformer.transform('hello', 'create')).toBe(
          'hello',
        );
        expect(await accountTransformer.transform(null, 'create')).toBe(null);
      });

      it('should extract safe account fields', async () => {
        const account = {
          id: 'acc-123',
          name: 'Acme Corp',
          slug: 'acme-corp',
          picture_url: 'https://example.com/logo.png',
          is_personal_account: false,
          email: 'contact@acme.com',
          primary_owner_user_id: 'user-456',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
          billing_data: { secret: 'info' },
          public_data: { huge: 'object' },
        };

        const result = (await accountTransformer.transform(
          account,
          'create',
        )) as Record<string, unknown>;

        expect(result.id).toBe('acc-123');
        expect(result.name).toBe('Acme Corp');
        expect(result.slug).toBe('acme-corp');
        expect(result.picture_url).toBe('https://example.com/logo.png');
        expect(result.is_personal_account).toBe(false);
        expect(result.email).toBe('contact@acme.com');
        expect(result.primary_owner_user_id).toBe('user-456');
        expect(result.created_at).toBe('2024-01-01T00:00:00.000Z');
        expect(result.updated_at).toBe('2024-01-02T00:00:00.000Z');

        // Should exclude billing and public_data
        expect(
          (result as Record<string, unknown>).billing_data,
        ).toBeUndefined();
        expect((result as Record<string, unknown>).public_data).toBeUndefined();
      });

      it('should format dates correctly', async () => {
        const account = {
          id: 'acc-123',
          created_at: '2024-06-15T10:30:00.000Z',
          updated_at: '2024-06-20T15:45:30.500Z',
        };

        const result = (await accountTransformer.transform(
          account,
          'create',
        )) as Record<string, unknown>;

        expect(result.created_at).toBe('2024-06-15T10:30:00.000Z');
        expect(result.updated_at).toBe('2024-06-20T15:45:30.500Z');
      });

      it('should handle null dates', async () => {
        const account = {
          id: 'acc-123',
          created_at: null,
          updated_at: null,
        };

        const result = (await accountTransformer.transform(
          account,
          'create',
        )) as Record<string, unknown>;

        expect(result.created_at).toBeNull();
        expect(result.updated_at).toBeNull();
      });

      it('should handle personal accounts', async () => {
        const account = {
          id: 'acc-123',
          name: 'John Doe',
          is_personal_account: true,
        };

        const result = (await accountTransformer.transform(
          account,
          'create',
        )) as Record<string, unknown>;

        expect(result.is_personal_account).toBe(true);
      });
    });

    describe('getDescription()', () => {
      it('should generate description for team account create', () => {
        const account = { name: 'Acme Corp', is_personal_account: false };
        const description = accountTransformer.getDescription!(
          account,
          'create',
        );
        expect(description).toBe('Team account "Acme Corp" was created');
      });

      it('should generate description for personal account update', () => {
        const account = { name: 'John Doe', is_personal_account: true };
        const description = accountTransformer.getDescription!(
          account,
          'update',
        );
        expect(description).toBe('Personal account "John Doe" was updated');
      });

      it('should generate description for account delete', () => {
        const account = { name: 'Test Account', is_personal_account: false };
        const description = accountTransformer.getDescription!(
          account,
          'delete',
        );
        expect(description).toBe('Team account "Test Account" was deleted');
      });

      it('should handle custom actions', () => {
        const account = { name: 'Test', is_personal_account: true };
        const description = accountTransformer.getDescription!(
          account,
          'archive',
        );
        expect(description).toBe('Personal account "Test" action: archive');
      });

      it('should handle unnamed accounts', () => {
        const account = { is_personal_account: false };
        const description = accountTransformer.getDescription!(
          account,
          'create',
        );
        expect(description).toBe('Team account "Unnamed account" was created');
      });
    });

    describe('calculateChanges()', () => {
      it('should return empty object for non-objects', () => {
        expect(accountTransformer.calculateChanges!(null, {})).toEqual({});
        expect(accountTransformer.calculateChanges!({}, null)).toEqual({});
      });

      it('should detect name changes', () => {
        const before = { name: 'Old Name' };
        const after = { name: 'New Name' };

        const changes = accountTransformer.calculateChanges!(before, after);

        expect(changes.name).toEqual({
          before: 'Old Name',
          after: 'New Name',
        });
      });

      it('should detect multiple field changes', () => {
        const before = {
          name: 'Old Name',
          slug: 'old-slug',
          email: 'old@example.com',
        };
        const after = {
          name: 'New Name',
          slug: 'new-slug',
          email: 'new@example.com',
        };

        const changes = accountTransformer.calculateChanges!(before, after);

        expect(changes.name).toEqual({
          before: 'Old Name',
          after: 'New Name',
        });
        expect(changes.slug).toEqual({
          before: 'old-slug',
          after: 'new-slug',
        });
        expect(changes.email).toEqual({
          before: 'old@example.com',
          after: 'new@example.com',
        });
      });

      it('should only track defined fields', () => {
        const before = {
          name: 'Test',
          billing_data: { old: 'data' },
        };
        const after = {
          name: 'Test',
          billing_data: { new: 'data' },
        };

        const changes = accountTransformer.calculateChanges!(before, after);

        // billing_data should not be tracked
        expect(changes.billing_data).toBeUndefined();
      });

      it('should handle picture_url changes', () => {
        const before = { picture_url: 'old.png' };
        const after = { picture_url: 'new.png' };

        const changes = accountTransformer.calculateChanges!(before, after);

        expect(changes.picture_url).toEqual({
          before: 'old.png',
          after: 'new.png',
        });
      });
    });
  });

  describe('userTransformer', () => {
    describe('transform()', () => {
      it('should return primitive values unchanged', async () => {
        expect(await userTransformer.transform('string', 'create')).toBe(
          'string',
        );
        expect(await userTransformer.transform(null, 'create')).toBe(null);
      });

      it('should extract and redact user fields', async () => {
        const user = {
          id: 'user-123',
          display_name: 'John Doe',
          email: 'john@example.com',
          phone: '+1234567890',
          avatar_url: 'https://example.com/avatar.jpg',
          role: 'admin',
          is_active: true,
          password_hash: 'hashed_password',
          access_token: 'secret_token',
        };

        const result = (await userTransformer.transform(
          user,
          'create',
        )) as Record<string, unknown>;

        expect(result.id).toBe('user-123');
        expect(result.display_name).toBe('John Doe');
        expect(result.email).toBe('***REDACTED***');
        expect(result.phone).toBe('***REDACTED***');
        expect(result.avatar_url).toBe('https://example.com/avatar.jpg');
        expect(result.role).toBe('admin');
        expect(result.is_active).toBe(true);

        // Should exclude password and tokens
        expect(
          (result as Record<string, unknown>).password_hash,
        ).toBeUndefined();
        expect(
          (result as Record<string, unknown>).access_token,
        ).toBeUndefined();
      });

      it('should handle full_name fallback', async () => {
        const user = {
          id: 'user-123',
          full_name: 'Jane Smith',
        };

        const result = (await userTransformer.transform(
          user,
          'create',
        )) as Record<string, unknown>;

        expect(result.display_name).toBe('Jane Smith');
      });

      it('should handle null email and phone', async () => {
        const user = {
          id: 'user-123',
          display_name: 'Test User',
          email: null,
          phone: null,
        };

        const result = (await userTransformer.transform(
          user,
          'create',
        )) as Record<string, unknown>;

        expect(result.email).toBeNull();
        expect(result.phone).toBeNull();
      });

      it('should redact email when present', async () => {
        const user = {
          id: 'user-123',
          email: 'test@example.com',
        };

        const result = (await userTransformer.transform(
          user,
          'create',
        )) as Record<string, unknown>;

        expect(result.email).toBe('***REDACTED***');
      });
    });

    describe('getDescription()', () => {
      it('should generate description for user create', () => {
        const user = { display_name: 'John Doe' };
        const description = userTransformer.getDescription!(user, 'create');
        expect(description).toBe('User "John Doe" was created');
      });

      it('should generate description for user update', () => {
        const user = { full_name: 'Jane Smith' };
        const description = userTransformer.getDescription!(user, 'update');
        expect(description).toBe('User "Jane Smith" was updated');
      });

      it('should generate description for user delete', () => {
        const user = { display_name: 'Test User' };
        const description = userTransformer.getDescription!(user, 'delete');
        expect(description).toBe('User "Test User" was deleted');
      });

      it('should generate description for login', () => {
        const user = { display_name: 'Admin' };
        const description = userTransformer.getDescription!(user, 'login');
        expect(description).toBe('User "Admin" logged in');
      });

      it('should generate description for logout', () => {
        const user = { display_name: 'Admin' };
        const description = userTransformer.getDescription!(user, 'logout');
        expect(description).toBe('User "Admin" logged out');
      });

      it('should handle custom actions', () => {
        const user = { display_name: 'Test' };
        const description = userTransformer.getDescription!(user, 'archive');
        expect(description).toBe('User "Test" action: archive');
      });

      it('should handle unknown user', () => {
        const user = {};
        const description = userTransformer.getDescription!(user, 'create');
        expect(description).toBe('User "Unknown user" was created');
      });
    });

    describe('calculateChanges()', () => {
      it('should return empty object for non-objects', () => {
        expect(userTransformer.calculateChanges!(null, {})).toEqual({});
        expect(userTransformer.calculateChanges!({}, null)).toEqual({});
      });

      it('should detect display_name changes', () => {
        const before = { display_name: 'Old Name' };
        const after = { display_name: 'New Name' };

        const changes = userTransformer.calculateChanges!(before, after);

        expect(changes.display_name).toEqual({
          before: 'Old Name',
          after: 'New Name',
        });
      });

      it('should detect role changes', () => {
        const before = { role: 'user' };
        const after = { role: 'admin' };

        const changes = userTransformer.calculateChanges!(before, after);

        expect(changes.role).toEqual({ before: 'user', after: 'admin' });
      });

      it('should redact email changes', () => {
        const before = { email: 'old@example.com' };
        const after = { email: 'new@example.com' };

        const changes = userTransformer.calculateChanges!(before, after);

        expect(changes.email).toEqual({
          before: '***REDACTED***',
          after: '***REDACTED***',
        });
      });

      it('should detect multiple safe field changes', () => {
        const before = {
          display_name: 'John',
          role: 'user',
          avatar_url: 'old.jpg',
          is_active: true,
        };
        const after = {
          display_name: 'Jane',
          role: 'admin',
          avatar_url: 'new.jpg',
          is_active: false,
        };

        const changes = userTransformer.calculateChanges!(before, after);

        expect(changes.display_name).toBeDefined();
        expect(changes.role).toBeDefined();
        expect(changes.avatar_url).toBeDefined();
        expect(changes.is_active).toBeDefined();
      });

      it('should not track password changes', () => {
        const before = { password_hash: 'old_hash' };
        const after = { password_hash: 'new_hash' };

        const changes = userTransformer.calculateChanges!(before, after);

        // password_hash is not in safeFields
        expect(changes.password_hash).toBeUndefined();
      });

      it('should handle bio changes', () => {
        const before = { bio: 'Old bio' };
        const after = { bio: 'New bio' };

        const changes = userTransformer.calculateChanges!(before, after);

        expect(changes.bio).toEqual({ before: 'Old bio', after: 'New bio' });
      });
    });
  });

  describe('initializeAuditTransformers', () => {
    it('should be a function', () => {
      expect(typeof initializeAuditTransformers).toBe('function');
    });

    it('should not throw when called', () => {
      expect(() => initializeAuditTransformers()).not.toThrow();
    });

    it('should be idempotent', () => {
      expect(() => {
        initializeAuditTransformers();
        initializeAuditTransformers();
        initializeAuditTransformers();
      }).not.toThrow();
    });
  });
});
