import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { getTransformer, shouldTrackObject } from '../src/config';
import { calculateChanges } from '../src/server/calculate-changes';
import {
  createAuditLog,
  createAuditLogsBatch,
} from '../src/server/create-audit-log';

// Mock server-only before imports
vi.mock('server-only', () => ({}));

// Mock dependencies - must define inline to avoid hoisting issues
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(() =>
    Promise.resolve({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    }),
  ),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => ({
    from: vi.fn(),
  })),
}));

vi.mock('../src/config', () => ({
  shouldTrackObject: vi.fn(),
  getTransformer: vi.fn(),
}));

vi.mock('../src/server/calculate-changes', () => ({
  calculateChanges: vi.fn(),
}));

/**
 * getLogger resolves to the full Logger interface; these suites stub only
 * the levels they assert on, so the stub is widened rather than filled in
 * with methods nothing reads.
 */
function asLogger<T>(value: T): Awaited<ReturnType<typeof getLogger>> {
  return value as unknown as Awaited<ReturnType<typeof getLogger>>;
}

describe('create-audit-log', () => {
  const mockGetLogger = vi.mocked(getLogger);
  const mockGetSupabaseServerClient = vi.mocked(getSupabaseServerClient);
  const mockShouldTrackObject = vi.mocked(shouldTrackObject);
  const mockGetTransformer = vi.mocked(getTransformer);
  const mockCalculateChanges = vi.mocked(calculateChanges);

  const mockInsert = vi.fn();
  const mockFrom = vi.fn();
  const mockLogger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLogger.mockResolvedValue(asLogger(mockLogger));
    mockGetSupabaseServerClient.mockReturnValue({ from: mockFrom } as any);
    mockFrom.mockReturnValue({ insert: mockInsert });
    mockInsert.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createAuditLog', () => {
    describe('tracking checks', () => {
      it('should skip when object type is not tracked', async () => {
        mockShouldTrackObject.mockReturnValue(false);

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create',
          objectType: 'session',
          objectId: 'session-123',
        });

        expect(mockShouldTrackObject).toHaveBeenCalledWith('session', 'create');
        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.objectContaining({ objectType: 'session', action: 'create' }),
          expect.stringContaining('Skipping audit log'),
        );
        expect(mockFrom).not.toHaveBeenCalled();
      });

      it('should proceed when object type is tracked', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
          getDescription: vi.fn(() => 'Test description'),
        });

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create',
          objectType: 'project',
          objectId: 'project-123',
          objectName: 'My Project',
        });

        expect(mockShouldTrackObject).toHaveBeenCalledWith('project', 'create');
        expect(mockFrom).toHaveBeenCalledWith('audit_logs');
      });

      it('should check tracking for different action types', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
        });

        const actions = ['create', 'update', 'delete', 'archive'] as const;

        for (const action of actions) {
          mockShouldTrackObject.mockClear();

          await createAuditLog({
            accountId: 'account-123',
            userId: 'user-123',
            action,
            objectType: 'project',
            objectId: 'project-123',
          });

          expect(mockShouldTrackObject).toHaveBeenCalledWith('project', action);
        }
      });
    });

    describe('transformer application', () => {
      it('should get transformer for object type', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        const mockTransform = vi.fn((data: any) => data);
        mockGetTransformer.mockReturnValue({
          transform: mockTransform,
        });

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create',
          objectType: 'user',
          objectId: 'user-123',
          after: { id: 'user-123', email: 'test@example.com' },
        });

        expect(mockGetTransformer).toHaveBeenCalledWith('user');
        expect(mockTransform).toHaveBeenCalled();
      });

      it('should transform before state when provided', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        const mockTransform = vi.fn((data: any) => ({
          ...data,
          transformed: true,
        }));
        mockGetTransformer.mockReturnValue({
          transform: mockTransform,
        });

        const beforeState = { id: 'user-123', name: 'Old Name' };

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'update',
          objectType: 'user',
          objectId: 'user-123',
          before: beforeState,
        });

        expect(mockTransform).toHaveBeenCalledWith(beforeState, 'update');
      });

      it('should transform after state when provided', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        const mockTransform = vi.fn((data: any) => ({
          ...data,
          transformed: true,
        }));
        mockGetTransformer.mockReturnValue({
          transform: mockTransform,
        });

        const afterState = { id: 'user-123', name: 'New Name' };

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'update',
          objectType: 'user',
          objectId: 'user-123',
          after: afterState,
        });

        expect(mockTransform).toHaveBeenCalledWith(afterState, 'update');
      });

      it('should transform both before and after states', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        const mockTransform = vi.fn((data: any) => ({
          ...data,
          transformed: true,
        }));
        mockGetTransformer.mockReturnValue({
          transform: mockTransform,
        });

        const beforeState = { id: 'user-123', name: 'Old Name' };
        const afterState = { id: 'user-123', name: 'New Name' };

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'update',
          objectType: 'user',
          objectId: 'user-123',
          before: beforeState,
          after: afterState,
        });

        expect(mockTransform).toHaveBeenCalledWith(beforeState, 'update');
        expect(mockTransform).toHaveBeenCalledWith(afterState, 'update');
        expect(mockTransform).toHaveBeenCalledTimes(2);
      });

      it('should not transform when states are not provided', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        const mockTransform = vi.fn((data: any) => data);
        mockGetTransformer.mockReturnValue({
          transform: mockTransform,
        });

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create',
          objectType: 'user',
          objectId: 'user-123',
        });

        expect(mockTransform).not.toHaveBeenCalled();
      });
    });

    describe('description generation', () => {
      it('should use default description with object name', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
        });

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create',
          objectType: 'project',
          objectId: 'project-123',
          objectName: 'My Project',
        });

        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            description: 'create project "My Project"',
          }),
        );
      });

      it('should use default description without object name', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
        });

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'delete',
          objectType: 'user',
          objectId: 'user-123',
        });

        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            description: 'delete user',
          }),
        );
      });

      it('should use custom description from transformer', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
          getDescription: vi.fn(() => 'Custom description from transformer'),
        });

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'update',
          objectType: 'user',
          objectId: 'user-123',
          after: { id: 'user-123', name: 'John' },
        });

        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            description: 'Custom description from transformer',
          }),
        );
      });

      it('should call getDescription with after state when provided', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        const mockGetDescription = vi.fn(() => 'Description');
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
          getDescription: mockGetDescription,
        });

        const afterState = { id: 'user-123', name: 'John' };

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'update',
          objectType: 'user',
          objectId: 'user-123',
          after: afterState,
        });

        expect(mockGetDescription).toHaveBeenCalledWith(afterState, 'update');
      });

      it('should call getDescription with before state when after is not provided', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        const mockGetDescription = vi.fn(() => 'Description');
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
          getDescription: mockGetDescription,
        });

        const beforeState = { id: 'user-123', name: 'John' };

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'delete',
          objectType: 'user',
          objectId: 'user-123',
          before: beforeState,
        });

        expect(mockGetDescription).toHaveBeenCalledWith(beforeState, 'delete');
      });
    });

    describe('change calculation', () => {
      it('should use custom calculateChanges from transformer when provided', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        const mockCustomCalculateChanges = vi.fn(() => ({
          custom: { before: 'old', after: 'new' },
        }));
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
          calculateChanges: mockCustomCalculateChanges,
        });

        const beforeState = { id: 'user-123', name: 'Old' };
        const afterState = { id: 'user-123', name: 'New' };

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'update',
          objectType: 'user',
          objectId: 'user-123',
          before: beforeState,
          after: afterState,
        });

        expect(mockCustomCalculateChanges).toHaveBeenCalled();
        expect(mockCalculateChanges).not.toHaveBeenCalled();
        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            changes: { custom: { before: 'old', after: 'new' } },
          }),
        );
      });

      it('should use default calculateChanges when transformer does not provide one', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
        });
        mockCalculateChanges.mockReturnValue({
          name: { before: 'Old', after: 'New' },
        });

        const beforeState = { id: 'user-123', name: 'Old' };
        const afterState = { id: 'user-123', name: 'New' };

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'update',
          objectType: 'user',
          objectId: 'user-123',
          before: beforeState,
          after: afterState,
        });

        expect(mockCalculateChanges).toHaveBeenCalledWith(
          beforeState,
          afterState,
        );
        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            changes: { name: { before: 'Old', after: 'New' } },
          }),
        );
      });

      it('should not calculate changes when only before state is provided', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
        });

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'delete',
          objectType: 'user',
          objectId: 'user-123',
          before: { id: 'user-123', name: 'John' },
        });

        expect(mockCalculateChanges).not.toHaveBeenCalled();
        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            changes: null,
          }),
        );
      });

      it('should not calculate changes when only after state is provided', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
        });

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create',
          objectType: 'user',
          objectId: 'user-123',
          after: { id: 'user-123', name: 'John' },
        });

        expect(mockCalculateChanges).not.toHaveBeenCalled();
        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            changes: null,
          }),
        );
      });
    });

    describe('database insertion', () => {
      it('should insert audit log with all required fields', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
        });

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create',
          objectType: 'project',
          objectId: 'project-123',
          objectName: 'My Project',
        });

        expect(mockFrom).toHaveBeenCalledWith('audit_logs');
        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            account_id: 'account-123',
            user_id: 'user-123',
            action: 'create',
            object_type: 'project',
            object_id: 'project-123',
            object_name: 'My Project',
          }),
        );
      });

      it('should insert with default severity when not provided', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
        });

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create',
          objectType: 'project',
          objectId: 'project-123',
        });

        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: 'info',
          }),
        );
      });

      it('should insert with custom severity when provided', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
        });

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'delete',
          objectType: 'project',
          objectId: 'project-123',
          severity: 'critical',
        });

        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: 'critical',
          }),
        );
      });

      it('should insert with default scopes when not provided', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
        });

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create',
          objectType: 'project',
          objectId: 'project-123',
        });

        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            scopes: [{ type: 'account', id: 'account-123' }],
          }),
        );
      });

      it('should insert with custom scopes when provided', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
        });

        const customScopes = [
          { type: 'account', id: 'account-123' },
          { type: 'project', id: 'project-123' },
        ];

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create',
          objectType: 'project',
          objectId: 'project-123',
          scopes: customScopes,
        });

        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            scopes: customScopes,
          }),
        );
      });

      it('should insert with network metadata when provided', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
        });

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create',
          objectType: 'project',
          objectId: 'project-123',
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
        });

        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            ip_address: '192.168.1.1',
            user_agent: 'Mozilla/5.0',
          }),
        );
      });

      it('should insert with custom metadata when provided', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
        });

        const metadata = {
          source: 'api',
          correlationId: 'abc-123',
        };

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create',
          objectType: 'project',
          objectId: 'project-123',
          metadata,
        });

        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata,
          }),
        );
      });

      it('should insert with transformed before and after states', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => ({
            ...data,
            transformed: true,
          })),
        });

        const beforeState = { id: 'user-123', name: 'Old' };
        const afterState = { id: 'user-123', name: 'New' };

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'update',
          objectType: 'user',
          objectId: 'user-123',
          before: beforeState,
          after: afterState,
        });

        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            before_state: { ...beforeState, transformed: true },
            after_state: { ...afterState, transformed: true },
          }),
        );
      });
    });

    describe('error handling', () => {
      it('should log error when database insert fails', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
        });
        mockInsert.mockResolvedValue({
          error: new Error('Database insert failed'),
        });

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create',
          objectType: 'project',
          objectId: 'project-123',
        });

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'create-audit-log',
            error: expect.any(Error),
          }),
          'Failed to create audit log',
        );
      });

      it('should not throw when database insert fails', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
        });
        mockInsert.mockResolvedValue({
          error: new Error('Database insert failed'),
        });

        await expect(
          createAuditLog({
            accountId: 'account-123',
            userId: 'user-123',
            action: 'create',
            objectType: 'project',
            objectId: 'project-123',
          }),
        ).resolves.not.toThrow();
      });

      it('should log error when transformer throws', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn(() => {
            throw new Error('Transformer error');
          }),
        });

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create',
          objectType: 'project',
          objectId: 'project-123',
          after: { id: 'project-123' },
        });

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'create-audit-log',
            error: expect.any(Error),
          }),
          'Error creating audit log',
        );
      });

      it('should not throw when transformer throws', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn(() => {
            throw new Error('Transformer error');
          }),
        });

        await expect(
          createAuditLog({
            accountId: 'account-123',
            userId: 'user-123',
            action: 'create',
            objectType: 'project',
            objectId: 'project-123',
            after: { id: 'project-123' },
          }),
        ).resolves.not.toThrow();
      });
    });

    describe('logging', () => {
      it('should log debug message when successfully created', async () => {
        mockShouldTrackObject.mockReturnValue(true);
        mockGetTransformer.mockReturnValue({
          transform: vi.fn((data: any) => data),
        });

        await createAuditLog({
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create',
          objectType: 'project',
          objectId: 'project-123',
        });

        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'create-audit-log',
            objectType: 'project',
            action: 'create',
          }),
          'Audit log created successfully',
        );
      });
    });
  });

  describe('createAuditLogsBatch', () => {
    it('should create multiple audit logs', async () => {
      mockShouldTrackObject.mockReturnValue(true);
      mockGetTransformer.mockReturnValue({
        transform: vi.fn((data: any) => data),
      });

      const logs = [
        {
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create' as const,
          objectType: 'project',
          objectId: 'project-1',
        },
        {
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create' as const,
          objectType: 'project',
          objectId: 'project-2',
        },
        {
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create' as const,
          objectType: 'project',
          objectId: 'project-3',
        },
      ];

      await createAuditLogsBatch(logs);

      expect(mockInsert).toHaveBeenCalledTimes(3);
    });

    it('should handle empty array', async () => {
      await createAuditLogsBatch([]);

      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('should create all logs even if some fail', async () => {
      mockShouldTrackObject.mockReturnValue(true);
      mockGetTransformer.mockReturnValue({
        transform: vi.fn((data: any) => data),
      });

      mockInsert
        .mockResolvedValueOnce({ error: null })
        .mockResolvedValueOnce({ error: new Error('Failed') })
        .mockResolvedValueOnce({ error: null });

      const logs = [
        {
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create' as const,
          objectType: 'project',
          objectId: 'project-1',
        },
        {
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create' as const,
          objectType: 'project',
          objectId: 'project-2',
        },
        {
          accountId: 'account-123',
          userId: 'user-123',
          action: 'create' as const,
          objectType: 'project',
          objectId: 'project-3',
        },
      ];

      await createAuditLogsBatch(logs);

      expect(mockInsert).toHaveBeenCalledTimes(3);
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });

    it('should process logs in parallel', async () => {
      mockShouldTrackObject.mockReturnValue(true);
      mockGetTransformer.mockReturnValue({
        transform: vi.fn((data: any) => data),
      });

      const startTime = Date.now();
      const delayMs = 100;

      mockInsert.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ error: null }), delayMs),
          ),
      );

      const logs = Array.from({ length: 5 }, (_, i) => ({
        accountId: 'account-123',
        userId: 'user-123',
        action: 'create' as const,
        objectType: 'project',
        objectId: `project-${i}`,
      }));

      await createAuditLogsBatch(logs);

      const duration = Date.now() - startTime;

      // If processed sequentially, would take 5 * delayMs
      // If processed in parallel, should take ~delayMs
      expect(duration).toBeLessThan(5 * delayMs);
    });
  });
});
