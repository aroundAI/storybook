import type { SupabaseClient, User } from '@supabase/supabase-js';

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuditLog } from '@kit/audit-logs/server';
import { unwrap } from '@kit/next/action-result';

import {
  addProjectMemberAction,
  createProjectAction,
  deleteProjectAction,
  removeProjectMemberAction,
  updateProjectAction,
  updateProjectMemberAction,
} from '../src/lib/server/project.mutations';
import { TEAM_ONLY } from '../src/lib/team-only';

// Mock dependencies
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(async () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@kit/audit-logs/server', () => ({
  createAuditLog: vi.fn(),
  extractNetworkContext: vi.fn(async () => ({
    ip_address: '127.0.0.1',
    user_agent: 'test-agent',
  })),
}));

// Valid UUIDs for testing
const ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';
const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440001';
const USER_ID = '550e8400-e29b-41d4-a716-446655440002';
const MEMBER_USER_ID = '550e8400-e29b-41d4-a716-446655440003';

// Mock Supabase client
const mockFrom = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockGetUser = vi.fn();
const mockGetClaims = vi.fn();
const mockGetAuthenticatorAssuranceLevel = vi.fn();

const mockSupabaseClient = {
  from: mockFrom,
  auth: {
    getUser: mockGetUser,
    getClaims: mockGetClaims,
    mfa: {
      getAuthenticatorAssuranceLevel: mockGetAuthenticatorAssuranceLevel,
    },
    suppressGetSessionWarning: false,
  },
} as unknown as SupabaseClient;

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => mockSupabaseClient),
}));

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: vi.fn(async () => ({
    data: {
      id: USER_ID,
      email: 'test@example.com',
      aud: 'authenticated',
      role: 'authenticated',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as User,
    error: null,
  })),
}));

