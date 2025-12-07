import { describe, expect, it } from 'vitest';

import { settingsTransformer } from '../src/transformers/settings-transformer';
import type { AuditAction } from '../src/types';

describe('settingsTransformer', () => {
  describe('transform()', () => {
    describe('data validation', () => {
      it('should return primitive values unchanged', async () => {
        expect(await settingsTransformer.transform('string', 'update')).toBe(
          'string',
        );
        expect(await settingsTransformer.transform(123, 'update')).toBe(123);
        expect(await settingsTransformer.transform(true, 'update')).toBe(true);
      });

      it('should return null unchanged', async () => {
        expect(await settingsTransformer.transform(null, 'update')).toBeNull();
      });

      it('should return undefined unchanged', async () => {
        expect(
          await settingsTransformer.transform(undefined, 'update'),
        ).toBeUndefined();
      });
    });

    describe('sensitive field detection', () => {
      it('should redact api_key field', async () => {
        const settings = {
          api_key: 'sk-abc123',
          other_field: 'visible',
        };

        const result = (await settingsTransformer.transform(
          settings,
          'update',
        )) as Record<string, unknown>;

        expect(result.api_key).toBe('***REDACTED***');
        expect(result.other_field).toBe('visible');
      });

      it('should redact apiKey field (camelCase)', async () => {
        const settings = {
          apiKey: 'sk-abc123',
          other_field: 'visible',
        };

        const result = (await settingsTransformer.transform(
          settings,
          'update',
        )) as Record<string, unknown>;

        expect(result.apiKey).toBe('***REDACTED***');
        expect(result.other_field).toBe('visible');
      });

      it('should redact api-key field (kebab-case)', async () => {
        const settings = {
          'api-key': 'sk-abc123',
          other_field: 'visible',
        };

        const result = (await settingsTransformer.transform(
          settings,
          'update',
        )) as Record<string, unknown>;

        expect(result['api-key']).toBe('***REDACTED***');
        expect(result.other_field).toBe('visible');
      });

      it('should redact secret field', async () => {
        const settings = {
          client_secret: 'secret123',
          other_field: 'visible',
        };

        const result = (await settingsTransformer.transform(
          settings,
          'update',
        )) as Record<string, unknown>;

        expect(result.client_secret).toBe('***REDACTED***');
        expect(result.other_field).toBe('visible');
      });

      it('should redact token field', async () => {
        const settings = {
          access_token: 'token123',
          refresh_token: 'refresh123',
          other_field: 'visible',
        };

        const result = (await settingsTransformer.transform(
          settings,
          'update',
        )) as Record<string, unknown>;

        expect(result.access_token).toBe('***REDACTED***');
        expect(result.refresh_token).toBe('***REDACTED***');
        expect(result.other_field).toBe('visible');
      });

      it('should redact password field', async () => {
        const settings = {
          password: 'pass123',
          old_password: 'oldpass',
          other_field: 'visible',
        };

        const result = (await settingsTransformer.transform(
          settings,
          'update',
        )) as Record<string, unknown>;

        expect(result.password).toBe('***REDACTED***');
        expect(result.old_password).toBe('***REDACTED***');
        expect(result.other_field).toBe('visible');
      });

      it('should redact webhook field', async () => {
        const settings = {
          webhook_url: 'https://example.com/webhook',
          webhook_secret: 'secret',
          other_field: 'visible',
        };

        const result = (await settingsTransformer.transform(
          settings,
          'update',
        )) as Record<string, unknown>;

        expect(result.webhook_url).toBe('***REDACTED***');
        expect(result.webhook_secret).toBe('***REDACTED***');
        expect(result.other_field).toBe('visible');
      });

      it('should redact private_key field', async () => {
        const settings = {
          private_key: '-----BEGIN PRIVATE KEY-----',
          'private-key': 'key123',
          other_field: 'visible',
        };

        const result = (await settingsTransformer.transform(
          settings,
          'update',
        )) as Record<string, unknown>;

        expect(result.private_key).toBe('***REDACTED***');
        expect(result['private-key']).toBe('***REDACTED***');
        expect(result.other_field).toBe('visible');
      });

      it('should redact access_key field', async () => {
        const settings = {
          access_key: 'AKIAIOSFODNN7EXAMPLE',
          'access-key': 'key123',
          other_field: 'visible',
        };

        const result = (await settingsTransformer.transform(
          settings,
          'update',
        )) as Record<string, unknown>;

        expect(result.access_key).toBe('***REDACTED***');
        expect(result['access-key']).toBe('***REDACTED***');
        expect(result.other_field).toBe('visible');
      });

      it('should redact auth_token field', async () => {
        const settings = {
          auth_token: 'Bearer token123',
          'auth-token': 'token456',
          other_field: 'visible',
        };

        const result = (await settingsTransformer.transform(
          settings,
          'update',
        )) as Record<string, unknown>;

        expect(result.auth_token).toBe('***REDACTED***');
        expect(result['auth-token']).toBe('***REDACTED***');
        expect(result.other_field).toBe('visible');
      });

      it('should redact bearer field', async () => {
        const settings = {
          bearer: 'token123',
          bearer_token: 'token456',
          other_field: 'visible',
        };

        const result = (await settingsTransformer.transform(
          settings,
          'update',
        )) as Record<string, unknown>;

        expect(result.bearer).toBe('***REDACTED***');
        expect(result.bearer_token).toBe('***REDACTED***');
        expect(result.other_field).toBe('visible');
      });

      it('should redact credential field', async () => {
        const settings = {
          credentials: 'user:pass',
          user_credentials: 'creds',
          other_field: 'visible',
        };

        const result = (await settingsTransformer.transform(
          settings,
          'update',
        )) as Record<string, unknown>;

        expect(result.credentials).toBe('***REDACTED***');
        expect(result.user_credentials).toBe('***REDACTED***');
        expect(result.other_field).toBe('visible');
      });

      it('should handle case-insensitive pattern matching', async () => {
        const settings = {
          API_KEY: 'key1',
          Secret: 'secret1',
          TOKEN: 'token1',
          PASSWORD: 'pass1',
          other_field: 'visible',
        };

        const result = (await settingsTransformer.transform(
          settings,
          'update',
        )) as Record<string, unknown>;

        expect(result.API_KEY).toBe('***REDACTED***');
        expect(result.Secret).toBe('***REDACTED***');
        expect(result.TOKEN).toBe('***REDACTED***');
        expect(result.PASSWORD).toBe('***REDACTED***');
        expect(result.other_field).toBe('visible');
      });

      it('should only redact string values', async () => {
        const settings = {
          api_key: 'string_value', // Should be redacted
          password: 123, // Should NOT be redacted (number)
          token: true, // Should NOT be redacted (boolean)
          secret: { nested: 'value' }, // Should NOT be redacted (object)
          other_field: 'visible',
        };

        const result = (await settingsTransformer.transform(
          settings,
          'update',
        )) as Record<string, unknown>;

        expect(result.api_key).toBe('***REDACTED***');
        expect(result.password).toBe(123); // Not redacted (not a string)
        expect(result.token).toBe(true); // Not redacted (not a string)
        expect(result.secret).toEqual({ nested: 'value' }); // Not redacted (not a string)
        expect(result.other_field).toBe('visible');
      });
    });

    describe('non-sensitive fields', () => {
      it('should preserve non-sensitive fields', async () => {
        const settings = {
          theme: 'dark',
          language: 'en',
          timezone: 'UTC',
          notifications_enabled: true,
          max_projects: 10,
        };

        const result = (await settingsTransformer.transform(
          settings,
          'update',
        )) as Record<string, unknown>;

        expect(result.theme).toBe('dark');
        expect(result.language).toBe('en');
        expect(result.timezone).toBe('UTC');
        expect(result.notifications_enabled).toBe(true);
        expect(result.max_projects).toBe(10);
      });

      it('should handle empty object', async () => {
        const result = (await settingsTransformer.transform(
          {},
          'update',
        )) as Record<string, unknown>;

        expect(result).toEqual({});
      });
    });

    describe('mixed sensitive and non-sensitive fields', () => {
      it('should redact only sensitive fields in mixed object', async () => {
        const settings = {
          theme: 'dark',
          api_key: 'sk-123',
          language: 'en',
          webhook_url: 'https://example.com',
          timezone: 'UTC',
          access_token: 'token123',
          notifications_enabled: true,
        };

        const result = (await settingsTransformer.transform(
          settings,
          'update',
        )) as Record<string, unknown>;

        expect(result.theme).toBe('dark');
        expect(result.api_key).toBe('***REDACTED***');
        expect(result.language).toBe('en');
        expect(result.webhook_url).toBe('***REDACTED***');
        expect(result.timezone).toBe('UTC');
        expect(result.access_token).toBe('***REDACTED***');
        expect(result.notifications_enabled).toBe(true);
      });
    });
  });

  describe('getDescription()', () => {
    it('should describe update action', () => {
      const description = settingsTransformer.getDescription(
        { theme: 'dark' },
        'update',
      );
      expect(description).toBe('Account settings were updated');
    });

    it('should describe create action', () => {
      const description = settingsTransformer.getDescription(
        { theme: 'dark' },
        'create',
      );
      expect(description).toBe('Account settings were create');
    });

    it('should describe delete action', () => {
      const description = settingsTransformer.getDescription(
        { theme: 'dark' },
        'delete',
      );
      expect(description).toBe('Account settings were delete');
    });

    it('should describe custom action', () => {
      const description = settingsTransformer.getDescription(
        { theme: 'dark' },
        'reset' as AuditAction,
      );
      expect(description).toBe('Account settings were reset');
    });

    it('should handle null data', () => {
      const description = settingsTransformer.getDescription(null, 'update');
      expect(description).toBe('Account settings were updated');
    });

    it('should handle undefined data', () => {
      const description = settingsTransformer.getDescription(
        undefined,
        'update',
      );
      expect(description).toBe('Account settings were updated');
    });
  });

  describe('calculateChanges()', () => {
    describe('invalid inputs', () => {
      it('should return empty object for non-object before', () => {
        const changes = settingsTransformer.calculateChanges('string', {
          theme: 'dark',
        });
        expect(changes).toEqual({});
      });

      it('should return empty object for non-object after', () => {
        const changes = settingsTransformer.calculateChanges(
          { theme: 'dark' },
          'string',
        );
        expect(changes).toEqual({});
      });

      it('should return empty object for null before', () => {
        const changes = settingsTransformer.calculateChanges(null, {
          theme: 'dark',
        });
        expect(changes).toEqual({});
      });

      it('should return empty object for null after', () => {
        const changes = settingsTransformer.calculateChanges(
          { theme: 'dark' },
          null,
        );
        expect(changes).toEqual({});
      });

      it('should return empty object for undefined before', () => {
        const changes = settingsTransformer.calculateChanges(undefined, {
          theme: 'dark',
        });
        expect(changes).toEqual({});
      });

      it('should return empty object for undefined after', () => {
        const changes = settingsTransformer.calculateChanges(
          { theme: 'dark' },
          undefined,
        );
        expect(changes).toEqual({});
      });
    });

    describe('non-sensitive field changes', () => {
      it('should detect theme change', () => {
        const before = { theme: 'light' };
        const after = { theme: 'dark' };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.theme).toEqual({
          before: 'light',
          after: 'dark',
        });
      });

      it('should detect language change', () => {
        const before = { language: 'en' };
        const after = { language: 'es' };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.language).toEqual({
          before: 'en',
          after: 'es',
        });
      });

      it('should detect boolean change', () => {
        const before = { notifications_enabled: true };
        const after = { notifications_enabled: false };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.notifications_enabled).toEqual({
          before: true,
          after: false,
        });
      });

      it('should detect number change', () => {
        const before = { max_projects: 10 };
        const after = { max_projects: 20 };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.max_projects).toEqual({
          before: 10,
          after: 20,
        });
      });
    });

    describe('sensitive field changes', () => {
      it('should redact api_key changes', () => {
        const before = { api_key: 'old-key' };
        const after = { api_key: 'new-key' };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.api_key).toEqual({
          before: '***REDACTED***',
          after: '***REDACTED***',
        });
      });

      it('should redact secret changes', () => {
        const before = { client_secret: 'old-secret' };
        const after = { client_secret: 'new-secret' };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.client_secret).toEqual({
          before: '***REDACTED***',
          after: '***REDACTED***',
        });
      });

      it('should redact token changes', () => {
        const before = { access_token: 'old-token' };
        const after = { access_token: 'new-token' };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.access_token).toEqual({
          before: '***REDACTED***',
          after: '***REDACTED***',
        });
      });

      it('should redact password changes', () => {
        const before = { password: 'old-pass' };
        const after = { password: 'new-pass' };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.password).toEqual({
          before: '***REDACTED***',
          after: '***REDACTED***',
        });
      });

      it('should redact webhook changes', () => {
        const before = { webhook_url: 'https://old.com' };
        const after = { webhook_url: 'https://new.com' };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.webhook_url).toEqual({
          before: '***REDACTED***',
          after: '***REDACTED***',
        });
      });

      it('should redact private_key changes', () => {
        const before = { private_key: 'old-key' };
        const after = { private_key: 'new-key' };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.private_key).toEqual({
          before: '***REDACTED***',
          after: '***REDACTED***',
        });
      });
    });

    describe('mixed sensitive and non-sensitive changes', () => {
      it('should redact sensitive fields and show non-sensitive fields', () => {
        const before = {
          theme: 'light',
          api_key: 'old-key',
          language: 'en',
        };
        const after = {
          theme: 'dark',
          api_key: 'new-key',
          language: 'es',
        };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.theme).toEqual({
          before: 'light',
          after: 'dark',
        });
        expect(changes.api_key).toEqual({
          before: '***REDACTED***',
          after: '***REDACTED***',
        });
        expect(changes.language).toEqual({
          before: 'en',
          after: 'es',
        });
      });
    });

    describe('field additions and removals', () => {
      it('should detect field addition (non-sensitive)', () => {
        const before = { theme: 'light' };
        const after = { theme: 'light', language: 'en' };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.language).toEqual({
          before: undefined,
          after: 'en',
        });
        expect(changes.theme).toBeUndefined(); // No change
      });

      it('should detect field removal (non-sensitive)', () => {
        const before = { theme: 'light', language: 'en' };
        const after = { theme: 'light' };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.language).toEqual({
          before: 'en',
          after: undefined,
        });
        expect(changes.theme).toBeUndefined(); // No change
      });

      it('should detect field addition (sensitive)', () => {
        const before = { theme: 'light' };
        const after = { theme: 'light', api_key: 'new-key' };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.api_key).toEqual({
          before: '***REDACTED***',
          after: '***REDACTED***',
        });
        expect(changes.theme).toBeUndefined(); // No change
      });

      it('should detect field removal (sensitive)', () => {
        const before = { theme: 'light', api_key: 'old-key' };
        const after = { theme: 'light' };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.api_key).toEqual({
          before: '***REDACTED***',
          after: '***REDACTED***',
        });
        expect(changes.theme).toBeUndefined(); // No change
      });
    });

    describe('no changes', () => {
      it('should return empty object when no fields changed', () => {
        const before = { theme: 'dark', language: 'en' };
        const after = { theme: 'dark', language: 'en' };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes).toEqual({});
      });

      it('should return empty object for identical empty objects', () => {
        const changes = settingsTransformer.calculateChanges({}, {});
        expect(changes).toEqual({});
      });
    });

    describe('edge cases', () => {
      it('should handle null to value transition', () => {
        const before = { theme: null };
        const after = { theme: 'dark' };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.theme).toEqual({
          before: null,
          after: 'dark',
        });
      });

      it('should handle value to null transition', () => {
        const before = { theme: 'dark' };
        const after = { theme: null };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.theme).toEqual({
          before: 'dark',
          after: null,
        });
      });

      it('should handle undefined to value transition', () => {
        const before = { theme: undefined };
        const after = { theme: 'dark' };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.theme).toEqual({
          before: undefined,
          after: 'dark',
        });
      });

      it('should handle value to undefined transition', () => {
        const before = { theme: 'dark' };
        const after = { theme: undefined };

        const changes = settingsTransformer.calculateChanges(before, after);

        expect(changes.theme).toEqual({
          before: 'dark',
          after: undefined,
        });
      });
    });
  });
});
