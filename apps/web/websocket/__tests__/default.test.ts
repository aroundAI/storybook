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
  mockUpdateCommand,
  mockApiGatewayClientSend,
  mockDdbClientSend,
} = vi.hoisted(() => ({
  mockPostToConnectionCommand: vi.fn(),
  mockQueryCommand: vi.fn(),
  mockScanCommand: vi.fn(),
  mockDeleteCommand: vi.fn(),
  mockGetCommand: vi.fn(),
  mockUpdateCommand: vi.fn(),
  mockApiGatewayClientSend: vi.fn(),
  mockDdbClientSend: vi.fn(),
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
  UpdateCommand: vi.fn((params) => {
    mockUpdateCommand(params);
    return params;
  }),
}));

describe('WebSocket Default Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.CONNECTIONS_TABLE_NAME = 'test-connections-table';
    process.env.WEBSOCKET_API_ENDPOINT =
      'https://test.execute-api.us-east-1.amazonaws.com/test';

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
        mockPostToConnectionCommand.mock.calls[0]![0].Data,
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

    // KB-91: user-to-user messaging was never a feature and its permission
    // check called a function no migration creates. It is an unknown action.
    it('refuses send-to-user like any unknown action', async () => {
      const event = createMockMessageEvent({
        action: 'send-to-user',
        targetUserId: '550e8400-e29b-41d4-a716-446655440000',
        message: 'Hello user',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body!).message).toBe('Invalid message format');
      expect(mockPostToConnectionCommand).toHaveBeenCalledTimes(1);
      expect(mockPostToConnectionCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ConnectionId: 'test-connection-id',
          Data: expect.stringContaining('Invalid message format'),
        }),
      );
      expect(mockGetCommand).not.toHaveBeenCalled();
      expect(mockQueryCommand).not.toHaveBeenCalled();
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
        action: 'broadcast',
        message: 'Test',
      });

      // Reset and configure mock to fail on GetCommand (first DynamoDB call)
      mockDdbClientSend.mockReset();
      mockDdbClientSend.mockRejectedValueOnce(
        new Error('DynamoDB connection timeout'),
      );

      const result = await handler(event);

      // GetCommand error is caught by isSenderSuperAdmin and returns false
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
      const event = createMockMessageEvent({
        action: 'broadcast',
        message: 'Test',
      });

      mockDdbClientSend.mockReset();
      mockDdbClientSend
        .mockResolvedValueOnce({
          Item: { connectionId: 'test-connection-id', isSuperAdmin: true },
        }) // GetCommand: super admin
        .mockResolvedValueOnce({
          Items: [
            { connectionId: 'conn-fail' },
            { connectionId: 'conn-success' },
          ],
        }); // ScanCommand: all connections

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
    it('should include message type in broadcast frames', async () => {
      const event = createMockMessageEvent({
        action: 'broadcast',
        message: 'Test',
      });

      mockDdbClientSend.mockReset();
      mockDdbClientSend
        .mockResolvedValueOnce({
          Item: { connectionId: 'test-connection-id', isSuperAdmin: true },
        }) // GetCommand: super admin
        .mockResolvedValueOnce({
          Items: [{ connectionId: 'conn-1' }],
        }); // ScanCommand: all connections

      await handler(event);

      const sentData = JSON.parse(
        mockPostToConnectionCommand.mock.calls[0]![0].Data,
      );

      expect(sentData.type).toBe('broadcast');
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