describe('Project Mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default auth mocks
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: 'test@example.com' } },
      error: null,
    });

    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: USER_ID, email: 'test@example.com' } },
      error: null,
    });

    mockGetAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal1' },
      error: null,
    });
  });

  describe('createProjectAction', () => {
    beforeEach(() => {
      mockFrom.mockReturnValue({
        insert: mockInsert,
      });

      mockInsert.mockReturnValue({
        select: mockSelect,
      });

      mockSelect.mockReturnValue({
        single: mockSingle,
      });
    });

    it('should create a new project successfully', async () => {
      const mockProject = {
        id: PROJECT_ID,
        account_id: ACCOUNT_ID,
        name: 'Test Project',
        description: 'Test description',
        slug: 'test-project',
        status: 'active',
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSingle.mockResolvedValue({ data: mockProject, error: null });

      const result = await unwrap(
        createProjectAction({
          account_id: ACCOUNT_ID,
          name: 'Test Project',
          description: 'Test description',
          slug: 'test-project',
          metadata: {},
        }),
      );

      expect(mockFrom).toHaveBeenCalledWith('projects');
      expect(mockInsert).toHaveBeenCalledWith({
        account_id: ACCOUNT_ID,
        name: 'Test Project',
        description: 'Test description',
        slug: 'test-project',
        metadata: {},
      });
      expect(result).toEqual({ success: true, data: mockProject });
    });

    it('should create project with minimal fields', async () => {
      const mockProject = {
        id: PROJECT_ID,
        account_id: ACCOUNT_ID,
        name: 'Minimal Project',
        description: null,
        slug: null,
        status: 'active',
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSingle.mockResolvedValue({ data: mockProject, error: null });

      const result = await unwrap(
        createProjectAction({
          account_id: ACCOUNT_ID,
          name: 'Minimal Project',
        }),
      );

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Minimal Project');
    });

    it('should throw error when project creation fails', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'Duplicate slug' },
      });

      await expect(
        unwrap(
          createProjectAction({
            account_id: ACCOUNT_ID,
            name: 'Test Project',
            slug: 'duplicate',
          }),
        ),
      ).rejects.toThrow('Failed to create project: Duplicate slug');
    });

    // KB-6: a production build replaces the message of a thrown error, so
    // the one failure a user causes is returned, in words written for them.
    it('returns a taken slug as a refusal, without the constraint name', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "projects_account_id_slug_key"',
        },
      });

      const result = await createProjectAction({
        account_id: ACCOUNT_ID,
        name: 'Test Project',
        slug: 'duplicate',
      });

      expect(result).toEqual({
        ok: false,
        error:
          'A project with this slug already exists in this workspace. Choose a different slug.',
      });
      expect(JSON.stringify(result)).not.toContain(
        'projects_account_id_slug_key',
      );
    });

    // KB-99: the product is team accounts only, and the database refuses a
    // project on a personal account. The person gets the database's own
    // sentence, as a value, not a redacted throw.
    it('returns a personal account as the team-only refusal', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: {
          code: '23514',
          message: TEAM_ONLY,
          details: 'projects.account_id names a personal account',
        },
      });

      const result = await createProjectAction({
        account_id: ACCOUNT_ID,
        name: 'Mine',
        slug: 'mine',
      });

      expect(result).toEqual({ ok: false, error: TEAM_ONLY });
    });

    it('says what the migration says', () => {
      const migrations = path.resolve(
        __dirname,
        '../../../../apps/web/supabase/migrations',
      );
      const file = readdirSync(migrations).find((name) =>
        name.endsWith('_kb99-team-account-guard.sql'),
      );

      expect(file).toBeDefined();
      expect(readFileSync(path.join(migrations, file!), 'utf8')).toContain(
        `message = '${TEAM_ONLY}'`,
      );
    });

    it('should validate UUID format for account_id', async () => {
      await expect(
        unwrap(
          createProjectAction({
            account_id: 'invalid-uuid',
            name: 'Test Project',
          }),
        ),
      ).rejects.toThrow();
    });

    it('should validate slug format', async () => {
      await expect(
        unwrap(
          createProjectAction({
            account_id: ACCOUNT_ID,
            name: 'Test Project',
            slug: 'Invalid Slug!',
          }),
        ),
      ).rejects.toThrow();
    });

    it('should validate name length', async () => {
      await expect(
        unwrap(
          createProjectAction({
            account_id: ACCOUNT_ID,
            name: '',
          }),
        ),
      ).rejects.toThrow();

      await expect(
        unwrap(
          createProjectAction({
            account_id: ACCOUNT_ID,
            name: 'a'.repeat(256),
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('updateProjectAction', () => {
    beforeEach(() => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: mockSingle,
          }),
        }),
        update: mockUpdate,
      });
    });

    it('should update project successfully', async () => {
      const mockBeforeProject = {
        id: PROJECT_ID,
        account_id: ACCOUNT_ID,
        name: 'Old Name',
        description: 'Old description',
        slug: 'old-slug',
        status: 'active',
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockUpdatedProject = {
        ...mockBeforeProject,
        name: 'New Name',
        description: 'New description',
        updated_at: new Date().toISOString(),
      };

      // First call for before state
      mockSingle.mockResolvedValueOnce({
        data: mockBeforeProject,
        error: null,
      });

      // Mock update chain
      mockUpdate.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi
              .fn()
              .mockResolvedValue({ data: mockUpdatedProject, error: null }),
          }),
        }),
      });

      const result = await unwrap(
        updateProjectAction({
          id: PROJECT_ID,
          name: 'New Name',
          description: 'New description',
        }),
      );

      expect(result).toEqual({ success: true, data: mockUpdatedProject });
    });

    it('should update only specified fields', async () => {
      const mockProject = {
        id: PROJECT_ID,
        account_id: ACCOUNT_ID,
        name: 'Updated Name',
        description: 'Old description',
        slug: 'test',
        status: 'active',
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSingle.mockResolvedValueOnce({ data: mockProject, error: null });

      mockUpdate.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi
              .fn()
              .mockResolvedValue({ data: mockProject, error: null }),
          }),
        }),
      });

      await unwrap(
        updateProjectAction({
          id: PROJECT_ID,
          name: 'Updated Name',
        }),
      );

      expect(mockUpdate).toHaveBeenCalledWith({ name: 'Updated Name' });
    });

    it('should update project status', async () => {
      const mockProject = {
        id: PROJECT_ID,
        account_id: ACCOUNT_ID,
        name: 'Test',
        description: null,
        slug: 'test',
        status: 'archived',
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSingle.mockResolvedValueOnce({ data: mockProject, error: null });

      mockUpdate.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi
              .fn()
              .mockResolvedValue({ data: mockProject, error: null }),
          }),
        }),
      });

      const result = await unwrap(
        updateProjectAction({
          id: PROJECT_ID,
          status: 'archived',
        }),
      );

      expect(result.data?.status).toBe('archived');
    });

    it('should throw error when update fails', async () => {
      mockSingle.mockResolvedValueOnce({ data: {}, error: null });

      mockUpdate.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Not found' },
            }),
          }),
        }),
      });

      await expect(
        unwrap(
          updateProjectAction({
            id: PROJECT_ID,
            name: 'New Name',
          }),
        ),
      ).rejects.toThrow('Failed to update project: Not found');
    });
  });

  describe('deleteProjectAction', () => {
    beforeEach(() => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: mockSingle,
          }),
        }),
        delete: mockDelete,
      });
    });

    it('should delete project successfully', async () => {
      const mockProject = {
        id: PROJECT_ID,
        account_id: ACCOUNT_ID,
        name: 'Test Project',
        description: 'Test',
        slug: 'test',
        status: 'active',
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSingle.mockResolvedValue({ data: mockProject, error: null });

      mockDelete.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi
            .fn()
            .mockResolvedValue({ data: [{ id: PROJECT_ID }], error: null }),
        }),
      });

      const result = await deleteProjectAction({ id: PROJECT_ID });

      expect(result).toEqual({ ok: true, data: { success: true } });
      expect(mockDelete).toHaveBeenCalled();
    });

    // KB-61: RLS lets only the owner delete, and filters anyone else's
    // delete to no rows with no error. That was reported, and audited, as
    // a deletion.
    it('refuses, and records nothing, when the delete removed no row', async () => {
      mockSingle.mockResolvedValue({
        data: { id: PROJECT_ID, account_id: ACCOUNT_ID, name: 'Test' },
        error: null,
      });
      mockDelete.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      });
      vi.mocked(createAuditLog).mockClear();

      const result = await deleteProjectAction({ id: PROJECT_ID });

      expect(result).toEqual({
        ok: false,
        error:
          "The project wasn't deleted: it's already gone, or only its owner can delete it. Reload the page.",
      });
      expect(createAuditLog).not.toHaveBeenCalled();
    });

    it('should throw error when deletion fails', async () => {
      mockSingle.mockResolvedValue({ data: {}, error: null });

      mockDelete.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi
            .fn()
            .mockResolvedValue({ error: { message: 'Cannot delete' } }),
        }),
      });

      await expect(deleteProjectAction({ id: PROJECT_ID })).rejects.toThrow(
        'Failed to delete project: Cannot delete',
      );
    });

    it('should validate UUID format', async () => {
      await expect(
        deleteProjectAction({ id: 'invalid-uuid' }),
      ).rejects.toThrow();
    });
  });

  describe('addProjectMemberAction', () => {
    beforeEach(() => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'projects') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    account_id: ACCOUNT_ID,
                    name: 'Test Project',
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'project_members') {
          return {
            insert: mockInsert,
          };
        }
        return {};
      });

      mockInsert.mockReturnValue({
        select: mockSelect,
      });

      mockSelect.mockReturnValue({
        single: mockSingle,
      });
    });

    it('should add member to project successfully', async () => {
      const mockMember = {
        id: '550e8400-e29b-41d4-a716-446655440020',
        project_id: PROJECT_ID,
        user_id: MEMBER_USER_ID,
        role: 'member',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSingle.mockResolvedValue({ data: mockMember, error: null });

      const result = await unwrap(
        addProjectMemberAction({
          project_id: PROJECT_ID,
          user_id: MEMBER_USER_ID,
          role: 'member',
        }),
      );

      expect(result).toEqual({ success: true, data: mockMember });
      expect(mockInsert).toHaveBeenCalledWith({
        project_id: PROJECT_ID,
        user_id: MEMBER_USER_ID,
        role: 'member',
      });
    });

    it('should add member with different roles', async () => {
      const roles = ['owner', 'admin', 'member', 'viewer'] as const;

      for (const role of roles) {
        vi.clearAllMocks();

        // Reset mocks for each iteration
        mockFrom.mockImplementation((table: string) => {
          if (table === 'projects') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { account_id: ACCOUNT_ID, name: 'Test' },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'project_members') {
            return {
              insert: mockInsert.mockReturnValue({
                select: mockSelect.mockReturnValue({
                  single: mockSingle.mockResolvedValue({
                    data: {
                      id: '550e8400-e29b-41d4-a716-446655440020',
                      project_id: PROJECT_ID,
                      user_id: MEMBER_USER_ID,
                      role,
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        });

        const result = await unwrap(
          addProjectMemberAction({
            project_id: PROJECT_ID,
            user_id: MEMBER_USER_ID,
            role,
          }),
        );

        expect(result.data?.role).toBe(role);
      }
    });

    it('should throw error when adding member fails', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'Already a member' },
      });

      await expect(
        unwrap(
          addProjectMemberAction({
            project_id: PROJECT_ID,
            user_id: MEMBER_USER_ID,
            role: 'member',
          }),
        ),
      ).rejects.toThrow('Failed to add project member: Already a member');
    });

    it('returns an existing membership as a refusal', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "project_members_project_id_user_id_key"',
        },
      });

      expect(
        await addProjectMemberAction({
          project_id: PROJECT_ID,
          user_id: MEMBER_USER_ID,
          role: 'member',
        }),
      ).toEqual({
        ok: false,
        error: 'This person is already a member of the project.',
      });
    });

    it('returns a second owner as a refusal of its own', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "ix_project_members_owner"',
        },
      });

      expect(
        await addProjectMemberAction({
          project_id: PROJECT_ID,
          user_id: MEMBER_USER_ID,
          role: 'owner',
        }),
      ).toEqual({ ok: false, error: 'A project can have only one owner.' });
    });

    it('should validate UUIDs', async () => {
      await expect(
        unwrap(
          addProjectMemberAction({
            project_id: 'invalid',
            user_id: MEMBER_USER_ID,
            role: 'member',
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('updateProjectMemberAction', () => {
    beforeEach(() => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'projects') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { account_id: ACCOUNT_ID, name: 'Test' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'project_members') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: '550e8400-e29b-41d4-a716-446655440020',
                      project_id: PROJECT_ID,
                      user_id: MEMBER_USER_ID,
                      role: 'member',
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: mockUpdate,
          };
        }
        return {};
      });

      mockUpdate.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: mockSingle,
            }),
          }),
        }),
      });
    });

    it('should update member role successfully', async () => {
      const mockUpdatedMember = {
        id: '550e8400-e29b-41d4-a716-446655440020',
        project_id: PROJECT_ID,
        user_id: MEMBER_USER_ID,
        role: 'admin',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSingle.mockResolvedValue({ data: mockUpdatedMember, error: null });

      const result = await updateProjectMemberAction({
        project_id: PROJECT_ID,
        user_id: MEMBER_USER_ID,
        role: 'admin',
      });

      expect(result).toEqual({ success: true, data: mockUpdatedMember });
      expect(mockUpdate).toHaveBeenCalledWith({ role: 'admin' });
    });

    it('should throw error when update fails', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      await expect(
        updateProjectMemberAction({
          project_id: PROJECT_ID,
          user_id: MEMBER_USER_ID,
          role: 'admin',
        }),
      ).rejects.toThrow('Failed to update project member: Not found');
    });
  });

  describe('removeProjectMemberAction', () => {
    beforeEach(() => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'projects') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { account_id: ACCOUNT_ID, name: 'Test' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'project_members') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: '550e8400-e29b-41d4-a716-446655440020',
                      project_id: PROJECT_ID,
                      user_id: MEMBER_USER_ID,
                      role: 'member',
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            delete: mockDelete,
          };
        }
        return {};
      });

      mockDelete.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi
              .fn()
              .mockResolvedValue({ data: [{ id: 'm' }], error: null }),
          }),
        }),
      });
    });

    it('should remove member from project successfully', async () => {
      const result = await removeProjectMemberAction({
        project_id: PROJECT_ID,
        user_id: MEMBER_USER_ID,
      });

      expect(result).toEqual({ ok: true, data: { success: true } });
      expect(mockDelete).toHaveBeenCalled();
    });

    it('refuses when the delete removed no row (KB-61)', async () => {
      mockDelete.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      });

      const result = await removeProjectMemberAction({
        project_id: PROJECT_ID,
        user_id: MEMBER_USER_ID,
      });

      expect(result).toMatchObject({ ok: false });
    });

    it('should throw error when removal fails', async () => {
      mockDelete.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi
              .fn()
              .mockResolvedValue({ error: { message: 'Cannot remove owner' } }),
          }),
        }),
      });

      await expect(
        removeProjectMemberAction({
          project_id: PROJECT_ID,
          user_id: MEMBER_USER_ID,
        }),
      ).rejects.toThrow('Failed to remove project member: Cannot remove owner');
    });

    it('should validate UUIDs', async () => {
      await expect(
        removeProjectMemberAction({
          project_id: 'invalid',
          user_id: MEMBER_USER_ID,
        }),
      ).rejects.toThrow();
    });
  });
});
