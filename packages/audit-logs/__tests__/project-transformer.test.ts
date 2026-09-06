import { describe, expect, it } from 'vitest';

import { projectTransformer } from '../src/transformers/project-transformer';
import type { AuditAction } from '../src/types';

describe('projectTransformer', () => {
  describe('transform()', () => {
    describe('data validation', () => {
      it('should return primitive values unchanged', async () => {
        expect(await projectTransformer.transform('string', 'create')).toBe(
          'string',
        );
        expect(await projectTransformer.transform(123, 'create')).toBe(123);
        expect(await projectTransformer.transform(true, 'create')).toBe(true);
      });

      it('should return null unchanged', async () => {
        expect(await projectTransformer.transform(null, 'create')).toBe(null);
      });

      it('should return undefined unchanged', async () => {
        expect(await projectTransformer.transform(undefined, 'create')).toBe(
          undefined,
        );
      });
    });

    describe('field selection', () => {
      it('should include only essential fields', async () => {
        const project = {
          id: 'project-123',
          name: 'Test Project',
          slug: 'test-project',
          description: 'A test project',
          status: 'active',
          account_id: 'account-456',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-15T12:00:00Z',
          // Large field that should be excluded
          metadata: { large: 'object', with: 'lots', of: 'data' },
          // Other fields that should be excluded
          internal_notes: 'Private notes',
          settings: { some: 'config' },
        };

        const result = (await projectTransformer.transform(
          project,
          'create',
        )) as Record<string, unknown>;

        // Should include essential fields
        expect(result.id).toBe('project-123');
        expect(result.name).toBe('Test Project');
        expect(result.slug).toBe('test-project');
        expect(result.description).toBe('A test project');
        expect(result.status).toBe('active');
        expect(result.account_id).toBe('account-456');

        // Should exclude large/unnecessary fields
        expect(result.metadata).toBeUndefined();
        expect(result.internal_notes).toBeUndefined();
        expect(result.settings).toBeUndefined();
      });

      it('should handle missing optional fields', async () => {
        const project = {
          id: 'project-123',
          name: 'Minimal Project',
        };

        const result = (await projectTransformer.transform(
          project,
          'create',
        )) as Record<string, unknown>;

        expect(result.id).toBe('project-123');
        expect(result.name).toBe('Minimal Project');
        expect(result.slug).toBeUndefined();
        expect(result.description).toBeUndefined();
        expect(result.status).toBeUndefined();
        expect(result.account_id).toBeUndefined();
      });

      it('should handle null values in fields', async () => {
        const project = {
          id: 'project-123',
          name: null,
          slug: null,
          description: null,
          status: null,
          account_id: null,
        };

        const result = (await projectTransformer.transform(
          project,
          'create',
        )) as Record<string, unknown>;

        expect(result.name).toBeNull();
        expect(result.slug).toBeNull();
        expect(result.description).toBeNull();
        expect(result.status).toBeNull();
        expect(result.account_id).toBeNull();
      });
    });

    describe('date formatting', () => {
      it('should format created_at as ISO string', async () => {
        const project = {
          id: 'project-123',
          created_at: '2024-01-01T00:00:00Z',
        };

        const result = (await projectTransformer.transform(
          project,
          'create',
        )) as Record<string, unknown>;

        expect(result.created_at).toBe('2024-01-01T00:00:00.000Z');
      });

      it('should format updated_at as ISO string', async () => {
        const project = {
          id: 'project-123',
          updated_at: '2024-01-15T12:30:45Z',
        };

        const result = (await projectTransformer.transform(
          project,
          'create',
        )) as Record<string, unknown>;

        expect(result.updated_at).toBe('2024-01-15T12:30:45.000Z');
      });

      it('should return null for missing created_at', async () => {
        const project = {
          id: 'project-123',
        };

        const result = (await projectTransformer.transform(
          project,
          'create',
        )) as Record<string, unknown>;

        expect(result.created_at).toBeNull();
      });

      it('should return null for missing updated_at', async () => {
        const project = {
          id: 'project-123',
        };

        const result = (await projectTransformer.transform(
          project,
          'create',
        )) as Record<string, unknown>;

        expect(result.updated_at).toBeNull();
      });

      it('should handle Date objects', async () => {
        const project = {
          id: 'project-123',
          created_at: new Date('2024-06-15T10:30:00Z'),
          updated_at: new Date('2024-06-20T15:45:00Z'),
        };

        const result = (await projectTransformer.transform(
          project,
          'create',
        )) as Record<string, unknown>;

        expect(result.created_at).toBe('2024-06-15T10:30:00.000Z');
        expect(result.updated_at).toBe('2024-06-20T15:45:00.000Z');
      });

      it('should handle timestamp numbers', async () => {
        const project = {
          id: 'project-123',
          created_at: 1704067200000, // 2024-01-01T00:00:00Z
        };

        const result = (await projectTransformer.transform(
          project,
          'create',
        )) as Record<string, unknown>;

        expect(result.created_at).toBe('2024-01-01T00:00:00.000Z');
      });
    });

    describe('project statuses', () => {
      it('should handle active status', async () => {
        const project = {
          id: 'project-123',
          name: 'Test Project',
          status: 'active',
        };

        const result = (await projectTransformer.transform(
          project,
          'create',
        )) as Record<string, unknown>;

        expect(result.status).toBe('active');
      });

      it('should handle archived status', async () => {
        const project = {
          id: 'project-123',
          name: 'Test Project',
          status: 'archived',
        };

        const result = (await projectTransformer.transform(
          project,
          'create',
        )) as Record<string, unknown>;

        expect(result.status).toBe('archived');
      });
    });
  });

  describe('getDescription()', () => {
    describe('standard actions', () => {
      const project = {
        name: 'My Project',
      };

      it('should describe create action', () => {
        const description = projectTransformer.getDescription!(
          project,
          'create',
        );

        expect(description).toBe('Project "My Project" was created');
      });

      it('should describe update action', () => {
        const description = projectTransformer.getDescription!(
          project,
          'update',
        );

        expect(description).toBe('Project "My Project" was updated');
      });

      it('should describe delete action', () => {
        const description = projectTransformer.getDescription!(
          project,
          'delete',
        );

        expect(description).toBe('Project "My Project" was deleted');
      });

      it('should describe archive action', () => {
        const description = projectTransformer.getDescription!(
          project,
          'archive' as AuditAction,
        );

        expect(description).toBe('Project "My Project" was archived');
      });

      it('should describe restore action', () => {
        const description = projectTransformer.getDescription!(
          project,
          'restore' as AuditAction,
        );

        expect(description).toBe('Project "My Project" was restored');
      });

      it('should describe custom action', () => {
        const description = projectTransformer.getDescription!(
          project,
          'duplicate' as AuditAction,
        );

        expect(description).toBe('Project "My Project" action: duplicate');
      });
    });

    describe('edge cases', () => {
      it('should handle unnamed project', () => {
        const project = {};

        const description = projectTransformer.getDescription!(
          project,
          'create',
        );

        expect(description).toBe('Project "Unnamed project" was created');
      });

      it('should handle null name', () => {
        const project = {
          name: null,
        };

        const description = projectTransformer.getDescription!(
          project,
          'update',
        );

        expect(description).toBe('Project "Unnamed project" was updated');
      });

      it('should handle empty string name', () => {
        const project = {
          name: '',
        };

        const description = projectTransformer.getDescription!(
          project,
          'delete',
        );

        expect(description).toBe('Project "Unnamed project" was deleted');
      });

      it('should handle special characters in name', () => {
        const project = {
          name: 'Project "Alpha" & Beta',
        };

        const description = projectTransformer.getDescription!(
          project,
          'create',
        );

        expect(description).toBe(
          'Project "Project "Alpha" & Beta" was created',
        );
      });
    });
  });

  describe('calculateChanges()', () => {
    describe('invalid inputs', () => {
      it('should return empty object for non-object before', () => {
        const changes = projectTransformer.calculateChanges!('string', {
          name: 'After',
        });

        expect(changes).toEqual({});
      });

      it('should return empty object for non-object after', () => {
        const changes = projectTransformer.calculateChanges!(
          { name: 'Before' },
          'string',
        );

        expect(changes).toEqual({});
      });

      it('should return empty object for null before', () => {
        const changes = projectTransformer.calculateChanges!(null, {
          name: 'After',
        });

        expect(changes).toEqual({});
      });

      it('should return empty object for null after', () => {
        const changes = projectTransformer.calculateChanges!(
          { name: 'Before' },
          null,
        );

        expect(changes).toEqual({});
      });

      it('should return empty object for undefined before', () => {
        const changes = projectTransformer.calculateChanges!(undefined, {
          name: 'After',
        });

        expect(changes).toEqual({});
      });

      it('should return empty object for undefined after', () => {
        const changes = projectTransformer.calculateChanges!(
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

        const changes = projectTransformer.calculateChanges!(before, after);

        expect(changes.name).toEqual({
          before: 'Old Name',
          after: 'New Name',
        });
      });

      it('should detect slug change', () => {
        const before = { slug: 'old-slug' };
        const after = { slug: 'new-slug' };

        const changes = projectTransformer.calculateChanges!(before, after);

        expect(changes.slug).toEqual({
          before: 'old-slug',
          after: 'new-slug',
        });
      });

      it('should detect description change', () => {
        const before = { description: 'Old description' };
        const after = { description: 'New description' };

        const changes = projectTransformer.calculateChanges!(before, after);

        expect(changes.description).toEqual({
          before: 'Old description',
          after: 'New description',
        });
      });

      it('should detect status change', () => {
        const before = { status: 'active' };
        const after = { status: 'archived' };

        const changes = projectTransformer.calculateChanges!(before, after);

        expect(changes.status).toEqual({
          before: 'active',
          after: 'archived',
        });
      });
    });

    describe('multiple changes', () => {
      it('should detect multiple field changes', () => {
        const before = {
          name: 'Old Name',
          slug: 'old-slug',
          description: 'Old description',
          status: 'active',
        };
        const after = {
          name: 'New Name',
          slug: 'new-slug',
          description: 'New description',
          status: 'archived',
        };

        const changes = projectTransformer.calculateChanges!(before, after);

        expect(Object.keys(changes)).toHaveLength(4);
        expect(changes.name).toEqual({ before: 'Old Name', after: 'New Name' });
        expect(changes.slug).toEqual({ before: 'old-slug', after: 'new-slug' });
        expect(changes.description).toEqual({
          before: 'Old description',
          after: 'New description',
        });
        expect(changes.status).toEqual({
          before: 'active',
          after: 'archived',
        });
      });

      it('should only include changed fields', () => {
        const before = {
          name: 'Same Name',
          slug: 'old-slug',
          description: 'Same description',
        };
        const after = {
          name: 'Same Name',
          slug: 'new-slug',
          description: 'Same description',
        };

        const changes = projectTransformer.calculateChanges!(before, after);

        expect(Object.keys(changes)).toHaveLength(1);
        expect(changes.slug).toEqual({
          before: 'old-slug',
          after: 'new-slug',
        });
        expect(changes.name).toBeUndefined();
        expect(changes.description).toBeUndefined();
      });
    });

    describe('untracked fields', () => {
      it('should ignore changes to untracked fields', () => {
        const before = {
          name: 'Same Name',
          account_id: 'account-old',
          metadata: { old: 'data' },
          created_at: '2024-01-01T00:00:00Z',
        };
        const after = {
          name: 'Same Name',
          account_id: 'account-new',
          metadata: { new: 'data' },
          created_at: '2024-01-02T00:00:00Z',
        };

        const changes = projectTransformer.calculateChanges!(before, after);

        // account_id, metadata, and created_at are not tracked
        expect(changes).toEqual({});
      });

      it('should not track id changes', () => {
        const before = { id: 'project-123' };
        const after = { id: 'project-456' };

        const changes = projectTransformer.calculateChanges!(before, after);

        expect(changes.id).toBeUndefined();
      });

      it('should not track account_id changes', () => {
        const before = { account_id: 'account-123' };
        const after = { account_id: 'account-456' };

        const changes = projectTransformer.calculateChanges!(before, after);

        expect(changes.account_id).toBeUndefined();
      });

      it('should not track created_at changes', () => {
        const before = { created_at: '2024-01-01T00:00:00Z' };
        const after = { created_at: '2024-01-02T00:00:00Z' };

        const changes = projectTransformer.calculateChanges!(before, after);

        expect(changes.created_at).toBeUndefined();
      });

      it('should not track updated_at changes', () => {
        const before = { updated_at: '2024-01-01T00:00:00Z' };
        const after = { updated_at: '2024-01-02T00:00:00Z' };

        const changes = projectTransformer.calculateChanges!(before, after);

        expect(changes.updated_at).toBeUndefined();
      });
    });

    describe('null and undefined values', () => {
      it('should detect change from value to null', () => {
        const before = { name: 'Old Name' };
        const after = { name: null };

        const changes = projectTransformer.calculateChanges!(before, after);

        expect(changes.name).toEqual({
          before: 'Old Name',
          after: null,
        });
      });

      it('should detect change from null to value', () => {
        const before = { name: null };
        const after = { name: 'New Name' };

        const changes = projectTransformer.calculateChanges!(before, after);

        expect(changes.name).toEqual({
          before: null,
          after: 'New Name',
        });
      });

      it('should detect change from undefined to value', () => {
        const before = {};
        const after = { name: 'New Name' };

        const changes = projectTransformer.calculateChanges!(before, after);

        expect(changes.name).toEqual({
          before: undefined,
          after: 'New Name',
        });
      });

      it('should detect change from value to undefined', () => {
        const before = { name: 'Old Name' };
        const after = {};

        const changes = projectTransformer.calculateChanges!(before, after);

        expect(changes.name).toEqual({
          before: 'Old Name',
          after: undefined,
        });
      });

      it('should not report change when both are null', () => {
        const before = { name: null };
        const after = { name: null };

        const changes = projectTransformer.calculateChanges!(before, after);

        expect(changes.name).toBeUndefined();
      });

      it('should not report change when both are undefined', () => {
        const before = {};
        const after = {};

        const changes = projectTransformer.calculateChanges!(before, after);

        expect(Object.keys(changes)).toHaveLength(0);
      });
    });

    describe('no changes', () => {
      it('should return empty object when no fields changed', () => {
        const project = {
          name: 'Same Name',
          slug: 'same-slug',
          description: 'Same description',
          status: 'active',
        };

        const changes = projectTransformer.calculateChanges!(project, project);

        expect(changes).toEqual({});
      });

      it('should return empty object when only untracked fields changed', () => {
        const before = {
          name: 'Same Name',
          account_id: 'account-old',
        };
        const after = {
          name: 'Same Name',
          account_id: 'account-new',
        };

        const changes = projectTransformer.calculateChanges!(before, after);

        expect(changes).toEqual({});
      });
    });

    describe('edge cases', () => {
      it('should handle empty objects', () => {
        const changes = projectTransformer.calculateChanges!({}, {});

        expect(changes).toEqual({});
      });

      it('should handle objects with only untracked fields', () => {
        const before = { account_id: 'account-123' };
        const after = { account_id: 'account-456' };

        const changes = projectTransformer.calculateChanges!(before, after);

        expect(changes).toEqual({});
      });
    });
  });
});
