import { describe, expect, it } from 'vitest';

import { accountTransformer } from '../src/transformers/account-transformer';
import type { AuditAction } from '../src/types';

describe('accountTransformer', () => {
  describe('transform()', () => {
    describe('data validation', () => {
      it('should return primitive values unchanged', async () => {
        expect(await accountTransformer.transform('string', 'create')).toBe(
          'string',
        );
        expect(await accountTransformer.transform(123, 'create')).toBe(123);
        expect(await accountTransformer.transform(true, 'create')).toBe(true);
      });

      it('should return null unchanged', async () => {
        expect(await accountTransformer.transform(null, 'create')).toBe(null);
      });

      it('should return undefined unchanged', async () => {
        expect(await accountTransformer.transform(undefined, 'create')).toBe(
          undefined,
        );
      });

      it('should transform arrays as objects', async () => {
        // Arrays are objects in JavaScript, so they get transformed
        const result = await accountTransformer.transform([], 'create');
        expect(result).toBeDefined();
        expect(typeof result).toBe('object');
      });
    });

    describe('safe field selection', () => {
      it('should include only safe fields', async () => {
        const account = {
          id: 'account-123',
          name: 'Test Account',
          slug: 'test-account',
          picture_url: 'https://example.com/pic.jpg',
          is_personal_account: false,
          email: 'contact@example.com',
          primary_owner_user_id: 'user-456',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-15T12:00:00Z',
          // Sensitive fields that should be excluded
          billing_customer_id: 'cus_123',
          subscription_id: 'sub_456',
          payment_method: 'card_789',
          public_data: { large: 'object' },
        };

        const result = (await accountTransformer.transform(
          account,
          'create',
        )) as Record<string, unknown>;

        // Should include safe fields
        expect(result.id).toBe('account-123');
        expect(result.name).toBe('Test Account');
        expect(result.slug).toBe('test-account');
        expect(result.picture_url).toBe('https://example.com/pic.jpg');
        expect(result.is_personal_account).toBe(false);
        expect(result.email).toBe('contact@example.com');
        expect(result.primary_owner_user_id).toBe('user-456');

        // Should exclude sensitive/large fields
        expect(result.billing_customer_id).toBeUndefined();
        expect(result.subscription_id).toBeUndefined();
        expect(result.payment_method).toBeUndefined();
        expect(result.public_data).toBeUndefined();
      });

      it('should handle missing optional fields', async () => {
        const account = {
          id: 'account-123',
          name: 'Minimal Account',
        };

        const result = (await accountTransformer.transform(
          account,
          'create',
        )) as Record<string, unknown>;

        expect(result.id).toBe('account-123');
        expect(result.name).toBe('Minimal Account');
        expect(result.slug).toBeUndefined();
        expect(result.picture_url).toBeUndefined();
        expect(result.email).toBeUndefined();
      });

      it('should handle null values in safe fields', async () => {
        const account = {
          id: 'account-123',
          name: null,
          slug: null,
          picture_url: null,
          email: null,
          is_personal_account: null,
          primary_owner_user_id: null,
        };

        const result = (await accountTransformer.transform(
          account,
          'create',
        )) as Record<string, unknown>;

        expect(result.name).toBeNull();
        expect(result.slug).toBeNull();
        expect(result.picture_url).toBeNull();
        expect(result.email).toBeNull();
      });
    });

    describe('date formatting', () => {
      it('should format created_at as ISO string', async () => {
        const account = {
          id: 'account-123',
          created_at: '2024-01-01T00:00:00Z',
        };

        const result = (await accountTransformer.transform(
          account,
          'create',
        )) as Record<string, unknown>;

        expect(result.created_at).toBe('2024-01-01T00:00:00.000Z');
      });

      it('should format updated_at as ISO string', async () => {
        const account = {
          id: 'account-123',
          updated_at: '2024-01-15T12:30:45Z',
        };

        const result = (await accountTransformer.transform(
          account,
          'create',
        )) as Record<string, unknown>;

        expect(result.updated_at).toBe('2024-01-15T12:30:45.000Z');
      });

      it('should return null for missing created_at', async () => {
        const account = {
          id: 'account-123',
        };

        const result = (await accountTransformer.transform(
          account,
          'create',
        )) as Record<string, unknown>;

        expect(result.created_at).toBeNull();
      });

      it('should return null for missing updated_at', async () => {
        const account = {
          id: 'account-123',
        };

        const result = (await accountTransformer.transform(
          account,
          'create',
        )) as Record<string, unknown>;

        expect(result.updated_at).toBeNull();
      });

      it('should handle Date objects', async () => {
        const account = {
          id: 'account-123',
          created_at: new Date('2024-06-15T10:30:00Z'),
          updated_at: new Date('2024-06-20T15:45:00Z'),
        };

        const result = (await accountTransformer.transform(
          account,
          'create',
        )) as Record<string, unknown>;

        expect(result.created_at).toBe('2024-06-15T10:30:00.000Z');
        expect(result.updated_at).toBe('2024-06-20T15:45:00.000Z');
      });

      it('should handle timestamp numbers', async () => {
        const account = {
          id: 'account-123',
          created_at: 1704067200000, // 2024-01-01T00:00:00Z
        };

        const result = (await accountTransformer.transform(
          account,
          'create',
        )) as Record<string, unknown>;

        expect(result.created_at).toBe('2024-01-01T00:00:00.000Z');
      });
    });

    describe('account types', () => {
      it('should handle personal account', async () => {
        const account = {
          id: 'account-123',
          name: 'John Doe',
          is_personal_account: true,
        };

        const result = (await accountTransformer.transform(
          account,
          'create',
        )) as Record<string, unknown>;

        expect(result.is_personal_account).toBe(true);
      });

      it('should handle team account', async () => {
        const account = {
          id: 'account-123',
          name: 'Acme Corp',
          is_personal_account: false,
        };

        const result = (await accountTransformer.transform(
          account,
          'create',
        )) as Record<string, unknown>;

        expect(result.is_personal_account).toBe(false);
      });
    });
  });

  describe('getDescription()', () => {
    describe('personal account descriptions', () => {
      const personalAccount = {
        name: 'John Doe',
        is_personal_account: true,
      };

      it('should describe create action for personal account', () => {
        const description = accountTransformer.getDescription(
          personalAccount,
          'create',
        );

        expect(description).toBe('Personal account "John Doe" was created');
      });

      it('should describe update action for personal account', () => {
        const description = accountTransformer.getDescription(
          personalAccount,
          'update',
        );

        expect(description).toBe('Personal account "John Doe" was updated');
      });

      it('should describe delete action for personal account', () => {
        const description = accountTransformer.getDescription(
          personalAccount,
          'delete',
        );

        expect(description).toBe('Personal account "John Doe" was deleted');
      });

      it('should describe custom action for personal account', () => {
        const description = accountTransformer.getDescription(
          personalAccount,
          'archive' as AuditAction,
        );

        expect(description).toBe('Personal account "John Doe" action: archive');
      });
    });

    describe('team account descriptions', () => {
      const teamAccount = {
        name: 'Acme Corporation',
        is_personal_account: false,
      };

      it('should describe create action for team account', () => {
        const description = accountTransformer.getDescription(
          teamAccount,
          'create',
        );

        expect(description).toBe('Team account "Acme Corporation" was created');
      });

      it('should describe update action for team account', () => {
        const description = accountTransformer.getDescription(
          teamAccount,
          'update',
        );

        expect(description).toBe('Team account "Acme Corporation" was updated');
      });

      it('should describe delete action for team account', () => {
        const description = accountTransformer.getDescription(
          teamAccount,
          'delete',
        );

        expect(description).toBe('Team account "Acme Corporation" was deleted');
      });

      it('should describe custom action for team account', () => {
        const description = accountTransformer.getDescription(
          teamAccount,
          'suspend' as AuditAction,
        );

        expect(description).toBe(
          'Team account "Acme Corporation" action: suspend',
        );
      });
    });

    describe('edge cases', () => {
      it('should handle unnamed account', () => {
        const account = {
          is_personal_account: false,
        };

        const description = accountTransformer.getDescription(
          account,
          'create',
        );

        expect(description).toBe('Team account "Unnamed account" was created');
      });

      it('should handle null name', () => {
        const account = {
          name: null,
          is_personal_account: true,
        };

        const description = accountTransformer.getDescription(
          account,
          'create',
        );

        expect(description).toBe('Personal account "Unnamed account" was created');
      });

      it('should handle empty string name', () => {
        const account = {
          name: '',
          is_personal_account: false,
        };

        const description = accountTransformer.getDescription(
          account,
          'update',
        );

        expect(description).toBe('Team account "Unnamed account" was updated');
      });

      it('should default to team account when is_personal_account is undefined', () => {
        const account = {
          name: 'Test Account',
        };

        const description = accountTransformer.getDescription(
          account,
          'create',
        );

        expect(description).toBe('Team account "Test Account" was created');
      });

      it('should handle special characters in name', () => {
        const account = {
          name: 'Test "Quoted" Account & Co.',
          is_personal_account: false,
        };

        const description = accountTransformer.getDescription(
          account,
          'create',
        );

        expect(description).toBe(
          'Team account "Test "Quoted" Account & Co." was created',
        );
      });
    });
  });

  describe('calculateChanges()', () => {
    describe('invalid inputs', () => {
      it('should return empty object for non-object before', () => {
        const changes = accountTransformer.calculateChanges('string', {
          name: 'After',
        });

        expect(changes).toEqual({});
      });

      it('should return empty object for non-object after', () => {
        const changes = accountTransformer.calculateChanges(
          { name: 'Before' },
          'string',
        );

        expect(changes).toEqual({});
      });

      it('should return empty object for null before', () => {
        const changes = accountTransformer.calculateChanges(null, {
          name: 'After',
        });

        expect(changes).toEqual({});
      });

      it('should return empty object for null after', () => {
        const changes = accountTransformer.calculateChanges(
          { name: 'Before' },
          null,
        );

        expect(changes).toEqual({});
      });

      it('should return empty object for undefined before', () => {
        const changes = accountTransformer.calculateChanges(undefined, {
          name: 'After',
        });

        expect(changes).toEqual({});
      });

      it('should return empty object for undefined after', () => {
        const changes = accountTransformer.calculateChanges(
          { name: 'Before' },
          undefined,
        );

        expect(changes).toEqual({});
      });
    });

    describe('tracked field changes', () => {
      it('should detect name change', () => {
        const before = { name: 'Old Name' };
        const after = { name: 'New Name' };

        const changes = accountTransformer.calculateChanges(before, after);

        expect(changes.name).toEqual({
          before: 'Old Name',
          after: 'New Name',
        });
      });

      it('should detect slug change', () => {
        const before = { slug: 'old-slug' };
        const after = { slug: 'new-slug' };

        const changes = accountTransformer.calculateChanges(before, after);

        expect(changes.slug).toEqual({
          before: 'old-slug',
          after: 'new-slug',
        });
      });

      it('should detect email change', () => {
        const before = { email: 'old@example.com' };
        const after = { email: 'new@example.com' };

        const changes = accountTransformer.calculateChanges(before, after);

        expect(changes.email).toEqual({
          before: 'old@example.com',
          after: 'new@example.com',
        });
      });

      it('should detect picture_url change', () => {
        const before = { picture_url: 'https://old.com/pic.jpg' };
        const after = { picture_url: 'https://new.com/pic.jpg' };

        const changes = accountTransformer.calculateChanges(before, after);

        expect(changes.picture_url).toEqual({
          before: 'https://old.com/pic.jpg',
          after: 'https://new.com/pic.jpg',
        });
      });

      it('should detect is_personal_account change', () => {
        const before = { is_personal_account: true };
        const after = { is_personal_account: false };

        const changes = accountTransformer.calculateChanges(before, after);

        expect(changes.is_personal_account).toEqual({
          before: true,
          after: false,
        });
      });

      it('should detect primary_owner_user_id change', () => {
        const before = { primary_owner_user_id: 'user-123' };
        const after = { primary_owner_user_id: 'user-456' };

        const changes = accountTransformer.calculateChanges(before, after);

        expect(changes.primary_owner_user_id).toEqual({
          before: 'user-123',
          after: 'user-456',
        });
      });
    });

    describe('multiple changes', () => {
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

        const changes = accountTransformer.calculateChanges(before, after);

        expect(Object.keys(changes)).toHaveLength(3);
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

      it('should only include changed fields', () => {
        const before = {
          name: 'Same Name',
          slug: 'old-slug',
          email: 'same@example.com',
        };
        const after = {
          name: 'Same Name',
          slug: 'new-slug',
          email: 'same@example.com',
        };

        const changes = accountTransformer.calculateChanges(before, after);

        expect(Object.keys(changes)).toHaveLength(1);
        expect(changes.slug).toEqual({
          before: 'old-slug',
          after: 'new-slug',
        });
        expect(changes.name).toBeUndefined();
        expect(changes.email).toBeUndefined();
      });
    });

    describe('untracked fields', () => {
      it('should ignore changes to untracked fields', () => {
        const before = {
          name: 'Same Name',
          billing_customer_id: 'cus_old',
          subscription_id: 'sub_old',
          public_data: { old: 'data' },
        };
        const after = {
          name: 'Same Name',
          billing_customer_id: 'cus_new',
          subscription_id: 'sub_new',
          public_data: { new: 'data' },
        };

        const changes = accountTransformer.calculateChanges(before, after);

        expect(changes).toEqual({});
      });

      it('should not track created_at changes', () => {
        const before = { created_at: '2024-01-01T00:00:00Z' };
        const after = { created_at: '2024-01-02T00:00:00Z' };

        const changes = accountTransformer.calculateChanges(before, after);

        expect(changes.created_at).toBeUndefined();
      });

      it('should not track updated_at changes', () => {
        const before = { updated_at: '2024-01-01T00:00:00Z' };
        const after = { updated_at: '2024-01-02T00:00:00Z' };

        const changes = accountTransformer.calculateChanges(before, after);

        expect(changes.updated_at).toBeUndefined();
      });
    });

    describe('null and undefined values', () => {
      it('should detect change from value to null', () => {
        const before = { name: 'Old Name' };
        const after = { name: null };

        const changes = accountTransformer.calculateChanges(before, after);

        expect(changes.name).toEqual({
          before: 'Old Name',
          after: null,
        });
      });

      it('should detect change from null to value', () => {
        const before = { name: null };
        const after = { name: 'New Name' };

        const changes = accountTransformer.calculateChanges(before, after);

        expect(changes.name).toEqual({
          before: null,
          after: 'New Name',
        });
      });

      it('should detect change from undefined to value', () => {
        const before = {};
        const after = { name: 'New Name' };

        const changes = accountTransformer.calculateChanges(before, after);

        expect(changes.name).toEqual({
          before: undefined,
          after: 'New Name',
        });
      });

      it('should detect change from value to undefined', () => {
        const before = { name: 'Old Name' };
        const after = {};

        const changes = accountTransformer.calculateChanges(before, after);

        expect(changes.name).toEqual({
          before: 'Old Name',
          after: undefined,
        });
      });

      it('should not report change when both are null', () => {
        const before = { name: null };
        const after = { name: null };

        const changes = accountTransformer.calculateChanges(before, after);

        expect(changes.name).toBeUndefined();
      });

      it('should not report change when both are undefined', () => {
        const before = {};
        const after = {};

        const changes = accountTransformer.calculateChanges(before, after);

        expect(Object.keys(changes)).toHaveLength(0);
      });
    });

    describe('no changes', () => {
      it('should return empty object when no fields changed', () => {
        const account = {
          name: 'Same Name',
          slug: 'same-slug',
          email: 'same@example.com',
          picture_url: 'https://same.com/pic.jpg',
          is_personal_account: false,
          primary_owner_user_id: 'user-123',
        };

        const changes = accountTransformer.calculateChanges(account, account);

        expect(changes).toEqual({});
      });

      it('should return empty object when only untracked fields changed', () => {
        const before = {
          name: 'Same Name',
          billing_customer_id: 'cus_old',
        };
        const after = {
          name: 'Same Name',
          billing_customer_id: 'cus_new',
        };

        const changes = accountTransformer.calculateChanges(before, after);

        expect(changes).toEqual({});
      });
    });

    describe('edge cases', () => {
      it('should handle empty objects', () => {
        const changes = accountTransformer.calculateChanges({}, {});

        expect(changes).toEqual({});
      });

      it('should handle objects with only untracked fields', () => {
        const before = { billing_customer_id: 'cus_123' };
        const after = { billing_customer_id: 'cus_456' };

        const changes = accountTransformer.calculateChanges(before, after);

        expect(changes).toEqual({});
      });

      it('should handle type coercion correctly', () => {
        const before = { is_personal_account: false };
        const after = { is_personal_account: 0 };

        const changes = accountTransformer.calculateChanges(before, after);

        // false !== 0, so it should detect a change
        expect(changes.is_personal_account).toEqual({
          before: false,
          after: 0,
        });
      });

      it('should handle string number changes', () => {
        const before = { name: '123' };
        const after = { name: 123 };

        const changes = accountTransformer.calculateChanges(before, after);

        // '123' !== 123, so it should detect a change
        expect(changes.name).toEqual({
          before: '123',
          after: 123,
        });
      });
    });
  });
});
