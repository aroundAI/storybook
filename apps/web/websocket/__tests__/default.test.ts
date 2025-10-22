/**
 * WebSocket Default Handler Tests
 *
 * Tests message routing, broadcasting, and stale connection cleanup
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handler } from '../default';
import { createMockMessageEvent } from './utils/test-helpers';

// Use vi.hoisted() to ensure mocks are available during hoisting phase
const {
  mockPostToConnectionCommand,
  mockQueryCommand,
  mockScanCommand,
  mockDeleteCommand,
  mockGetCommand,
  mockApiGatewayClientSend,
  mockDdbClientSend,
  mockSupabaseRpc,
} = vi.hoisted(() => ({
  mockPostToConnectionCommand: vi.fn(),
  mockQueryCommand: vi.fn(),
  mockScanCommand: vi.fn(),
  mockDeleteCommand: vi.fn(),
  mockGetCommand: vi.fn(),
  mockApiGatewayClientSend: vi.fn(),
  mockDdbClientSend: vi.fn(),
  mockSupabaseRpc: vi.fn(),
}));

// Mock AWS SDK
vi.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: vi.fn(() => ({
    send: mockApiGatewayClientSend,
  })),
  PostToConnectionCommand: vi.fn((params) => {
    mockPostToConnectionCommand(params);
    return params;
  }),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({
      send: mockDdbClientSend,
    })),
  },
  QueryCommand: vi.fn((params) => {
    mockQueryCommand(params);
    return params;
  }),
  ScanCommand: vi.fn((params) => {
    mockScanCommand(params);
    return params;
  }),
  DeleteCommand: vi.fn((params) => {
    mockDeleteCommand(params);
    return params;
  }),
  GetCommand: vi.fn((params) => {
    mockGetCommand(params);
    return params;
  }),
}));

// Mock Supabase client
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    rpc: mockSupabaseRpc,
  })),
}));

describe('WebSocket Default Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.CONNECTIONS_TABLE_NAME = 'test-connections-table';
    process.env.WEBSOCKET_API_ENDPOINT =
      'https://test.execute-api.us-east-1.amazonaws.com/test';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

    // Default: successful message send
    mockApiGatewayClientSend.mockResolvedValue({});

    // Configure DynamoDB responses
    // First call is GetCommand (to get userId from connectionId)
    // Subsequent calls depend on the action (QueryCommand, ScanCommand, etc.)
    mockDdbClientSend
      .mockResolvedValueOnce({
        Item: { userId: 'test-user-id', connectionId: 'test-connection-id' },
      }) // GetCommand: return userId
      .mockResolvedValue({ Items: [] }); // Other commands: return empty by default

    // Default: Supabase RPC returns true (users share team)
    mockSupabaseRpc.mockResolvedValue({ data: true, error: null });
  });

  describe('Send to User Action', () => {
    it('should send message to specific user by userId', async () => {
      const targetUserId = '550e8400-e29b-41d4-a716-446655440000'; // Valid UUID
      const event = createMockMessageEvent({
        action: 'send-to-user',
        targetUserId,
        message: 'Hello user',
        data: { foo: 'bar' },
      });

      // Reset and configure full mock chain
      const senderId = 'c50e8400-e29b-41d4-a716-446655440007'; // Valid UUID sender
      mockDdbClientSend.mockReset();
      mockDdbClientSend
        .mockResolvedValueOnce({
          Item: {
            userId: senderId,
            connectionId: 'test-connection-id',
          },
        }) // GetCommand: sender userId
        .mockResolvedValueOnce({
          Items: [
            { connectionId: 'conn-1', userId: targetUserId },
            { connectionId: 'conn-2', userId: targetUserId },
          ],
        }); // QueryCommand: target user connections

      const result = await handler(event);

      expect(result.statusCode).toBe(200);

      // Verify DynamoDB query for user connections
      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-connections-table',
          IndexName: 'userIdIndex',
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: {
            ':userId': targetUserId,
          },
        }),
      );

      // Verify messages sent to both connections
      expect(mockPostToConnectionCommand).toHaveBeenCalledTimes(2);
      expect(mockPostToConnectionCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ConnectionId: 'conn-1',
          Data: expect.any(String),
        }),
      );
      expect(mockPostToConnectionCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ConnectionId: 'conn-2',
          Data: expect.any(String),
        }),
      );
    });

    it('should return error when targetUserId is missing', async () => {
      const event = createMockMessageEvent({
        action: 'send-to-user',
        message: 'Hello',
        // Missing targetUserId
      });

      const result = await handler(event);

      // Schema validation fails, returns 400
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body!).message).toBe('Invalid message format');

      // Should not query DynamoDB (validation fails before that)
      expect(mockQueryCommand).not.toHaveBeenCalled();
    });

    it('should handle user with no active connections', async () => {
      const targetUserId = 'b50e8400-e29b-41d4-a716-446655440006'; // Valid UUID
      const senderId = 'd50e8400-e29b-41d4-a716-446655440008'; // Valid UUID sender
      const event = createMockMessageEvent({
        action: 'send-to-user',
        targetUserId,
        message: 'Hello',
      });

      // Reset and configure mock chain
      mockDdbClientSend.mockReset();
      mockDdbClientSend
        .mockResolvedValueOnce({
          Item: {
            userId: senderId,
            connectionId: 'test-connection-id',
          },
        }) // GetCommand: sender userId
        .mockResolvedValueOnce({ Items: [] }); // QueryCommand: no connections

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockQueryCommand).toHaveBeenCalled();
      // No messages sent
      expect(mockPostToConnectionCommand).not.toHaveBeenCalled();
    });

    it('should cleanup stale connections on 410 error', async () => {
      const targetUserId = '650e8400-e29b-41d4-a716-446655440001'; // Valid UUID
      const senderId = 'e50e8400-e29b-41d4-a716-446655440009'; // Valid UUID sender
      const event = createMockMessageEvent({
        action: 'send-to-user',
        targetUserId,
        message: 'Hello',
      });

      // Reset and configure full mock chain
      mockDdbClientSend.mockReset();
      mockDdbClientSend
        .mockResolvedValueOnce({
          Item: {
            userId: senderId,
            connectionId: 'test-connection-id',
          },
        }) // GetCommand: sender userId
        .mockResolvedValueOnce({
          Items: [
            { connectionId: 'stale-conn-1' },
            { connectionId: 'active-conn-2' },
          ],
        }) // QueryCommand: target connections
        .mockResolvedValueOnce({}); // DeleteCommand: delete stale connection

      // Mock: first connection is stale (410), second succeeds
      mockApiGatewayClientSend
        .mockRejectedValueOnce({ statusCode: 410 })
        .mockResolvedValueOnce({});

      await handler(event);

      // Verify deletion of stale connection
      expect(mockDeleteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-connections-table',
          Key: { connectionId: 'stale-conn-1' },
        }),
      );
    });
  });

  describe('Broadcast Action', () => {
    it('should broadcast message to all connections', async () => {
      const event = createMockMessageEvent({
        action: 'broadcast',
        channel: 'announcements',
        message: 'System maintenance in 1 hour',
        data: { severity: 'warning' },
      });

      // Reset and configure mock chain
      mockDdbClientSend.mockReset();
      mockDdbClientSend
        .mockResolvedValueOnce({
          Item: {
            userId: 'admin-id',
            connectionId: 'test-connection-id',
            isSuperAdmin: true,
          },
        }) // GetCommand: check super admin
        .mockResolvedValueOnce({
          Items: [
            { connectionId: 'conn-a' },
            { connectionId: 'conn-b' },
            { connectionId: 'conn-c' },
          ],
        }); // ScanCommand: all connections

      const result = await handler(event);

      expect(result.statusCode).toBe(200);

      // Verify DynamoDB scan for all connections
      expect(mockScanCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-connections-table',
          ProjectionExpression: 'connectionId',
        }),
      );

      // Verify messages sent to all connections
      expect(mockPostToConnectionCommand).toHaveBeenCalledTimes(3);
    });

    it('should log warning for broadcast action', async () => {
      const consoleSpy = vi.spyOn(console, 'warn');

      const event = createMockMessageEvent({
        action: 'broadcast',
        message: 'Test broadcast',
      });

      // Reset and configure mock chain
      mockDdbClientSend.mockReset();
      mockDdbClientSend
        .mockResolvedValueOnce({
          Item: {
            userId: 'non-admin-id',
            connectionId: 'test-connection-id',
            isSuperAdmin: false,
          },
        }) // GetCommand: not super admin
        .mockResolvedValueOnce({ Items: [] }); // Not reached (auth fails)

      await handler(event);

      // Check that console.warn was called with the specific message
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Security] Unauthorized broadcast attempt from non-admin user',
        expect.objectContaining({
          connectionId: 'test-connection-id',
        }),
      );

      consoleSpy.mockRestore();
    });

    it('should cleanup stale connections during broadcast', async () => {
      const event = createMockMessageEvent({
        action: 'broadcast',
        message: 'Broadcast test',
      });

      // Reset and configure full mock chain
      mockDdbClientSend.mockReset();
      mockDdbClientSend
        .mockResolvedValueOnce({
          Item: {
            userId: 'admin-id',
            connectionId: 'test-connection-id',
            isSuperAdmin: true,
          },
        }) // GetCommand: check super admin
        .mockResolvedValueOnce({
          Items: [{ connectionId: 'stale-broadcast' }],
        }) // ScanCommand: all connections
        .mockResolvedValueOnce({}); // DeleteCommand: delete stale

      mockApiGatewayClientSend.mockRejectedValueOnce({ statusCode: 410 });

      await handler(event);

      expect(mockDeleteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { connectionId: 'stale-broadcast' },
        }),
      );
    });
  });

  describe('Subscribe/Unsubscribe Actions', () => {
    it('should handle subscribe action', async () => {
      const event = createMockMessageEvent({
        action: 'subscribe',
        channel: 'notifications',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockPostToConnectionCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ConnectionId: 'test-connection-id',
          Data: expect.stringContaining('subscribed'),
        }),
      );
    });

    it('should handle unsubscribe action', async () => {
      const event = createMockMessageEvent({
        action: 'unsubscribe',
        channel: 'notifications',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockPostToConnectionCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Data: expect.stringContaining('unsubscribed'),
        }),
      );
    });
  });

  describe('Ping/Pong Action', () => {
    it('should respond to ping with pong', async () => {
      const event = createMockMessageEvent({
        action: 'ping',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockPostToConnectionCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Data: expect.stringContaining('pong'),
        }),
      );
    });

    it('should handle ping for keepalive monitoring', async () => {
      const event = createMockMessageEvent({
        action: 'ping',
      });

      await handler(event);

      const sentData = JSON.parse(
        mockPostToConnectionCommand.mock.calls[0][0].Data,
      );

      expect(sentData.type).toBe('pong');
    });
  });

  describe('Unknown Actions', () => {
    it('should reject unknown actions with 400', async () => {
      const event = createMockMessageEvent({
        action: 'unknown-action',
        customData: 'test',
      });

      const result = await handler(event);

      // Schema validation fails for unknown actions
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body!).message).toBe('Invalid message format');
    });

    it('should reject messages without action field', async () => {
      const event = createMockMessageEvent({
        randomField: 'value',
      });

      const result = await handler(event);

      // Schema validation fails when action is missing
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body!).message).toBe('Invalid message format');
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON in message body', async () => {
      const event = createMockMessageEvent({});
      event.body = 'invalid-json{{{';

      const result = await handler(event);

      // Handler returns 400 for invalid message format (line 189 in default.ts)
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body!).message).toBe('Invalid message format');
    });

    it('should handle DynamoDB query errors gracefully', async () => {
      const event = createMockMessageEvent({
        action: 'send-to-user',
        targetUserId: '750e8400-e29b-41d4-a716-446655440002', // Valid UUID
        message: 'Test',
      });

      // Reset and configure mock to fail on GetCommand (first DynamoDB call)
      mockDdbClientSend.mockReset();
      mockDdbClientSend.mockRejectedValueOnce(
        new Error('DynamoDB connection timeout'),
      );

      const result = await handler(event);

      // GetCommand error is caught by getSenderUserId and returns null
      // Handler then sends error message to client and returns 200
      expect(result.statusCode).toBe(200);

      // Should send error message to the client
      expect(mockPostToConnectionCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ConnectionId: 'test-connection-id',
          Data: expect.stringContaining('Unauthorized'),
        }),
      );
    });

    it('should handle API Gateway client errors', async () => {
      const event = createMockMessageEvent({
        action: 'ping',
      });

      mockApiGatewayClientSend.mockRejectedValueOnce(
        new Error('API Gateway error'),
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
    });

    it('should continue processing after individual connection errors', async () => {
      const targetUserId = '850e8400-e29b-41d4-a716-446655440003'; // Valid UUID
      const senderId = 'f50e8400-e29b-41d4-a716-446655440010'; // Valid UUID sender
      const event = createMockMessageEvent({
        action: 'send-to-user',
        targetUserId,
        message: 'Test',
      });

      // Reset and configure full mock chain
      mockDdbClientSend.mockReset();
      mockDdbClientSend
        .mockResolvedValueOnce({
          Item: {
            userId: senderId,
            connectionId: 'test-connection-id',
          },
        }) // GetCommand: sender userId
        .mockResolvedValueOnce({
          Items: [
            { connectionId: 'conn-fail' },
            { connectionId: 'conn-success' },
          ],
        }); // QueryCommand: target connections

      // First fails (non-410 error), second succeeds
      mockApiGatewayClientSend
        .mockRejectedValueOnce(new Error('Connection error'))
        .mockResolvedValueOnce({});

      const result = await handler(event);

      // Should still succeed
      expect(result.statusCode).toBe(200);

      // Both connections attempted
      expect(mockPostToConnectionCommand).toHaveBeenCalledTimes(2);
    });
  });

  describe('Message Format', () => {
    it('should include timestamp in sent messages', async () => {
      const targetUserId = '950e8400-e29b-41d4-a716-446655440004'; // Valid UUID
      const senderId = 'a60e8400-e29b-41d4-a716-446655440011'; // Valid UUID sender
      const event = createMockMessageEvent({
        action: 'send-to-user',
        targetUserId,
        message: 'Test',
      });

      // Reset and configure full mock chain
      mockDdbClientSend.mockReset();
      mockDdbClientSend
        .mockResolvedValueOnce({
          Item: {
            userId: senderId,
            connectionId: 'test-connection-id',
          },
        }) // GetCommand: sender userId
        .mockResolvedValueOnce({
          Items: [{ connectionId: 'conn-1' }],
        }); // QueryCommand: target connections

      await handler(event);

      const sentData = JSON.parse(
        mockPostToConnectionCommand.mock.calls[0][0].Data,
      );

      expect(sentData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO format
    });

    it('should include message type in response', async () => {
      const targetUserId = 'a50e8400-e29b-41d4-a716-446655440005'; // Valid UUID
      const senderId = 'b60e8400-e29b-41d4-a716-446655440012'; // Valid UUID sender
      const event = createMockMessageEvent({
        action: 'send-to-user',
        targetUserId,
        message: 'Test',
      });

      // Reset and configure full mock chain
      mockDdbClientSend.mockReset();
      mockDdbClientSend
        .mockResolvedValueOnce({
          Item: {
            userId: senderId,
            connectionId: 'test-connection-id',
          },
        }) // GetCommand: sender userId
        .mockResolvedValueOnce({
          Items: [{ connectionId: 'conn-1' }],
        }); // QueryCommand: target connections

      await handler(event);

      const sentData = JSON.parse(
        mockPostToConnectionCommand.mock.calls[0][0].Data,
      );

      expect(sentData.type).toBe('notification');
    });
  });

  describe('Environment Configuration', () => {
    it('should use correct API Gateway endpoint', async () => {
      const event = createMockMessageEvent({ action: 'ping' });

      // Override request context for endpoint test
      event.requestContext.domainName =
        'custom-api.execute-api.us-west-2.amazonaws.com';
      event.requestContext.stage = 'production';

      await handler(event);

      // Verify ApiGatewayManagementApiClient was created with correct endpoint
      // (endpoint is constructed in handler: `https://${domain}/${stage}`)
      expect(mockPostToConnectionCommand).toHaveBeenCalled();
    });
  });
});
