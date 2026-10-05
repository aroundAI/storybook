/**
 * WebSocket Connect Handler Tests
 *
 * Tests authentication and connection storage for WebSocket $connect route
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handler } from '../connect';
import { createMockConnectEvent } from './utils/test-helpers';

// Use vi.hoisted() to ensure mocks are available during hoisting phase
const {
  mockPutCommand,
  mockQueryCommand,
  mockSend,
  mockVerifySupabaseToken,
  mockIsSuperAdmin,
} = vi.hoisted(() => ({
  mockPutCommand: vi.fn(),
  mockQueryCommand: vi.fn(),
  mockSend: vi.fn(),
  mockVerifySupabaseToken: vi.fn(),
  mockIsSuperAdmin: vi.fn(),
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
  PutCommand: vi.fn((params) => {
    mockPutCommand(params);
    return params;
  }),
  QueryCommand: vi.fn((params) => {
    mockQueryCommand(params);
    return params;
  }),
}));

// Mock authentication utility
vi.mock('../utils/auth', () => ({
  verifySupabaseToken: mockVerifySupabaseToken,
  isSuperAdminFromToken: mockIsSuperAdmin,
}));

describe('WebSocket Connect Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set environment variable
    process.env.CONNECTIONS_TABLE_NAME = 'test-connections-table';

    // Default: auth succeeds
    mockVerifySupabaseToken.mockResolvedValue('user-123');

    // Mock DynamoDB responses:
    // - First call (QueryCommand) returns no existing connections
    // - Second call (PutCommand) succeeds
    mockSend
      .mockResolvedValueOnce({ Items: [] }) // QueryCommand: no existing connections
      .mockResolvedValueOnce({}); // PutCommand: success
  });

  describe('Valid Authentication', () => {
    it('should successfully connect with valid JWT token', async () => {
      const event = createMockConnectEvent({
        headers: {
          Authorization: 'Bearer valid-jwt-token',
        },
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body!)).toEqual({
        message: 'Connected',
        userId: 'user-123',
      });

      // Verify token was validated
      expect(mockVerifySupabaseToken).toHaveBeenCalledWith(
        'Bearer valid-jwt-token',
      );

      // Verify connection stored in DynamoDB
      expect(mockPutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-connections-table',
          Item: expect.objectContaining({
            connectionId: 'test-connection-id',
            userId: 'user-123',
            ttl: expect.any(Number),
          }),
        }),
      );
    });

    it('should support token via query string parameter', async () => {
      const event = createMockConnectEvent({
        headers: {},
        queryStringParameters: {
          token: 'Bearer valid-jwt-token',
        },
      });

      mockVerifySupabaseToken.mockResolvedValue('user-456');

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockVerifySupabaseToken).toHaveBeenCalledWith(
        'Bearer valid-jwt-token',
      );
    });

    it('should store connection with 1 hour TTL', async () => {
      const event = createMockConnectEvent();
      const now = Math.floor(Date.now() / 1000);

      await handler(event);

      expect(mockPutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: expect.objectContaining({
            ttl: expect.any(Number),
          }),
        }),
      );

      // Check TTL is approximately 1 hour from now
      const storedTTL = mockPutCommand.mock.calls[0]![0].Item.ttl;
      expect(storedTTL).toBeGreaterThanOrEqual(now + 3500); // ~1 hour
      expect(storedTTL).toBeLessThanOrEqual(now + 3700); // ~1 hour + buffer
    });
  });

  describe('Invalid Authentication', () => {
    it('should reject connection without Authorization header', async () => {
      const event = createMockConnectEvent({
        headers: {},
        queryStringParameters: undefined,
      });

      mockVerifySupabaseToken.mockResolvedValue(null);

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body!)).toEqual({
        message: 'Unauthorized: Invalid or missing authentication token',
      });

      // DynamoDB should not be called
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should reject connection with invalid JWT token', async () => {
      const event = createMockConnectEvent({
        headers: {
          Authorization: 'Bearer invalid-token',
        },
      });

      mockVerifySupabaseToken.mockResolvedValue(null);

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body!).message).toContain('Unauthorized');
    });

    it('should reject connection with expired JWT token', async () => {
      const event = createMockConnectEvent();

      mockVerifySupabaseToken.mockResolvedValue(null); // Expired tokens return null

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });
  });

  describe('KB-191: the token as a WebSocket subprotocol', () => {
    const GOOD = 'good-jwt';

    beforeEach(() => {
      mockVerifySupabaseToken.mockImplementation(async (token?: string) =>
        token === GOOD ? 'user-sub' : null,
      );
    });

    const offered = (value: string) =>
      createMockConnectEvent({
        headers: { 'Sec-WebSocket-Protocol': value },
        queryStringParameters: undefined,
      });

    it('accepts the token from Sec-WebSocket-Protocol and echoes access_token', async () => {
      const result = await handler(offered(`access_token, ${GOOD}`));

      expect(result.statusCode).toBe(200);
      expect(mockVerifySupabaseToken).toHaveBeenCalledWith(GOOD);
      expect(result.headers).toEqual({
        'Sec-WebSocket-Protocol': 'access_token',
      });
      expect(mockPutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: expect.objectContaining({ userId: 'user-sub' }),
        }),
      );
    });

    it('reads the header whatever its case, as Node lowercases it', async () => {
      const result = await handler(
        createMockConnectEvent({
          headers: { 'sec-websocket-protocol': `access_token,${GOOD}` },
        }),
      );

      expect(result.statusCode).toBe(200);
      expect(result.headers?.['Sec-WebSocket-Protocol']).toBe('access_token');
    });

    it('refuses an invalid token offered as a subprotocol', async () => {
      const result = await handler(offered('access_token, forged-jwt'));

      expect(result.statusCode).toBe(401);
      expect(result.headers).toBeUndefined();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('refuses access_token offered with no token after it', async () => {
      const result = await handler(offered('access_token'));

      expect(result.statusCode).toBe(401);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('refuses a connection with no token anywhere', async () => {
      const result = await handler(
        createMockConnectEvent({ headers: {}, queryStringParameters: {} }),
      );

      expect(result.statusCode).toBe(401);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('still accepts ?token= during the deprecation window, with a warning and no protocol echo', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await handler(
        createMockConnectEvent({
          headers: {},
          queryStringParameters: { token: GOOD },
        }),
      );

      expect(result.statusCode).toBe(200);
      expect(result.headers).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Deprecated query string authentication'),
        expect.anything(),
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(GOOD);
      warn.mockRestore();
    });

    it('does not warn when the subprotocol carries the token', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await handler(offered(`access_token, ${GOOD}`));

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('DynamoDB Errors', () => {
    it('should handle DynamoDB connection failure', async () => {
      const event = createMockConnectEvent();

      mockVerifySupabaseToken.mockResolvedValue('user-123');
      // Reset mock and configure for this test
      mockSend.mockReset();
      mockSend
        .mockResolvedValueOnce({ Items: [] }) // QueryCommand succeeds
        .mockRejectedValueOnce(new Error('DynamoDB connection timeout')); // PutCommand fails

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body!)).toEqual({
        message: 'Failed to connect',
      });
    });

    it('should handle DynamoDB write errors', async () => {
      const event = createMockConnectEvent();

      mockVerifySupabaseToken.mockResolvedValue('user-123');
      // Reset mock and configure for this test
      mockSend.mockReset();
      mockSend
        .mockResolvedValueOnce({ Items: [] }) // QueryCommand succeeds
        .mockRejectedValueOnce(new Error('ConditionalCheckFailedException')); // PutCommand fails

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body!).message).toBe('Failed to connect');
    });
  });

  describe('Authentication Edge Cases', () => {
    it('should handle lowercase "authorization" header', async () => {
      const event = createMockConnectEvent({
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      mockVerifySupabaseToken.mockResolvedValue('user-789');

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockVerifySupabaseToken).toHaveBeenCalledWith(
        'Bearer valid-token',
      );
    });

    it('should prefer the Authorization header over a query string token', async () => {
      const event = createMockConnectEvent({
        headers: {
          Authorization: 'Bearer header-token',
        },
        queryStringParameters: {
          token: 'Bearer query-token',
        },
      });

      mockVerifySupabaseToken.mockResolvedValue('user-query');

      await handler(event);

      expect(mockVerifySupabaseToken).toHaveBeenCalledWith(
        'Bearer header-token',
      );
    });

    it('should handle authentication service errors gracefully', async () => {
      const event = createMockConnectEvent();

      mockVerifySupabaseToken.mockRejectedValueOnce(
        new Error('Auth service unavailable'),
      );

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
    });
  });

  describe('Connection Metadata', () => {
    it('should store connectionId and userId in DynamoDB', async () => {
      const event = createMockConnectEvent({
        requestContext: {
          ...createMockConnectEvent().requestContext,
          connectionId: 'unique-connection-123',
        },
      });

      mockVerifySupabaseToken.mockResolvedValue('user-unique');
      // Reset and configure mocks for this test
      mockSend.mockReset();
      mockSend
        .mockResolvedValueOnce({ Items: [] }) // QueryCommand
        .mockResolvedValueOnce({}); // PutCommand

      await handler(event);

      expect(mockPutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: expect.objectContaining({
            connectionId: 'unique-connection-123',
            userId: 'user-unique',
          }),
        }),
      );
    });

    it('should store connectedAt timestamp', async () => {
      const event = createMockConnectEvent();

      // Reset and configure mocks for this test
      mockSend.mockReset();
      mockSend
        .mockResolvedValueOnce({ Items: [] }) // QueryCommand
        .mockResolvedValueOnce({}); // PutCommand

      await handler(event);

      expect(mockPutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: expect.objectContaining({
            connectedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), // ISO date
          }),
        }),
      );
    });
  });

  describe('Environment Configuration', () => {
    it('should use CONNECTIONS_TABLE_NAME from environment', async () => {
      // Note: Environment variable is read at module load time
      // This test verifies the handler uses the configured value from vitest.setup.ts
      const event = createMockConnectEvent();

      // Reset and configure mocks for this test
      mockSend.mockReset();
      mockSend
        .mockResolvedValueOnce({ Items: [] }) // QueryCommand
        .mockResolvedValueOnce({}); // PutCommand

      await handler(event);

      expect(mockPutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-connections-table', // From vitest.setup.ts
        }),
      );
    });

    it('should use default table name when not overridden', async () => {
      // Note: CONNECTIONS_TABLE_NAME is set in vitest.setup.ts
      // This test verifies the handler uses the configured value
      const event = createMockConnectEvent();

      await handler(event);

      // Should use the default test table name
      expect(mockPutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-connections-table',
        }),
      );
    });
  });
});
