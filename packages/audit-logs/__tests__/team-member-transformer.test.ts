import { describe, expect, it } from 'vitest';

import { teamMemberTransformer } from '../src/transformers/team-member-transformer';
import type { AuditAction } from '../src/types';

describe('teamMemberTransformer', () => {
  describe('transform()', () => {
    describe('data validation', () => {
      it('should return primitive values unchanged', async () => {
        expect(await teamMemberTransformer.transform('string', 'create')).toBe(
          'string',
        );
        expect(await teamMemberTransformer.transform(123, 'create')).toBe(123);
        expect(await teamMemberTransformer.transform(true, 'create')).toBe(
          true,
        );
      });

      it('should return null unchanged', async () => {
        expect(
          await teamMemberTransformer.transform(null, 'create'),
        ).toBeNull();
      });

      it('should return undefined unchanged', async () => {
        expect(
          await teamMemberTransformer.transform(undefined, 'create'),
        ).toBeUndefined();
      });
    });

    describe('field selection', () => {
      it('should include only essential membership fields', async () => {
        const member = {
          id: 'member-123',
          user_id: 'user-456',
          account_id: 'account-789',
          role: 'owner',
          permissions: ['read', 'write', 'delete'],
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-15T12:00:00Z',
          invitation_token: 'secret-token', // Should be excluded
          metadata: { some: 'data' }, // Should be excluded
          internal_notes: 'Private notes', // Should be excluded
        };

        const result = (await teamMemberTransformer.transform(
          member,
          'create',
        )) as Record<string, unknown>;

        expect(result.id).toBe('member-123');
        expect(result.user_id).toBe('user-456');
        expect(result.account_id).toBe('account-789');
        expect(result.role).toBe('owner');
        expect(result.permissions).toEqual(['read', 'write', 'delete']);
        expect(result.invitation_token).toBeUndefined();
        expect(result.metadata).toBeUndefined();
        expect(result.internal_notes).toBeUndefined();
      });

      it('should include project_id for project members', async () => {
        const projectMember = {
          id: 'member-123',
          user_id: 'user-456',
          account_id: 'account-789',
          project_id: 'project-abc', // Project member
          role: 'contributor',
        };

        const result = (await teamMemberTransformer.transform(
          projectMember,
          'create',
        )) as Record<string, unknown>;

        expect(result.project_id).toBe('project-abc');
      });

      it('should handle team members without project_id', async () => {
        const teamMember = {
          id: 'member-123',
          user_id: 'user-456',
          account_id: 'account-789',
          role: 'member',
        };

        const result = (await teamMemberTransformer.transform(
          teamMember,
          'create',
        )) as Record<string, unknown>;

        expect(result.project_id).toBeUndefined();
      });
    });

    describe('date formatting', () => {
      it('should format created_at as ISO string', async () => {
        const member = {
          id: 'member-123',
          created_at: '2024-01-01T00:00:00Z',
        };

        const result = (await teamMemberTransformer.transform(
          member,
          'create',
        )) as Record<string, unknown>;

        expect(result.created_at).toBe('2024-01-01T00:00:00.000Z');
      });

      it('should format updated_at as ISO string', async () => {
        const member = {
          id: 'member-123',
          updated_at: '2024-01-15T12:30:45Z',
        };

        const result = (await teamMemberTransformer.transform(
          member,
          'create',
        )) as Record<string, unknown>;

        expect(result.updated_at).toBe('2024-01-15T12:30:45.000Z');
      });

      it('should handle null created_at', async () => {
        const member = {
          id: 'member-123',
          created_at: null,
        };

        const result = (await teamMemberTransformer.transform(
          member,
          'create',
        )) as Record<string, unknown>;

        expect(result.created_at).toBeNull();
      });

      it('should handle undefined updated_at', async () => {
        const member = {
          id: 'member-123',
        };

        const result = (await teamMemberTransformer.transform(
          member,
          'create',
        )) as Record<string, unknown>;

        expect(result.updated_at).toBeNull();
      });
    });

    describe('role and permission handling', () => {
      it('should preserve role field', async () => {
        const member = {
          id: 'member-123',
          role: 'admin',
        };

        const result = (await teamMemberTransformer.transform(
          member,
          'create',
        )) as Record<string, unknown>;

        expect(result.role).toBe('admin');
      });

      it('should preserve permissions array', async () => {
        const member = {
          id: 'member-123',
          permissions: ['read', 'write'],
        };

        const result = (await teamMemberTransformer.transform(
          member,
          'create',
        )) as Record<string, unknown>;

        expect(result.permissions).toEqual(['read', 'write']);
      });

      it('should handle empty permissions array', async () => {
        const member = {
          id: 'member-123',
          permissions: [],
        };

        const result = (await teamMemberTransformer.transform(
          member,
          'create',
        )) as Record<string, unknown>;

        expect(result.permissions).toEqual([]);
      });

      it('should handle missing permissions', async () => {
        const member = {
          id: 'member-123',
          role: 'member',
        };

        const result = (await teamMemberTransformer.transform(
          member,
          'create',
        )) as Record<string, unknown>;

        expect(result.permissions).toBeUndefined();
      });
    });
  });

  describe('getDescription()', () => {
    describe('team member descriptions', () => {
      it('should describe create action for team member', () => {
        const member = {
          user_id: 'user-123',
          account_id: 'account-456',
          role: 'owner',
        };

        const description = teamMemberTransformer.getDescription(
          member,
          'create',
        );
        expect(description).toBe('Team member added with role "owner"');
      });

      it('should describe update action for team member', () => {
        const member = {
          user_id: 'user-123',
          account_id: 'account-456',
          role: 'admin',
        };

        const description = teamMemberTransformer.getDescription(
          member,
          'update',
        );
        expect(description).toBe('Team member updated');
      });

      it('should describe permission_change action', () => {
        const member = {
          user_id: 'user-123',
          account_id: 'account-456',
          role: 'admin',
        };

        const description = teamMemberTransformer.getDescription(
          member,
          'permission_change' as AuditAction,
        );
        expect(description).toBe('Team member role changed to "admin"');
      });

      it('should describe delete action for team member', () => {
        const member = {
          user_id: 'user-123',
          account_id: 'account-456',
          role: 'member',
        };

        const description = teamMemberTransformer.getDescription(
          member,
          'delete',
        );
        expect(description).toBe('Team member removed');
      });

      it('should use default role "member" when role is missing', () => {
        const member = {
          user_id: 'user-123',
          account_id: 'account-456',
        };

        const description = teamMemberTransformer.getDescription(
          member,
          'create',
        );
        expect(description).toBe('Team member added with role "member"');
      });

      it('should use default role when role is null', () => {
        const member = {
          user_id: 'user-123',
          account_id: 'account-456',
          role: null,
        };

        const description = teamMemberTransformer.getDescription(
          member,
          'create',
        );
        expect(description).toBe('Team member added with role "member"');
      });
    });

    describe('project member descriptions', () => {
      it('should describe create action for project member', () => {
        const member = {
          user_id: 'user-123',
          project_id: 'project-456',
          role: 'contributor',
        };

        const description = teamMemberTransformer.getDescription(
          member,
          'create',
        );
        expect(description).toBe(
          'Project member added with role "contributor"',
        );
      });

      it('should describe update action for project member', () => {
        const member = {
          user_id: 'user-123',
          project_id: 'project-456',
          role: 'viewer',
        };

        const description = teamMemberTransformer.getDescription(
          member,
          'update',
        );
        expect(description).toBe('Project member updated');
      });

      it('should describe permission_change action for project member', () => {
        const member = {
          user_id: 'user-123',
          project_id: 'project-456',
          role: 'admin',
        };

        const description = teamMemberTransformer.getDescription(
          member,
          'permission_change' as AuditAction,
        );
        expect(description).toBe('Project member role changed to "admin"');
      });

      it('should describe delete action for project member', () => {
        const member = {
          user_id: 'user-123',
          project_id: 'project-456',
          role: 'contributor',
        };

        const description = teamMemberTransformer.getDescription(
          member,
          'delete',
        );
        expect(description).toBe('Project member removed');
      });
    });

    describe('custom actions', () => {
      it('should describe custom action for team member', () => {
        const member = {
          user_id: 'user-123',
          account_id: 'account-456',
          role: 'admin',
        };

        const description = teamMemberTransformer.getDescription(
          member,
          'suspend' as AuditAction,
        );
        expect(description).toBe('Team member action: suspend');
      });

      it('should describe custom action for project member', () => {
        const member = {
          user_id: 'user-123',
          project_id: 'project-456',
          role: 'viewer',
        };

        const description = teamMemberTransformer.getDescription(
          member,
          'activate' as AuditAction,
        );
        expect(description).toBe('Project member action: activate');
      });
    });

    describe('edge cases', () => {
      it('should throw on null data', () => {
        expect(() =>
          teamMemberTransformer.getDescription(null, 'create'),
        ).toThrow();
      });

      it('should throw on undefined data', () => {
        expect(() =>
          teamMemberTransformer.getDescription(undefined, 'create'),
        ).toThrow();
      });

      it('should handle empty object', () => {
        const description = teamMemberTransformer.getDescription({}, 'create');
        expect(description).toBe('Team member added with role "member"');
      });
    });
  });

  describe('calculateChanges()', () => {
    describe('invalid inputs', () => {
      it('should return empty object for non-object before', () => {
        const changes = teamMemberTransformer.calculateChanges('string', {
          role: 'admin',
        });
        expect(changes).toEqual({});
      });

      it('should return empty object for non-object after', () => {
        const changes = teamMemberTransformer.calculateChanges(
          { role: 'member' },
          'string',
        );
        expect(changes).toEqual({});
      });

      it('should return empty object for null before', () => {
        const changes = teamMemberTransformer.calculateChanges(null, {
          role: 'admin',
        });
        expect(changes).toEqual({});
      });

      it('should return empty object for null after', () => {
        const changes = teamMemberTransformer.calculateChanges(
          { role: 'member' },
          null,
        );
        expect(changes).toEqual({});
      });

      it('should return empty object for undefined before', () => {
        const changes = teamMemberTransformer.calculateChanges(undefined, {
          role: 'admin',
        });
        expect(changes).toEqual({});
      });

      it('should return empty object for undefined after', () => {
        const changes = teamMemberTransformer.calculateChanges(
          { role: 'member' },
          undefined,
        );
        expect(changes).toEqual({});
      });
    });

    describe('tracked field changes', () => {
      it('should detect role change', () => {
        const before = { role: 'member' };
        const after = { role: 'admin' };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes.role).toEqual({
          before: 'member',
          after: 'admin',
        });
      });

      it('should detect user_id change', () => {
        const before = { user_id: 'user-123' };
        const after = { user_id: 'user-456' };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes.user_id).toEqual({
          before: 'user-123',
          after: 'user-456',
        });
      });

      it('should detect permissions array change', () => {
        const before = { permissions: ['read'] };
        const after = { permissions: ['read', 'write'] };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes.permissions).toEqual({
          before: ['read'],
          after: ['read', 'write'],
        });
      });

      it('should detect permissions order change', () => {
        const before = { permissions: ['read', 'write'] };
        const after = { permissions: ['write', 'read'] };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes.permissions).toEqual({
          before: ['read', 'write'],
          after: ['write', 'read'],
        });
      });

      it('should not detect permissions change when identical', () => {
        const before = { permissions: ['read', 'write'] };
        const after = { permissions: ['read', 'write'] };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes.permissions).toBeUndefined();
      });

      it('should detect permissions change from null to array', () => {
        const before = { permissions: null };
        const after = { permissions: ['read'] };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes.permissions).toEqual({
          before: null,
          after: ['read'],
        });
      });

      it('should detect permissions change from array to null', () => {
        const before = { permissions: ['read'] };
        const after = { permissions: null };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes.permissions).toEqual({
          before: ['read'],
          after: null,
        });
      });
    });

    describe('untracked fields', () => {
      it('should not track id changes', () => {
        const before = { id: 'member-123' };
        const after = { id: 'member-456' };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes.id).toBeUndefined();
      });

      it('should not track account_id changes', () => {
        const before = { account_id: 'account-123' };
        const after = { account_id: 'account-456' };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes.account_id).toBeUndefined();
      });

      it('should not track project_id changes', () => {
        const before = { project_id: 'project-123' };
        const after = { project_id: 'project-456' };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes.project_id).toBeUndefined();
      });

      it('should not track created_at changes', () => {
        const before = { created_at: '2024-01-01T00:00:00Z' };
        const after = { created_at: '2024-01-02T00:00:00Z' };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes.created_at).toBeUndefined();
      });

      it('should not track updated_at changes', () => {
        const before = { updated_at: '2024-01-01T00:00:00Z' };
        const after = { updated_at: '2024-01-02T00:00:00Z' };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes.updated_at).toBeUndefined();
      });
    });

    describe('multiple field changes', () => {
      it('should detect multiple tracked field changes', () => {
        const before = {
          role: 'member',
          permissions: ['read'],
          user_id: 'user-123',
        };
        const after = {
          role: 'admin',
          permissions: ['read', 'write', 'delete'],
          user_id: 'user-123',
        };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes.role).toEqual({
          before: 'member',
          after: 'admin',
        });
        expect(changes.permissions).toEqual({
          before: ['read'],
          after: ['read', 'write', 'delete'],
        });
        expect(changes.user_id).toBeUndefined(); // No change
      });

      it('should track only changed fields in mixed object', () => {
        const before = {
          role: 'member',
          permissions: ['read'],
          account_id: 'account-123', // Untracked
          created_at: '2024-01-01T00:00:00Z', // Untracked
        };
        const after = {
          role: 'admin',
          permissions: ['read'], // No change
          account_id: 'account-456', // Untracked
          created_at: '2024-01-02T00:00:00Z', // Untracked
        };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes.role).toEqual({
          before: 'member',
          after: 'admin',
        });
        expect(changes.permissions).toBeUndefined(); // No change
        expect(changes.account_id).toBeUndefined(); // Untracked
        expect(changes.created_at).toBeUndefined(); // Untracked
      });
    });

    describe('no changes', () => {
      it('should return empty object when no fields changed', () => {
        const before = { role: 'admin', permissions: ['read', 'write'] };
        const after = { role: 'admin', permissions: ['read', 'write'] };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes).toEqual({});
      });

      it('should return empty object for identical empty objects', () => {
        const changes = teamMemberTransformer.calculateChanges({}, {});
        expect(changes).toEqual({});
      });
    });

    describe('edge cases', () => {
      it('should handle null to value transition', () => {
        const before = { role: null };
        const after = { role: 'admin' };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes.role).toEqual({
          before: null,
          after: 'admin',
        });
      });

      it('should handle value to null transition', () => {
        const before = { role: 'admin' };
        const after = { role: null };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes.role).toEqual({
          before: 'admin',
          after: null,
        });
      });

      it('should handle undefined to value transition', () => {
        const before = { role: undefined };
        const after = { role: 'member' };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes.role).toEqual({
          before: undefined,
          after: 'member',
        });
      });

      it('should handle value to undefined transition', () => {
        const before = { role: 'member' };
        const after = { role: undefined };

        const changes = teamMemberTransformer.calculateChanges(before, after);

        expect(changes.role).toEqual({
          before: 'member',
          after: undefined,
        });
      });
    });
  });
});
