/**
 * Test helpers for WebSocket Lambda handlers
 */

import type {
  APIGatewayProxyWebsocketEventV2,
  APIGatewayEventRequestContextV2,
} from 'aws-lambda';

/**
 * Create a mock WebSocket connect event
 */
export function createMockConnectEvent(
  overrides?: Partial<APIGatewayProxyWebsocketEventV2>,
): APIGatewayProxyWebsocketEventV2 {
  const defaultEvent: APIGatewayProxyWebsocketEventV2 = {
    headers: {
      Authorization: 'Bearer mock-jwt-token',
    },
    requestContext: {
      routeKey: '$connect',
      connectionId: 'test-connection-id',
      eventType: 'CONNECT',
      requestId: 'test-request-id',
      messageDirection: 'IN',
      stage: 'test',
      connectedAt: Date.now(),
      requestTimeEpoch: Date.now(),
      identity: {
        sourceIp: '127.0.0.1',
        userAgent: 'test-agent',
      },
      messageId: 'test-message-id',
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      apiId: 'test-api-id',
      extendedRequestId: 'test-extended-request-id',
      requestTime: new Date().toISOString(),
    } as APIGatewayEventRequestContextV2,
    isBase64Encoded: false,
  };

  return { ...defaultEvent, ...overrides };
}

/**
 * Create a mock WebSocket disconnect event
 */
export function createMockDisconnectEvent(
  connectionId = 'test-connection-id',
): APIGatewayProxyWebsocketEventV2 {
  return {
    headers: {},
    requestContext: {
      routeKey: '$disconnect',
      connectionId,
      eventType: 'DISCONNECT',
      requestId: 'test-request-id',
      messageDirection: 'IN',
      stage: 'test',
      connectedAt: Date.now() - 3600000, // 1 hour ago
      requestTimeEpoch: Date.now(),
      identity: {
        sourceIp: '127.0.0.1',
        userAgent: 'test-agent',
      },
      messageId: 'test-message-id',
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      apiId: 'test-api-id',
      extendedRequestId: 'test-extended-request-id',
      requestTime: new Date().toISOString(),
    } as APIGatewayEventRequestContextV2,
    isBase64Encoded: false,
  };
}

/**
 * Create a mock WebSocket message event
 */
export function createMockMessageEvent(
  body: Record<string, unknown>,
  connectionId = 'test-connection-id',
): APIGatewayProxyWebsocketEventV2 {
  return {
    headers: {},
    body: JSON.stringify(body),
    requestContext: {
      routeKey: '$default',
      connectionId,
      eventType: 'MESSAGE',
      requestId: 'test-request-id',
      messageDirection: 'IN',
      stage: 'test',
      connectedAt: Date.now() - 60000, // 1 minute ago
      requestTimeEpoch: Date.now(),
      identity: {
        sourceIp: '127.0.0.1',
        userAgent: 'test-agent',
      },
      messageId: 'test-message-id',
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      apiId: 'test-api-id',
      extendedRequestId: 'test-extended-request-id',
      requestTime: new Date().toISOString(),
    } as APIGatewayEventRequestContextV2,
    isBase64Encoded: false,
  };
}
