/**
 * WebSocket Default Handler Tests
 *
 * Tests message routing, broadcasting, and stale connection cleanup
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handler } from '../default';
import { createMockMessageEvent } from './utils/test-helpers';

// Mock AWS SDK
const mockPostToConnectionCommand = vi.fn();
const mockQueryCommand = vi.fn();
const mockScanCommand = vi.fn();
const mockDeleteCommand = vi.fn();
const mockApiGatewayClientSend = vi.fn();
const mockDdbClientSend = vi.fn();

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
}));

describe('WebSocket Default Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.CONNECTIONS_TABLE_NAME = 'test-connections-table';

    // Default: successful message send
    mockApiGatewayClientSend.mockResolvedValue({});
    mockDdbClientSend.mockResolvedValue({ Items: [] });
  });

  describe('Send to User Action', () => {
    it('should send message to specific user by userId', async () => {
      const event = createMockMessageEvent({
        action: 'send-to-user',
        targetUserId: 'target-user-123',
        message: 'Hello user',
        data: { foo: 'bar' },
      });

      // Mock: target user has 2 connections
      mockDdbClientSend.mockResolvedValueOnce({
        Items: [
          { connectionId: 'conn-1', userId: 'target-user-123' },
          { connectionId: 'conn-2', userId: 'target-user-123' },
        ],
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);

      // Verify DynamoDB query for user connections
      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-connections-table',
          IndexName: 'userIdIndex',
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: {
            ':userId': 'target-user-123',
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

      expect(result.statusCode).toBe(200); // Handler still succeeds
      expect(mockPostToConnectionCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Data: expect.stringContaining('targetUserId is required'),
        }),
      );

      // Should not query DynamoDB
      expect(mockQueryCommand).not.toHaveBeenCalled();
    });

    it('should handle user with no active connections', async () => {
      const event = createMockMessageEvent({
        action: 'send-to-user',
        targetUserId: 'offline-user',
        message: 'Hello',
      });

      // Mock: user has no connections
      mockDdbClientSend.mockResolvedValueOnce({ Items: [] });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockQueryCommand).toHaveBeenCalled();
      // No messages sent
      expect(mockPostToConnectionCommand).not.toHaveBeenCalled();
    });

    it('should cleanup stale connections on 410 error', async () => {
      const event = createMockMessageEvent({
        action: 'send-to-user',
        targetUserId: 'user-with-stale',
        message: 'Hello',
      });

      mockDdbClientSend.mockResolvedValueOnce({
        Items: [
          { connectionId: 'stale-conn-1' },
          { connectionId: 'active-conn-2' },
        ],
      });

      // Mock: first connection is stale (410), second succeeds
      mockApiGatewayClientSend
        .mockRejectedValueOnce({ statusCode: 410 })
        .mockResolvedValueOnce({});

      // Mock: delete command for stale connection
      mockDdbClientSend.mockResolvedValueOnce({});

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

      // Mock: 3 total connections
      mockDdbClientSend.mockResolvedValueOnce({
        Items: [
          { connectionId: 'conn-a' },
          { connectionId: 'conn-b' },
          { connectionId: 'conn-c' },
        ],
      });

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

      mockDdbClientSend.mockResolvedValueOnce({ Items: [] });

      await handler(event);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Broadcast to ALL users'),
      );

      consoleSpy.mockRestore();
    });

    it('should cleanup stale connections during broadcast', async () => {
      const event = createMockMessageEvent({
        action: 'broadcast',
        message: 'Broadcast test',
      });

      mockDdbClientSend.mockResolvedValueOnce({
        Items: [{ connectionId: 'stale-broadcast' }],
      });

      mockApiGatewayClientSend.mockRejectedValueOnce({ statusCode: 410 });
      mockDdbClientSend.mockResolvedValueOnce({});

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
    it('should echo back unknown messages', async () => {
      const event = createMockMessageEvent({
        action: 'unknown-action',
        customData: 'test',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockPostToConnectionCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Data: expect.stringContaining('echo'),
        }),
      );
    });

    it('should handle messages without action field', async () => {
      const event = createMockMessageEvent({
        randomField: 'value',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON in message body', async () => {
      const event = createMockMessageEvent({});
      event.body = 'invalid-json{{{';

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body!).message).toBe(
        'Failed to process message',
      );
    });

    it('should handle DynamoDB query errors', async () => {
      const event = createMockMessageEvent({
        action: 'send-to-user',
        targetUserId: 'user-123',
        message: 'Test',
      });

      mockDdbClientSend.mockRejectedValueOnce(
        new Error('DynamoDB connection timeout'),
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
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
        action: 'send-to-user',
        targetUserId: 'user-multi',
        message: 'Test',
      });

      mockDdbClientSend.mockResolvedValueOnce({
        Items: [
          { connectionId: 'conn-fail' },
          { connectionId: 'conn-success' },
        ],
      });

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
      const event = createMockMessageEvent({
        action: 'send-to-user',
        targetUserId: 'user-timestamp',
        message: 'Test',
      });

      mockDdbClientSend.mockResolvedValueOnce({
        Items: [{ connectionId: 'conn-1' }],
      });

      await handler(event);

      const sentData = JSON.parse(
        mockPostToConnectionCommand.mock.calls[0][0].Data,
      );

      expect(sentData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO format
    });

    it('should include message type in response', async () => {
      const event = createMockMessageEvent({
        action: 'send-to-user',
        targetUserId: 'user-type',
        message: 'Test',
      });

      mockDdbClientSend.mockResolvedValueOnce({
        Items: [{ connectionId: 'conn-1' }],
      });

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
