/**
 * WebSocket Disconnect Handler Tests
 *
 * Tests connection cleanup + peer notification when WebSocket disconnects
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handler } from '../disconnect';
import { createMockDisconnectEvent } from './utils/test-helpers';

// Use vi.hoisted() to ensure mocks are available during hoisting phase
const {
  mockDeleteCommand,
  mockGetCommand,
  mockScanCommand,
  mockSend,
  mockApiGwSend,
  mockPostToConnectionCommand,
} = vi.hoisted(() => ({
  mockDeleteCommand: vi.fn(),
  mockGetCommand: vi.fn(),
  mockScanCommand: vi.fn(),
  mockSend: vi.fn(),
  mockApiGwSend: vi.fn(),
  mockPostToConnectionCommand: vi.fn(),
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
    return { _type: 'DeleteCommand', ...params };
  }),
  GetCommand: vi.fn((params) => {
    mockGetCommand(params);
    return { _type: 'GetCommand', ...params };
  }),
  ScanCommand: vi.fn((params) => {
    mockScanCommand(params);
    return { _type: 'ScanCommand', ...params };
  }),
}));

// Mock API Gateway Management API
vi.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: vi.fn(() => ({
    send: mockApiGwSend,
  })),
  PostToConnectionCommand: vi.fn((params) => {
    mockPostToConnectionCommand(params);
    return { _type: 'PostToConnectionCommand', ...params };
  }),
}));

describe('WebSocket Disconnect Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set environment variable
    process.env.CONNECTIONS_TABLE_NAME = 'test-connections-table';

    // Default mocks:
    // GetCommand returns a connection with no channels (simple disconnect)
    // ScanCommand returns empty (no peers)
    // DeleteCommand succeeds
    mockSend.mockImplementation((cmd: { _type: string }) => {
      if (cmd._type === 'GetCommand') {
        return Promise.resolve({
          Item: { connectionId: 'test-conn', channels: [], userId: '' },
        });
      }
      if (cmd._type === 'ScanCommand') {
        return Promise.resolve({ Items: [] });
      }
      // DeleteCommand
      return Promise.resolve({});
    });

    mockApiGwSend.mockResolvedValue({});
  });

  describe('Successful Disconnect', () => {
    it('should successfully disconnect and delete connection', async () => {
      const event = createMockDisconnectEvent('connection-123');

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body!)).toEqual({
        message: 'Disconnected',
      });

      // Verify GetCommand was called first to read connection
      expect(mockGetCommand).toHaveBeenCalledWith({
        TableName: 'test-connections-table',
        Key: { connectionId: 'connection-123' },
      });

      // Verify connection deleted from DynamoDB
      expect(mockDeleteCommand).toHaveBeenCalledWith({
        TableName: 'test-connections-table',
        Key: { connectionId: 'connection-123' },
      });
    });

    it('should handle disconnect for different connection IDs', async () => {
      const event = createMockDisconnectEvent('unique-connection-456');

      await handler(event);

      expect(mockGetCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { connectionId: 'unique-connection-456' },
        }),
      );

      expect(mockDeleteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { connectionId: 'unique-connection-456' },
        }),
      );
    });

    it('should successfully disconnect even if connection not found in DynamoDB', async () => {
      const event = createMockDisconnectEvent();

      // Mock: GetCommand returns no item (connection already gone)
      mockSend.mockImplementation((cmd: { _type: string }) => {
        if (cmd._type === 'GetCommand')
          return Promise.resolve({ Item: undefined });
        return Promise.resolve({});
      });

      const result = await handler(event);

      // Should still return success (idempotent operation)
      expect(result.statusCode).toBe(200);
    });
  });

  describe('Peer Notification', () => {
    it('should notify peers in shared channels when user disconnects', async () => {
      const event = createMockDisconnectEvent('user-conn-1');

      // Mock: connection has channels and userId
      mockSend.mockImplementation((cmd: { _type: string }) => {
        if (cmd._type === 'GetCommand') {
          return Promise.resolve({
            Item: {
              connectionId: 'user-conn-1',
              channels: ['edit:project-123'],
              userId: 'user-abc',
            },
          });
        }
        if (cmd._type === 'ScanCommand') {
          return Promise.resolve({
            Items: [
              // The disconnecting user's own connection (should be skipped)
              {
                connectionId: 'user-conn-1',
                channels: ['edit:project-123'],
                userId: 'user-abc',
              },
              // A peer in the same channel (should be notified)
              {
                connectionId: 'peer-conn-2',
                channels: ['edit:project-123'],
                userId: 'user-def',
              },
              // A connection in a different channel (should NOT be notified)
              {
                connectionId: 'other-conn-3',
                channels: ['edit:other-project'],
                userId: 'user-ghi',
              },
            ],
          });
        }
        return Promise.resolve({});
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);

      // Should send user-left to peer-conn-2 only
      expect(mockPostToConnectionCommand).toHaveBeenCalledTimes(1);
      expect(mockPostToConnectionCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ConnectionId: 'peer-conn-2',
        }),
      );
    });

    it('should not notify peers when connection has no channels', async () => {
      const event = createMockDisconnectEvent('no-channel-conn');

      mockSend.mockImplementation((cmd: { _type: string }) => {
        if (cmd._type === 'GetCommand') {
          return Promise.resolve({
            Item: {
              connectionId: 'no-channel-conn',
              channels: [],
              userId: 'user-xyz',
            },
          });
        }
        return Promise.resolve({});
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      // Should not scan or send any notifications
      expect(mockScanCommand).not.toHaveBeenCalled();
      expect(mockPostToConnectionCommand).not.toHaveBeenCalled();
    });

    it('should handle stale peer connections (410 Gone)', async () => {
      const event = createMockDisconnectEvent('user-conn-1');

      mockSend.mockImplementation((cmd: { _type: string }) => {
        if (cmd._type === 'GetCommand') {
          return Promise.resolve({
            Item: {
              connectionId: 'user-conn-1',
              channels: ['ch1'],
              userId: 'user-a',
            },
          });
        }
        if (cmd._type === 'ScanCommand') {
          return Promise.resolve({
            Items: [
              {
                connectionId: 'stale-peer',
                channels: ['ch1'],
                userId: 'user-b',
              },
            ],
          });
        }
        return Promise.resolve({});
      });

      // Simulate 410 Gone from API Gateway
      mockApiGwSend.mockRejectedValueOnce({ statusCode: 410 });

      const result = await handler(event);

      // Should still succeed despite stale peer
      expect(result.statusCode).toBe(200);
    });
  });

  describe('DynamoDB Errors', () => {
    it('should handle DynamoDB connection failure', async () => {
      const event = createMockDisconnectEvent();

      mockSend.mockRejectedValue(new Error('DynamoDB connection timeout'));

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body!)).toEqual({
        message: 'Failed to disconnect',
      });
    });

    it('should handle DynamoDB delete errors', async () => {
      const event = createMockDisconnectEvent();

      mockSend.mockRejectedValue(new Error('Access denied'));

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body!).message).toBe('Failed to disconnect');
    });

    it('should handle throttling errors from DynamoDB', async () => {
      const event = createMockDisconnectEvent();

      mockSend.mockRejectedValue(
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
        Key: { connectionId: 'cleanup-test-123' },
      });

      // Should only include connectionId in Key (not userId)
      const callArgs = mockDeleteCommand.mock.calls[0]![0];
      expect(Object.keys(callArgs.Key)).toEqual(['connectionId']);
    });

    it('should be idempotent (multiple disconnects should not fail)', async () => {
      const event = createMockDisconnectEvent('idempotent-123');

      // First disconnect
      const result1 = await handler(event);
      expect(result1.statusCode).toBe(200);

      // Clear and re-setup mocks
      vi.clearAllMocks();
      mockSend.mockImplementation((cmd: { _type: string }) => {
        if (cmd._type === 'GetCommand')
          return Promise.resolve({ Item: undefined });
        return Promise.resolve({});
      });

      // Second disconnect (connection already deleted)
      const result2 = await handler(event);
      expect(result2.statusCode).toBe(200);
    });
  });

  describe('Environment Configuration', () => {
    it('should use CONNECTIONS_TABLE_NAME from environment', async () => {
      const event = createMockDisconnectEvent();

      await handler(event);

      expect(mockGetCommand).toHaveBeenCalledWith(
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
          Key: { connectionId: longConnectionId },
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
          Key: { connectionId: specialConnectionId },
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

      mockSend.mockRejectedValue(new Error('Test error'));

      await handler(event);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error during disconnect cleanup:',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });
});
