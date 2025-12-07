import { describe, expect, it } from 'vitest';

import {
  AUDIT_CONFIG,
  getEnabledObjectTypes,
  getObjectConfig,
  isSensitiveField,
  shouldTrackObject,
} from '../src/config/audit-config';

describe('audit-config', () => {
  describe('AUDIT_CONFIG', () => {
    it('should have configuration for all expected object types', () => {
      const expectedTypes = [
        'project',
        'user',
        'account',
        'account_settings',
        'invitation',
        'team_member',
        'subscription',
        'auth_event',
        'file',
        'session',
        'notification',
        'analytics_event',
        'cache_entry',
      ];

      expectedTypes.forEach((type) => {
        expect(AUDIT_CONFIG[type]).toBeDefined();
      });
    });

    it('should have enabled flag for all configurations', () => {
      Object.values(AUDIT_CONFIG).forEach((config) => {
        expect(config).toHaveProperty('enabled');
        expect(typeof config.enabled).toBe('boolean');
      });
    });

    describe('project configuration', () => {
      it('should be enabled', () => {
        expect(AUDIT_CONFIG.project.enabled).toBe(true);
      });

      it('should track all CRUD actions plus archive/restore', () => {
        expect(AUDIT_CONFIG.project.actions).toEqual([
          'create',
          'update',
          'delete',
          'archive',
          'restore',
        ]);
      });

      it('should have no sensitive fields', () => {
        expect(AUDIT_CONFIG.project.sensitiveFields).toEqual([]);
      });
    });

    describe('user configuration', () => {
      it('should be enabled', () => {
        expect(AUDIT_CONFIG.user.enabled).toBe(true);
      });

      it('should track create, update, delete actions', () => {
        expect(AUDIT_CONFIG.user.actions).toEqual([
          'create',
          'update',
          'delete',
        ]);
      });

      it('should exclude password and metadata fields', () => {
        expect(AUDIT_CONFIG.user.excludeFields).toContain('password_hash');
        expect(AUDIT_CONFIG.user.excludeFields).toContain('encrypted_password');
        expect(AUDIT_CONFIG.user.excludeFields).toContain('raw_app_meta_data');
        expect(AUDIT_CONFIG.user.excludeFields).toContain('raw_user_meta_data');
      });

      it('should mark PII as sensitive', () => {
        expect(AUDIT_CONFIG.user.sensitiveFields).toContain('email');
        expect(AUDIT_CONFIG.user.sensitiveFields).toContain('phone');
        expect(AUDIT_CONFIG.user.sensitiveFields).toContain('phone_number');
      });
    });

    describe('account_settings configuration', () => {
      it('should be enabled', () => {
        expect(AUDIT_CONFIG.account_settings.enabled).toBe(true);
      });

      it('should mark all API keys and secrets as sensitive', () => {
        const sensitiveFields = AUDIT_CONFIG.account_settings.sensitiveFields!;

        expect(sensitiveFields).toContain('api_key');
        expect(sensitiveFields).toContain('secret_key');
        expect(sensitiveFields).toContain('webhook_secret');
        expect(sensitiveFields).toContain('private_key');
        expect(sensitiveFields).toContain('access_token');
        expect(sensitiveFields).toContain('refresh_token');
      });
    });

    describe('disabled configurations', () => {
      it('should disable session tracking', () => {
        expect(AUDIT_CONFIG.session.enabled).toBe(false);
      });

      it('should disable notification tracking', () => {
        expect(AUDIT_CONFIG.notification.enabled).toBe(false);
      });

      it('should disable analytics_event tracking', () => {
        expect(AUDIT_CONFIG.analytics_event.enabled).toBe(false);
      });

      it('should disable cache_entry tracking', () => {
        expect(AUDIT_CONFIG.cache_entry.enabled).toBe(false);
      });
    });

    describe('team_member configuration', () => {
      it('should use includeFields instead of excludeFields', () => {
        expect(AUDIT_CONFIG.team_member.includeFields).toBeDefined();
        expect(AUDIT_CONFIG.team_member.includeFields).toContain('user_id');
        expect(AUDIT_CONFIG.team_member.includeFields).toContain('account_id');
        expect(AUDIT_CONFIG.team_member.includeFields).toContain('role');
        expect(AUDIT_CONFIG.team_member.includeFields).toContain('permissions');
      });
    });

    describe('subscription configuration', () => {
      it('should redact payment details', () => {
        expect(AUDIT_CONFIG.subscription.sensitiveFields).toContain(
          'payment_method_id',
        );
        expect(AUDIT_CONFIG.subscription.sensitiveFields).toContain(
          'card_last4',
        );
      });
    });

    describe('auth_event configuration', () => {
      it('should exclude all tokens', () => {
        expect(AUDIT_CONFIG.auth_event.excludeFields).toContain(
          'session_token',
        );
        expect(AUDIT_CONFIG.auth_event.excludeFields).toContain('access_token');
        expect(AUDIT_CONFIG.auth_event.excludeFields).toContain(
          'refresh_token',
        );
      });
    });

    describe('file configuration', () => {
      it('should only include specific metadata fields', () => {
        expect(AUDIT_CONFIG.file.includeFields).toEqual([
          'id',
          'name',
          'size',
          'mime_type',
          'bucket_id',
        ]);
      });
    });
  });

  describe('shouldTrackObject', () => {
    describe('enabled objects', () => {
      it('should track enabled object with matching action', () => {
        expect(shouldTrackObject('project', 'create')).toBe(true);
        expect(shouldTrackObject('project', 'update')).toBe(true);
        expect(shouldTrackObject('project', 'delete')).toBe(true);
      });

      it('should track user CRUD actions', () => {
        expect(shouldTrackObject('user', 'create')).toBe(true);
        expect(shouldTrackObject('user', 'update')).toBe(true);
        expect(shouldTrackObject('user', 'delete')).toBe(true);
      });

      it('should not track non-configured actions', () => {
        expect(shouldTrackObject('user', 'archive')).toBe(false);
        expect(shouldTrackObject('user', 'restore')).toBe(false);
      });

      it('should track all actions if actions array is empty', () => {
        // Account has enabled: true but might not have actions array
        const config = getObjectConfig('account');

        if (!config?.actions || config.actions.length === 0) {
          expect(shouldTrackObject('account', 'create')).toBe(true);
          expect(shouldTrackObject('account', 'update')).toBe(true);
          expect(shouldTrackObject('account', 'any_action' as any)).toBe(true);
        }
      });
    });

    describe('disabled objects', () => {
      it('should not track disabled session object', () => {
        expect(shouldTrackObject('session', 'create')).toBe(false);
        expect(shouldTrackObject('session', 'update')).toBe(false);
      });

      it('should not track disabled notification object', () => {
        expect(shouldTrackObject('notification', 'create')).toBe(false);
      });

      it('should not track disabled analytics_event', () => {
        expect(shouldTrackObject('analytics_event', 'create')).toBe(false);
      });

      it('should not track disabled cache_entry', () => {
        expect(shouldTrackObject('cache_entry', 'create')).toBe(false);
      });
    });

    describe('unknown objects', () => {
      it('should not track unknown object type', () => {
        expect(shouldTrackObject('unknown_type', 'create')).toBe(false);
      });

      it('should not track non-existent object', () => {
        expect(shouldTrackObject('foo', 'bar' as any)).toBe(false);
      });
    });

    describe('special actions', () => {
      it('should track permission_change for team_member', () => {
        expect(shouldTrackObject('team_member', 'permission_change')).toBe(
          true,
        );
      });

      it('should track accept_invite for invitation', () => {
        expect(shouldTrackObject('invitation', 'accept_invite')).toBe(true);
      });

      it('should track reject_invite for invitation', () => {
        expect(shouldTrackObject('invitation', 'reject_invite')).toBe(true);
      });

      it('should track settings_change for account_settings', () => {
        expect(shouldTrackObject('account_settings', 'settings_change')).toBe(
          true,
        );
      });

      it('should track login/logout for auth_event', () => {
        expect(shouldTrackObject('auth_event', 'login')).toBe(true);
        expect(shouldTrackObject('auth_event', 'logout')).toBe(true);
      });
    });
  });

  describe('getObjectConfig', () => {
    it('should return config for existing object type', () => {
      const config = getObjectConfig('project');

      expect(config).toBeDefined();
      expect(config?.enabled).toBe(true);
    });

    it('should return config for user', () => {
      const config = getObjectConfig('user');

      expect(config).toBeDefined();
      expect(config?.enabled).toBe(true);
      expect(config?.sensitiveFields).toBeDefined();
    });

    it('should return null for unknown object type', () => {
      const config = getObjectConfig('unknown');

      expect(config).toBeNull();
    });

    it('should return null for empty string', () => {
      const config = getObjectConfig('');

      expect(config).toBeNull();
    });

    it('should return config with all expected properties', () => {
      const config = getObjectConfig('user');

      expect(config).toHaveProperty('enabled');
      expect(config).toHaveProperty('actions');
      expect(config).toHaveProperty('excludeFields');
      expect(config).toHaveProperty('sensitiveFields');
    });
  });

  describe('getEnabledObjectTypes', () => {
    it('should return all enabled object types', () => {
      const enabled = getEnabledObjectTypes();

      expect(enabled).toContain('project');
      expect(enabled).toContain('user');
      expect(enabled).toContain('account');
      expect(enabled).toContain('invitation');
      expect(enabled).toContain('team_member');
      expect(enabled).toContain('subscription');
    });

    it('should not include disabled types', () => {
      const enabled = getEnabledObjectTypes();

      expect(enabled).not.toContain('session');
      expect(enabled).not.toContain('notification');
      expect(enabled).not.toContain('analytics_event');
      expect(enabled).not.toContain('cache_entry');
    });

    it('should return an array', () => {
      const enabled = getEnabledObjectTypes();

      expect(Array.isArray(enabled)).toBe(true);
    });

    it('should have at least 5 enabled types', () => {
      const enabled = getEnabledObjectTypes();

      expect(enabled.length).toBeGreaterThanOrEqual(5);
    });

    it('should not have duplicates', () => {
      const enabled = getEnabledObjectTypes();
      const unique = [...new Set(enabled)];

      expect(enabled.length).toBe(unique.length);
    });
  });

  describe('isSensitiveField', () => {
    describe('user sensitive fields', () => {
      it('should identify email as sensitive', () => {
        expect(isSensitiveField('user', 'email')).toBe(true);
      });

      it('should identify phone as sensitive', () => {
        expect(isSensitiveField('user', 'phone')).toBe(true);
      });

      it('should identify phone_number as sensitive', () => {
        expect(isSensitiveField('user', 'phone_number')).toBe(true);
      });

      it('should not identify name as sensitive', () => {
        expect(isSensitiveField('user', 'name')).toBe(false);
      });

      it('should not identify id as sensitive', () => {
        expect(isSensitiveField('user', 'id')).toBe(false);
      });
    });

    describe('account_settings sensitive fields', () => {
      it('should identify api_key as sensitive', () => {
        expect(isSensitiveField('account_settings', 'api_key')).toBe(true);
      });

      it('should identify secret_key as sensitive', () => {
        expect(isSensitiveField('account_settings', 'secret_key')).toBe(true);
      });

      it('should identify webhook_secret as sensitive', () => {
        expect(isSensitiveField('account_settings', 'webhook_secret')).toBe(
          true,
        );
      });

      it('should identify all token fields as sensitive', () => {
        expect(isSensitiveField('account_settings', 'access_token')).toBe(true);
        expect(isSensitiveField('account_settings', 'refresh_token')).toBe(
          true,
        );
      });
    });

    describe('subscription sensitive fields', () => {
      it('should identify payment_method_id as sensitive', () => {
        expect(isSensitiveField('subscription', 'payment_method_id')).toBe(
          true,
        );
      });

      it('should identify card_last4 as sensitive', () => {
        expect(isSensitiveField('subscription', 'card_last4')).toBe(true);
      });
    });

    describe('invitation sensitive fields', () => {
      it('should identify token as sensitive', () => {
        expect(isSensitiveField('invitation', 'token')).toBe(true);
      });

      it('should not identify email as sensitive for invitation', () => {
        expect(isSensitiveField('invitation', 'email')).toBe(false);
      });
    });

    describe('objects with no sensitive fields', () => {
      it('should return false for project fields', () => {
        expect(isSensitiveField('project', 'name')).toBe(false);
        expect(isSensitiveField('project', 'description')).toBe(false);
      });

      it('should return false for account fields', () => {
        expect(isSensitiveField('account', 'name')).toBe(false);
        expect(isSensitiveField('account', 'id')).toBe(false);
      });
    });

    describe('unknown objects', () => {
      it('should return false for unknown object type', () => {
        expect(isSensitiveField('unknown', 'field')).toBe(false);
      });

      it('should return false for empty object type', () => {
        expect(isSensitiveField('', 'field')).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should be case-sensitive for field names', () => {
        expect(isSensitiveField('user', 'EMAIL')).toBe(false);
        expect(isSensitiveField('user', 'email')).toBe(true);
      });

      it('should handle empty field name', () => {
        expect(isSensitiveField('user', '')).toBe(false);
      });

      it('should handle objects with undefined sensitiveFields', () => {
        // team_member doesn't have sensitiveFields defined
        expect(isSensitiveField('team_member', 'role')).toBe(false);
      });
    });
  });

  describe('integration scenarios', () => {
    it('should correctly identify trackable and sensitive combinations', () => {
      // User create with email (should track, email is sensitive)
      expect(shouldTrackObject('user', 'create')).toBe(true);
      expect(isSensitiveField('user', 'email')).toBe(true);

      // Project create with name (should track, no sensitive fields)
      expect(shouldTrackObject('project', 'create')).toBe(true);
      expect(isSensitiveField('project', 'name')).toBe(false);

      // Session create (should not track at all)
      expect(shouldTrackObject('session', 'create')).toBe(false);
    });

    it('should handle full audit flow for account_settings', () => {
      const objectType = 'account_settings';

      // Should track
      expect(shouldTrackObject(objectType, 'settings_change')).toBe(true);

      // Should have config
      const config = getObjectConfig(objectType);
      expect(config).not.toBeNull();
      expect(config?.enabled).toBe(true);

      // Should redact API keys
      expect(isSensitiveField(objectType, 'api_key')).toBe(true);
      expect(isSensitiveField(objectType, 'secret_key')).toBe(true);
    });
  });
});
