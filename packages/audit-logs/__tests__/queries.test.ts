import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  getAuditLogsByAction,
  getAuditLogsByUser,
  getAuditLogsForObject,
  getAuditLogsForScope,
  getChangeSummary,
  getRecentAuditLogs,
} from '../src/server/queries';

// Mock server-only before imports
vi.mock('server-only', () => ({}));

// Mock dependencies - must define inline to avoid hoisting issues
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() =>
    Promise.resolve({
      error: vi.fn(),
      info: vi.fn(),
    }),
  ),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => ({
    from: vi.fn(),
    rpc: vi.fn(),
  })),
}));

describe('audit-log-queries', () => {
  const mockGetLogger = vi.mocked(getLogger);
  const mockGetSupabaseServerClient = vi.mocked(getSupabaseServerClient);

  const mockSelect = vi.fn();
  const mockEq = vi.fn();
  const mockOrder = vi.fn();
  const mockLimit = vi.fn();
  const mockFrom = vi.fn();
  const mockRpc = vi.fn();
  const mockLogger = {
    error: vi.fn(),
    info: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLogger.mockResolvedValue(mockLogger);
    mockGetSupabaseServerClient.mockReturnValue({
      from: mockFrom,
      rpc: mockRpc,
    } as any);

    // Setup chainable query methods
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ eq: mockEq, order: mockOrder });
    mockOrder.mockReturnValue({ limit: mockLimit });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getAuditLogsForObject', () => {
    it('should fetch audit logs for specific object', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          object_type: 'project',
          object_id: 'project-123',
          action: 'create',
        },
        {
          id: 'log-2',
          object_type: 'project',
          object_id: 'project-123',
          action: 'update',
        },
      ];

      mockLimit.mockResolvedValue({ data: mockLogs, error: null });

      const result = await getAuditLogsForObject('project', 'project-123');

      expect(mockFrom).toHaveBeenCalledWith('audit_logs');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq).toHaveBeenCalledWith('object_type', 'project');
      expect(mockEq).toHaveBeenCalledWith('object_id', 'project-123');
      expect(result).toEqual(mockLogs);
    });

    it('should order by created_at descending', async () => {
      mockLimit.mockResolvedValue({ data: [], error: null });

      await getAuditLogsForObject('project', 'project-123');

      expect(mockOrder).toHaveBeenCalledWith('created_at', {
        ascending: false,
      });
    });

    it('should use default limit of 50', async () => {
      mockLimit.mockResolvedValue({ data: [], error: null });

      await getAuditLogsForObject('project', 'project-123');

      expect(mockLimit).toHaveBeenCalledWith(50);
    });

    it('should use custom limit when provided', async () => {
      mockLimit.mockResolvedValue({ data: [], error: null });

      await getAuditLogsForObject('project', 'project-123', 100);

      expect(mockLimit).toHaveBeenCalledWith(100);
    });

    it('should throw error when query fails', async () => {
      const error = new Error('Database query failed');
      mockLimit.mockResolvedValue({ data: null, error });

      await expect(
        getAuditLogsForObject('project', 'project-123'),
      ).rejects.toThrow(error);
    });

    it('should log error when query fails', async () => {
      const error = new Error('Database query failed');
      mockLimit.mockResolvedValue({ data: null, error });

      await expect(
        getAuditLogsForObject('project', 'project-123'),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'get-audit-logs-for-object',
          objectType: 'project',
          objectId: 'project-123',
          error,
        }),
        'Failed to fetch audit logs',
      );
    });

    it('should handle different object types', async () => {
      mockLimit.mockResolvedValue({ data: [], error: null });

      const objectTypes = ['user', 'account', 'team_member', 'subscription'];

      for (const objectType of objectTypes) {
        mockEq.mockClear();

        await getAuditLogsForObject(objectType, 'object-123');

        expect(mockEq).toHaveBeenCalledWith('object_type', objectType);
      }
    });

    it('should return empty array when no logs found', async () => {
      mockLimit.mockResolvedValue({ data: [], error: null });

      const result = await getAuditLogsForObject('project', 'project-123');

      expect(result).toEqual([]);
    });
  });

  describe('getAuditLogsForScope', () => {
    it('should fetch audit logs for scope using RPC', async () => {
      const mockLogs = [
        { id: 'log-1', object_type: 'project', action: 'create' },
        { id: 'log-2', object_type: 'file', action: 'upload' },
      ];

      mockRpc.mockResolvedValue({ data: mockLogs, error: null });

      const result = await getAuditLogsForScope('project', 'project-123');

      expect(mockRpc).toHaveBeenCalledWith('get_audit_logs_for_scope', {
        scope_type: 'project',
        scope_id: 'project-123',
        limit_count: 50,
      });
      expect(result).toEqual(mockLogs);
    });

    it('should use default limit of 50', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await getAuditLogsForScope('account', 'account-123');

      expect(mockRpc).toHaveBeenCalledWith(
        'get_audit_logs_for_scope',
        expect.objectContaining({
          limit_count: 50,
        }),
      );
    });

    it('should use custom limit when provided', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await getAuditLogsForScope('account', 'account-123', 200);

      expect(mockRpc).toHaveBeenCalledWith(
        'get_audit_logs_for_scope',
        expect.objectContaining({
          limit_count: 200,
        }),
      );
    });

    it('should throw error when RPC fails', async () => {
      const error = new Error('RPC failed');
      mockRpc.mockResolvedValue({ data: null, error });

      await expect(
        getAuditLogsForScope('project', 'project-123'),
      ).rejects.toThrow(error);
    });

    it('should log error when RPC fails', async () => {
      const error = new Error('RPC failed');
      mockRpc.mockResolvedValue({ data: null, error });

      await expect(
        getAuditLogsForScope('project', 'project-123'),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'get-audit-logs-for-scope',
          scopeType: 'project',
          scopeId: 'project-123',
          error,
        }),
        'Failed to fetch audit logs for scope',
      );
    });

    it('should handle different scope types', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      const scopeTypes = ['account', 'project', 'team'];

      for (const scopeType of scopeTypes) {
        mockRpc.mockClear();

        await getAuditLogsForScope(scopeType, 'scope-123');

        expect(mockRpc).toHaveBeenCalledWith(
          'get_audit_logs_for_scope',
          expect.objectContaining({
            scope_type: scopeType,
          }),
        );
      }
    });
  });

  describe('getRecentAuditLogs', () => {
    it('should fetch recent audit logs for account using RPC', async () => {
      const mockLogs = [
        { id: 'log-1', action: 'create', created_at: '2025-01-20' },
        { id: 'log-2', action: 'update', created_at: '2025-01-19' },
      ];

      mockRpc.mockResolvedValue({ data: mockLogs, error: null });

      const result = await getRecentAuditLogs('account-123');

      expect(mockRpc).toHaveBeenCalledWith('get_recent_audit_logs', {
        target_account_id: 'account-123',
        limit_count: 100,
      });
      expect(result).toEqual(mockLogs);
    });

    it('should use default limit of 100', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await getRecentAuditLogs('account-123');

      expect(mockRpc).toHaveBeenCalledWith(
        'get_recent_audit_logs',
        expect.objectContaining({
          limit_count: 100,
        }),
      );
    });

    it('should use custom limit when provided', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await getRecentAuditLogs('account-123', 500);

      expect(mockRpc).toHaveBeenCalledWith(
        'get_recent_audit_logs',
        expect.objectContaining({
          limit_count: 500,
        }),
      );
    });

    it('should throw error when RPC fails', async () => {
      const error = new Error('RPC failed');
      mockRpc.mockResolvedValue({ data: null, error });

      await expect(getRecentAuditLogs('account-123')).rejects.toThrow(error);
    });

    it('should log error when RPC fails', async () => {
      const error = new Error('RPC failed');
      mockRpc.mockResolvedValue({ data: null, error });

      await expect(getRecentAuditLogs('account-123')).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'get-recent-audit-logs',
          accountId: 'account-123',
          error,
        }),
        'Failed to fetch recent audit logs',
      );
    });
  });

  describe('getAuditLogsByUser', () => {
    it('should fetch audit logs by user using RPC', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          user_id: 'user-123',
          action: 'create',
        },
        {
          id: 'log-2',
          user_id: 'user-123',
          action: 'update',
        },
      ];

      mockRpc.mockResolvedValue({ data: mockLogs, error: null });

      const result = await getAuditLogsByUser('user-123', 'account-123');

      expect(mockRpc).toHaveBeenCalledWith('get_audit_logs_by_user', {
        target_user_id: 'user-123',
        target_account_id: 'account-123',
        limit_count: 50,
      });
      expect(result).toEqual(mockLogs);
    });

    it('should use default limit of 50', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await getAuditLogsByUser('user-123', 'account-123');

      expect(mockRpc).toHaveBeenCalledWith(
        'get_audit_logs_by_user',
        expect.objectContaining({
          limit_count: 50,
        }),
      );
    });

    it('should use custom limit when provided', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await getAuditLogsByUser('user-123', 'account-123', 300);

      expect(mockRpc).toHaveBeenCalledWith(
        'get_audit_logs_by_user',
        expect.objectContaining({
          limit_count: 300,
        }),
      );
    });

    it('should throw error when RPC fails', async () => {
      const error = new Error('RPC failed');
      mockRpc.mockResolvedValue({ data: null, error });

      await expect(
        getAuditLogsByUser('user-123', 'account-123'),
      ).rejects.toThrow(error);
    });

    it('should log error when RPC fails', async () => {
      const error = new Error('RPC failed');
      mockRpc.mockResolvedValue({ data: null, error });

      await expect(
        getAuditLogsByUser('user-123', 'account-123'),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'get-audit-logs-by-user',
          userId: 'user-123',
          accountId: 'account-123',
          error,
        }),
        'Failed to fetch audit logs by user',
      );
    });
  });

  describe('getAuditLogsByAction', () => {
    it('should fetch audit logs by action using RPC', async () => {
      const mockLogs = [
        { id: 'log-1', action: 'create', object_type: 'project' },
        { id: 'log-2', action: 'create', object_type: 'user' },
      ];

      mockRpc.mockResolvedValue({ data: mockLogs, error: null });

      const result = await getAuditLogsByAction('account-123', 'create');

      expect(mockRpc).toHaveBeenCalledWith('get_audit_logs_by_action', {
        target_account_id: 'account-123',
        target_action: 'create',
        limit_count: 50,
      });
      expect(result).toEqual(mockLogs);
    });

    it('should use default limit of 50', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await getAuditLogsByAction('account-123', 'update');

      expect(mockRpc).toHaveBeenCalledWith(
        'get_audit_logs_by_action',
        expect.objectContaining({
          limit_count: 50,
        }),
      );
    });

    it('should use custom limit when provided', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await getAuditLogsByAction('account-123', 'delete', 150);

      expect(mockRpc).toHaveBeenCalledWith(
        'get_audit_logs_by_action',
        expect.objectContaining({
          limit_count: 150,
        }),
      );
    });

    it('should handle different action types', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      const actions = [
        'create',
        'update',
        'delete',
        'archive',
        'login',
      ] as const;

      for (const action of actions) {
        mockRpc.mockClear();

        await getAuditLogsByAction('account-123', action);

        expect(mockRpc).toHaveBeenCalledWith(
          'get_audit_logs_by_action',
          expect.objectContaining({
            target_action: action,
          }),
        );
      }
    });

    it('should throw error when RPC fails', async () => {
      const error = new Error('RPC failed');
      mockRpc.mockResolvedValue({ data: null, error });

      await expect(
        getAuditLogsByAction('account-123', 'create'),
      ).rejects.toThrow(error);
    });

    it('should log error when RPC fails', async () => {
      const error = new Error('RPC failed');
      mockRpc.mockResolvedValue({ data: null, error });

      await expect(
        getAuditLogsByAction('account-123', 'create'),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'get-audit-logs-by-action',
          accountId: 'account-123',
          action: 'create',
          error,
        }),
        'Failed to fetch audit logs by action',
      );
    });
  });

  describe('getChangeSummary', () => {
    it('should fetch change summary using RPC', async () => {
      const mockSummary = [
        { field_name: 'name', change_count: 15 },
        { field_name: 'description', change_count: 8 },
        { field_name: 'status', change_count: 5 },
      ];

      mockRpc.mockResolvedValue({ data: mockSummary, error: null });

      const result = await getChangeSummary('account-123', 'project');

      expect(mockRpc).toHaveBeenCalledWith('get_change_summary', {
        target_account_id: 'account-123',
        target_object_type: 'project',
        days_back: 30,
      });
      expect(result).toEqual(mockSummary);
    });

    it('should use default daysBack of 30', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await getChangeSummary('account-123', 'project');

      expect(mockRpc).toHaveBeenCalledWith(
        'get_change_summary',
        expect.objectContaining({
          days_back: 30,
        }),
      );
    });

    it('should use custom daysBack when provided', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await getChangeSummary('account-123', 'project', 90);

      expect(mockRpc).toHaveBeenCalledWith(
        'get_change_summary',
        expect.objectContaining({
          days_back: 90,
        }),
      );
    });

    it('should handle different object types', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      const objectTypes = ['project', 'user', 'account', 'team_member'];

      for (const objectType of objectTypes) {
        mockRpc.mockClear();

        await getChangeSummary('account-123', objectType);

        expect(mockRpc).toHaveBeenCalledWith(
          'get_change_summary',
          expect.objectContaining({
            target_object_type: objectType,
          }),
        );
      }
    });

    it('should return empty array when no data', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });

      const result = await getChangeSummary('account-123', 'project');

      expect(result).toEqual([]);
    });

    it('should return empty array when data is undefined', async () => {
      mockRpc.mockResolvedValue({ data: undefined, error: null });

      const result = await getChangeSummary('account-123', 'project');

      expect(result).toEqual([]);
    });

    it('should throw error when RPC fails', async () => {
      const error = new Error('RPC failed');
      mockRpc.mockResolvedValue({ data: null, error });

      await expect(getChangeSummary('account-123', 'project')).rejects.toThrow(
        error,
      );
    });

    it('should log error when RPC fails', async () => {
      const error = new Error('RPC failed');
      mockRpc.mockResolvedValue({ data: null, error });

      await expect(
        getChangeSummary('account-123', 'project'),
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'get-change-summary',
          accountId: 'account-123',
          objectType: 'project',
          daysBack: 30,
          error,
        }),
        'Failed to fetch change summary',
      );
    });
  });

  describe('error handling across all functions', () => {
    it('should handle network errors', async () => {
      const networkError = new Error('Network timeout');
      mockLimit.mockRejectedValue(networkError);

      await expect(
        getAuditLogsForObject('project', 'project-123'),
      ).rejects.toThrow(networkError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: networkError,
        }),
        expect.any(String),
      );
    });

    it('should handle database errors', async () => {
      const dbError = new Error('Connection refused');
      mockRpc.mockRejectedValue(dbError);

      await expect(getRecentAuditLogs('account-123')).rejects.toThrow(dbError);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: dbError,
        }),
        expect.any(String),
      );
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete audit log workflow', async () => {
      // Get audit logs for object
      mockLimit.mockResolvedValue({
        data: [{ id: 'log-1', object_type: 'project' }],
        error: null,
      });

      const objectLogs = await getAuditLogsForObject('project', 'project-123');
      expect(objectLogs).toHaveLength(1);

      // Get recent logs for account
      mockRpc.mockResolvedValue({
        data: [{ id: 'log-1' }, { id: 'log-2' }, { id: 'log-3' }],
        error: null,
      });

      const recentLogs = await getRecentAuditLogs('account-123');
      expect(recentLogs).toHaveLength(3);

      // Get change summary
      mockRpc.mockResolvedValue({
        data: [{ field_name: 'name', change_count: 10 }],
        error: null,
      });

      const summary = await getChangeSummary('account-123', 'project');
      expect(summary).toHaveLength(1);
    });

    it('should handle empty results gracefully', async () => {
      mockLimit.mockResolvedValue({ data: [], error: null });
      mockRpc.mockResolvedValue({ data: [], error: null });

      const objectLogs = await getAuditLogsForObject('project', 'project-123');
      const scopeLogs = await getAuditLogsForScope('project', 'project-123');
      const recentLogs = await getRecentAuditLogs('account-123');
      const userLogs = await getAuditLogsByUser('user-123', 'account-123');
      const actionLogs = await getAuditLogsByAction('account-123', 'create');

      expect(objectLogs).toEqual([]);
      expect(scopeLogs).toEqual([]);
      expect(recentLogs).toEqual([]);
      expect(userLogs).toEqual([]);
      expect(actionLogs).toEqual([]);
    });
  });
});
