import type { SupabaseClient } from '@supabase/supabase-js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canPerformProjectAction,
  getAccountProjects,
  getAvailableProjectMembers,
  getProject,
  getProjectMembers,
  getUserProjectRole,
  hasProjectRole,
} from '../src/lib/server/project.queries';
import type {
  ProjectMemberWithUser,
  ProjectRole,
  ProjectWithRole,
} from '../src/lib/types';

// Mock dependencies
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(async () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('react', () => ({
  cache: (fn: unknown) => fn,
}));

// Mock cache to always return cache miss
vi.mock('@kit/cache', () => ({
  createCacheClient: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null), // Always cache miss
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Valid UUIDs for testing
const ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440000';
const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440001';
const USER_ID = '550e8400-e29b-41d4-a716-446655440002';
const MEMBER_USER_ID = '550e8400-e29b-41d4-a716-446655440003';

// Mock Supabase client
const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockGetUser = vi.fn();

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => ({
    from: mockFrom,
    rpc: mockRpc,
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

describe('Project Queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default auth mock
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: 'test@example.com' } },
      error: null,
    });
  });

  describe('getAccountProjects', () => {
    it('should fetch all projects for an account with user roles', async () => {
      const mockProjects: ProjectWithRole[] = [
        {
          id: PROJECT_ID,
          account_id: ACCOUNT_ID,
          name: 'Project Alpha',
          description: 'Test project',
          slug: 'project-alpha',
          status: 'active',
          metadata: {},
          brand: {},
          edit_policy: {},
          audio_settings: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: USER_ID,
          updated_by: USER_ID,
          user_role: 'owner',
          public_slug: null,
          seo_metadata: null,
          visibility: 'private',
          sequel_of: null,
        },
        {
          id: '550e8400-e29b-41d4-a716-446655440010',
          account_id: ACCOUNT_ID,
          name: 'Project Beta',
          description: null,
          slug: 'project-beta',
          status: 'active',
          metadata: null,
          brand: {},
          edit_policy: {},
          audio_settings: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: USER_ID,
          updated_by: USER_ID,
          user_role: 'admin',
          public_slug: null,
          seo_metadata: null,
          visibility: 'private',
          sequel_of: null,
        },
      ];

      mockRpc.mockResolvedValue({ data: mockProjects, error: null });

      const result = await getAccountProjects(ACCOUNT_ID);

      expect(mockRpc).toHaveBeenCalledWith('get_account_projects', {
        target_account_id: ACCOUNT_ID,
      });
      expect(result).toEqual(mockProjects);
      expect(result[0]?.user_role).toBe('owner');
      expect(result[1]?.user_role).toBe('admin');
    });

    it('should throw error when RPC fails', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC failed' },
      });

      await expect(getAccountProjects(ACCOUNT_ID)).rejects.toThrow(
        'Failed to fetch projects: RPC failed',
      );
    });

    it('should return empty array when no projects exist', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      const result = await getAccountProjects(ACCOUNT_ID);

      expect(result).toEqual([]);
    });
  });

  describe('getProject', () => {
    it('should fetch a single project by ID', async () => {
      const mockProject = {
        id: PROJECT_ID,
        account_id: ACCOUNT_ID,
        name: 'Test Project',
        description: 'Project description',
        slug: 'test-project',
        status: 'active',
        metadata: { key: 'value' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi
              .fn()
              .mockResolvedValue({ data: mockProject, error: null }),
          }),
        }),
      });

      const result = await getProject(PROJECT_ID);

      expect(mockFrom).toHaveBeenCalledWith('projects');
      expect(result).toEqual(mockProject);
    });

    it('should return null for PGRST116 error (not found)', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi
              .fn()
              .mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
          }),
        }),
      });

      const result = await getProject(PROJECT_ID);

      expect(result).toBeNull();
    });

    it('should throw error for non-PGRST116 database errors', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: '42P01', message: 'Table not found' },
            }),
          }),
        }),
      });

      await expect(getProject(PROJECT_ID)).rejects.toThrow(
        'Failed to fetch project: Table not found',
      );
    });
  });

  describe('getProjectMembers', () => {
    it('should fetch project members with user information', async () => {
      const mockRpcData = [
        {
          id: '550e8400-e29b-41d4-a716-446655440020',
          project_id: PROJECT_ID,
          user_id: USER_ID,
          role: 'owner',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          user_name: 'John Doe',
          user_email: 'john@example.com',
          user_picture_url: 'https://example.com/john.jpg',
        },
        {
          id: '550e8400-e29b-41d4-a716-446655440021',
          project_id: PROJECT_ID,
          user_id: MEMBER_USER_ID,
          role: 'member',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          user_name: 'Jane Smith',
          user_email: 'jane@example.com',
          user_picture_url: null,
        },
      ];

      mockRpc.mockResolvedValue({ data: mockRpcData, error: null });

      const result = await getProjectMembers(PROJECT_ID);

      expect(mockRpc).toHaveBeenCalledWith('get_project_members', {
        target_project_id: PROJECT_ID,
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: mockRpcData[0]!.id,
        project_id: PROJECT_ID,
        user_id: USER_ID,
        role: 'owner',
        created_at: mockRpcData[0]!.created_at,
        updated_at: mockRpcData[0]!.updated_at,
        user: {
          id: USER_ID,
          name: 'John Doe',
          email: 'john@example.com',
          picture_url: 'https://example.com/john.jpg',
        },
      });
    });

    it('should return empty array when no members found', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });

      const result = await getProjectMembers(PROJECT_ID);

      expect(result).toEqual([]);
    });

    it('should throw error when RPC fails', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Permission denied' },
      });

      await expect(getProjectMembers(PROJECT_ID)).rejects.toThrow(
        'Failed to fetch project members: Permission denied',
      );
    });
  });

  describe('hasProjectRole', () => {
    it('should return true when user has specific role', async () => {
      mockRpc.mockResolvedValue({ data: true, error: null });

      const result = await hasProjectRole(PROJECT_ID, 'owner');

      expect(mockRpc).toHaveBeenCalledWith('has_role_on_project', {
        target_project_id: PROJECT_ID,
        target_role: 'owner',
      });
      expect(result).toBe(true);
    });

    it('should return false when user does not have role', async () => {
      mockRpc.mockResolvedValue({ data: false, error: null });

      const result = await hasProjectRole(PROJECT_ID, 'admin');

      expect(result).toBe(false);
    });

    it('should check for any role when role parameter is undefined', async () => {
      mockRpc.mockResolvedValue({ data: true, error: null });

      const result = await hasProjectRole(PROJECT_ID);

      expect(mockRpc).toHaveBeenCalledWith('has_role_on_project', {
        target_project_id: PROJECT_ID,
        target_role: undefined,
      });
      expect(result).toBe(true);
    });

    it('should return false when RPC fails', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Error checking role' },
      });

      const result = await hasProjectRole(PROJECT_ID, 'member');

      expect(result).toBe(false);
    });
  });

  describe('canPerformProjectAction', () => {
    const testCases: Array<{
      action:
        | 'project.view'
        | 'project.edit'
        | 'project.delete'
        | 'project.members.view'
        | 'project.members.add'
        | 'project.members.remove'
        | 'project.settings.view'
        | 'project.settings.edit';
      canPerform: boolean;
    }> = [
      { action: 'project.view', canPerform: true },
      { action: 'project.edit', canPerform: true },
      { action: 'project.delete', canPerform: false },
      { action: 'project.members.view', canPerform: true },
      { action: 'project.members.add', canPerform: true },
      { action: 'project.members.remove', canPerform: false },
      { action: 'project.settings.view', canPerform: true },
      { action: 'project.settings.edit', canPerform: false },
    ];

    testCases.forEach(({ action, canPerform }) => {
      it(`should return ${canPerform} for ${action}`, async () => {
        mockRpc.mockResolvedValue({ data: canPerform, error: null });

        const result = await canPerformProjectAction(PROJECT_ID, action);

        expect(mockRpc).toHaveBeenCalledWith('can_perform_project_action', {
          target_project_id: PROJECT_ID,
          action,
        });
        expect(result).toBe(canPerform);
      });
    });

    it('should return false when RPC fails', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Permission check failed' },
      });

      const result = await canPerformProjectAction(PROJECT_ID, 'project.edit');

      expect(result).toBe(false);
    });
  });

  describe('getUserProjectRole', () => {
    beforeEach(() => {
      mockFrom.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq,
      });
      mockEq.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: mockSingle,
        }),
      });
    });

    it('should return user role on project', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      });

      mockSingle.mockResolvedValue({
        data: { role: 'admin' },
        error: null,
      });

      const result = await getUserProjectRole(PROJECT_ID);

      expect(mockFrom).toHaveBeenCalledWith('project_members');
      expect(result).toBe('admin');
    });

    it('should return null when user is not authenticated', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const result = await getUserProjectRole(PROJECT_ID);

      expect(result).toBeNull();
    });

    it('should return null when user is not a project member', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      });

      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'Not a member' },
      });

      const result = await getUserProjectRole(PROJECT_ID);

      expect(result).toBeNull();
    });

    it('should handle all role types', async () => {
      const roles: ProjectRole[] = ['owner', 'admin', 'member', 'viewer'];

      for (const role of roles) {
        mockGetUser.mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        });

        mockSingle.mockResolvedValue({
          data: { role },
          error: null,
        });

        const result = await getUserProjectRole(PROJECT_ID);
        expect(result).toBe(role);
      }
    });
  });

  describe('getAvailableProjectMembers', () => {
    const ACCOUNT_SLUG = 'test-account';

    beforeEach(() => {
      mockFrom.mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq,
      });
    });

    it('should return account members not in project', async () => {
      const mockAccountMembers = [
        {
          user_id: USER_ID,
          name: 'John Doe',
          email: 'john@example.com',
          picture_url: null,
        },
        {
          user_id: MEMBER_USER_ID,
          name: 'Jane Smith',
          email: 'jane@example.com',
          picture_url: null,
        },
        {
          user_id: '550e8400-e29b-41d4-a716-446655440030',
          name: 'Bob Wilson',
          email: 'bob@example.com',
          picture_url: null,
        },
      ];

      const mockProjectMembers = [
        { user_id: USER_ID },
        { user_id: MEMBER_USER_ID },
      ];

      // First RPC call for account members
      mockRpc.mockResolvedValueOnce({
        data: mockAccountMembers,
        error: null,
      });

      // Second query for project members
      mockEq.mockResolvedValue({
        data: mockProjectMembers,
        error: null,
      });

      const result = await getAvailableProjectMembers(PROJECT_ID, ACCOUNT_SLUG);

      expect(mockRpc).toHaveBeenCalledWith('get_account_members', {
        account_slug: ACCOUNT_SLUG,
      });
      expect(mockFrom).toHaveBeenCalledWith('project_members');
      expect(result).toHaveLength(1);
      expect(result[0]?.user_id).toBe('550e8400-e29b-41d4-a716-446655440030');
      expect(result[0]?.name).toBe('Bob Wilson');
    });

    it('should return all account members when project has no members', async () => {
      const mockAccountMembers = [
        {
          user_id: USER_ID,
          name: 'John Doe',
          email: 'john@example.com',
          picture_url: null,
        },
      ];

      mockRpc.mockResolvedValueOnce({
        data: mockAccountMembers,
        error: null,
      });

      mockEq.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await getAvailableProjectMembers(PROJECT_ID, ACCOUNT_SLUG);

      expect(result).toEqual(mockAccountMembers);
    });

    it('should return empty array when all account members are in project', async () => {
      const mockAccountMembers = [
        {
          user_id: USER_ID,
          name: 'John Doe',
          email: 'john@example.com',
          picture_url: null,
        },
      ];

      const mockProjectMembers = [{ user_id: USER_ID }];

      mockRpc.mockResolvedValueOnce({
        data: mockAccountMembers,
        error: null,
      });

      mockEq.mockResolvedValue({
        data: mockProjectMembers,
        error: null,
      });

      const result = await getAvailableProjectMembers(PROJECT_ID, ACCOUNT_SLUG);

      expect(result).toEqual([]);
    });

    it('should throw error when fetching account members fails', async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Permission denied' },
      });

      await expect(
        getAvailableProjectMembers(PROJECT_ID, ACCOUNT_SLUG),
      ).rejects.toThrow('Failed to fetch account members: Permission denied');
    });

    it('should throw error when fetching project members fails', async () => {
      mockRpc.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      mockEq.mockResolvedValue({
        data: null,
        error: { message: 'Query failed' },
      });

      await expect(
        getAvailableProjectMembers(PROJECT_ID, ACCOUNT_SLUG),
      ).rejects.toThrow('Failed to fetch project members: Query failed');
    });

    it('should handle null project members array', async () => {
      const mockAccountMembers = [
        {
          user_id: USER_ID,
          name: 'John Doe',
          email: 'john@example.com',
          picture_url: null,
        },
      ];

      mockRpc.mockResolvedValueOnce({
        data: mockAccountMembers,
        error: null,
      });

      mockEq.mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await getAvailableProjectMembers(PROJECT_ID, ACCOUNT_SLUG);

      expect(result).toEqual(mockAccountMembers);
    });
  });
});
