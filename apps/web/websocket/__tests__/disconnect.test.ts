/**
 * WebSocket Disconnect Handler Tests
 *
 * Tests connection cleanup when WebSocket disconnects
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handler } from '../disconnect';
import { createMockDisconnectEvent } from './utils/test-helpers';

// Use vi.hoisted() to ensure mocks are available during hoisting phase
const { mockDeleteCommand, mockSend } = vi.hoisted(() => ({
  mockDeleteCommand: vi.fn(),
  mockSend: vi.fn(),
}));

// Mock AWS DynamoDB
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({
      send: mockSend,
    })),
  },
  DeleteCommand: vi.fn((params) => {
    mockDeleteCommand(params);
    return params;
  }),
}));

describe('WebSocket Disconnect Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set environment variable
    process.env.CONNECTIONS_TABLE_NAME = 'test-connections-table';

    // Default: delete succeeds
    mockSend.mockResolvedValue({});
  });

  describe('Successful Disconnect', () => {
    it('should successfully disconnect and delete connection', async () => {
      const event = createMockDisconnectEvent('connection-123');

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body!)).toEqual({
        message: 'Disconnected',
      });

      // Verify connection deleted from DynamoDB
      expect(mockDeleteCommand).toHaveBeenCalledWith({
        TableName: 'test-connections-table',
        Key: {
          connectionId: 'connection-123',
        },
      });

      expect(mockSend).toHaveBeenCalled();
    });

    it('should handle disconnect for different connection IDs', async () => {
      const event = createMockDisconnectEvent('unique-connection-456');

      await handler(event);

      expect(mockDeleteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: {
            connectionId: 'unique-connection-456',
          },
        }),
      );
    });

    it('should successfully disconnect even if connection not found in DynamoDB', async () => {
      const event = createMockDisconnectEvent();

      // Mock: connection not found (already deleted or never stored)
      mockSend.mockResolvedValueOnce({});

      const result = await handler(event);

      // Should still return success (idempotent operation)
      expect(result.statusCode).toBe(200);
    });
  });

  describe('DynamoDB Errors', () => {
    it('should handle DynamoDB connection failure', async () => {
      const event = createMockDisconnectEvent();

      mockSend.mockRejectedValueOnce(new Error('DynamoDB connection timeout'));

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body!)).toEqual({
        message: 'Failed to disconnect',
      });
    });

    it('should handle DynamoDB delete errors', async () => {
      const event = createMockDisconnectEvent();

      mockSend.mockRejectedValueOnce(new Error('Access denied'));

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body!).message).toBe('Failed to disconnect');
    });

    it('should handle throttling errors from DynamoDB', async () => {
      const event = createMockDisconnectEvent();

      mockSend.mockRejectedValueOnce(
        new Error('ProvisionedThroughputExceededException'),
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
    });
  });

  describe('Connection Cleanup', () => {
    it('should delete connection by connectionId only', async () => {
      const event = createMockDisconnectEvent('cleanup-test-123');

      await handler(event);

      expect(mockDeleteCommand).toHaveBeenCalledWith({
        TableName: 'test-connections-table',
        Key: {
          connectionId: 'cleanup-test-123',
        },
      });

      // Should only include connectionId in Key (not userId)
      const callArgs = mockDeleteCommand.mock.calls[0][0];
      expect(Object.keys(callArgs.Key)).toEqual(['connectionId']);
    });

    it('should be idempotent (multiple disconnects should not fail)', async () => {
      const event = createMockDisconnectEvent('idempotent-123');

      // First disconnect
      const result1 = await handler(event);
      expect(result1.statusCode).toBe(200);

      // Clear and mock "already deleted"
      vi.clearAllMocks();
      mockSend.mockResolvedValueOnce({});

      // Second disconnect (connection already deleted)
      const result2 = await handler(event);
      expect(result2.statusCode).toBe(200);
    });
  });

  describe('Environment Configuration', () => {
    it('should use CONNECTIONS_TABLE_NAME from environment', async () => {
      // Note: Environment variable is read at module load time
      // This test verifies the handler uses the configured value from vitest.setup.ts
      const event = createMockDisconnectEvent();

      await handler(event);

      expect(mockDeleteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-connections-table', // From vitest.setup.ts
        }),
      );
    });

    it('should use default table name when not overridden', async () => {
      // Note: CONNECTIONS_TABLE_NAME is set in vitest.setup.ts
      // This test verifies the handler uses the configured value
      const event = createMockDisconnectEvent();

      await handler(event);

      // Should use the default test table name
      expect(mockDeleteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-connections-table',
        }),
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long connection IDs', async () => {
      const longConnectionId = 'a'.repeat(200);
      const event = createMockDisconnectEvent(longConnectionId);

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockDeleteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: {
            connectionId: longConnectionId,
          },
        }),
      );
    });

    it('should handle connection IDs with special characters', async () => {
      const specialConnectionId = 'conn-123_test.id-456';
      const event = createMockDisconnectEvent(specialConnectionId);

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockDeleteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: {
            connectionId: specialConnectionId,
          },
        }),
      );
    });

    it('should handle concurrent disconnects for same connection', async () => {
      const event = createMockDisconnectEvent('concurrent-test');

      // Simulate concurrent disconnect attempts
      const results = await Promise.all([
        handler(event),
        handler(event),
        handler(event),
      ]);

      // All should succeed (idempotent)
      results.forEach((result) => {
        expect(result.statusCode).toBe(200);
      });
    });
  });

  describe('Logging', () => {
    it('should log disconnect event details', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const event = createMockDisconnectEvent('log-test-123');

      await handler(event);

      expect(consoleSpy).toHaveBeenCalledWith(
        'WebSocket disconnect event:',
        expect.any(String),
      );

      consoleSpy.mockRestore();
    });

    it('should log successful deletion', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const event = createMockDisconnectEvent('success-log-test');

      await handler(event);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('deleted successfully'),
      );

      consoleSpy.mockRestore();
    });

    it('should log errors on failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error');
      const event = createMockDisconnectEvent();

      mockSend.mockRejectedValueOnce(new Error('Test error'));

      await handler(event);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error deleting connection:',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });
});
