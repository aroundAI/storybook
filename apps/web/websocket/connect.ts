import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyStructuredResultV2,
  APIGatewayProxyWebsocketEventV2,
} from 'aws-lambda';

import { awsClientOptions } from '@kit/shared/vendors';

import { isSuperAdminFromToken, verifySupabaseToken } from './utils/auth';

const client = new DynamoDBClient(awsClientOptions('dynamodb'));
const ddb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.CONNECTIONS_TABLE_NAME || '';
const MAX_CONNECTIONS_PER_USER = 5; // Maximum concurrent connections per user

/**
 * API Gateway delivers the upgrade request's headers and query string on
 * `$connect`; `@types/aws-lambda`'s websocket event does not declare them.
 */
export type WebsocketConnectEvent = APIGatewayProxyWebsocketEventV2 & {
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
};

/**
 * A browser `WebSocket` cannot set headers, so it sends the access token as a
 * subprotocol pair: `new WebSocket(url, ['access_token', token])` arrives as
 * `Sec-WebSocket-Protocol: access_token, <token>` (KB-191).
 */
export const TOKEN_SUBPROTOCOL = 'access_token';

type TokenSource = 'authorization' | 'subprotocol' | 'query' | 'none';

function headerValue(
  headers: WebsocketConnectEvent['headers'],
  name: string,
): string | undefined {
  const key = Object.keys(headers ?? {}).find((k) => k.toLowerCase() === name);
  return key ? headers?.[key] : undefined;
}

function tokenFromSubprotocol(
  headers: WebsocketConnectEvent['headers'],
): string | undefined {
  const protocols = (headerValue(headers, 'sec-websocket-protocol') ?? '')
    .split(',')
    .map((protocol) => protocol.trim());
  const index = protocols.indexOf(TOKEN_SUBPROTOCOL);
  return index === -1 ? undefined : protocols[index + 1] || undefined;
}

export function readConnectToken(event: WebsocketConnectEvent): {
  token: string | undefined;
  source: TokenSource;
} {
  const authorization = headerValue(event.headers, 'authorization');
  if (authorization) return { token: authorization, source: 'authorization' };

  const subprotocol = tokenFromSubprotocol(event.headers);
  if (subprotocol) return { token: subprotocol, source: 'subprotocol' };

  const query = event.queryStringParameters?.token;
  if (query) return { token: query, source: 'query' };

  return { token: undefined, source: 'none' };
}

/**
 * WebSocket $connect handler
 * Called when a client connects to the WebSocket API
 * Requires a JWT in the Authorization header or the `access_token`
 * subprotocol; `?token=` is still accepted, with a warning, until KB-191's
 * deprecation window closes.
 */
export const handler = async (
  event: WebsocketConnectEvent,
): Promise<APIGatewayProxyStructuredResultV2> => {
  console.log('WebSocket connect event:', {
    connectionId: event.requestContext.connectionId,
    hasAuthHeader:
      !!event.headers?.Authorization || !!event.headers?.authorization,
    hasSubprotocol: !!headerValue(event.headers, 'sec-websocket-protocol'),
    hasQueryParams: !!event.queryStringParameters,
  });

  const connectionId = event.requestContext.connectionId;
  const connectedAt = new Date().toISOString();

  try {
    const { token: authHeader, source } = readConnectToken(event);

    // KB-191: `?token=` puts the credential in every access log. It is kept
    // for clients loaded before the subprotocol change; remove it once this
    // warning has stopped appearing (see specs/known-bugs/KB-191.md).
    if (source === 'query') {
      console.warn(
        '[Security] Deprecated query string authentication used (token exposed in URL logs). ' +
          `Send the token as the "${TOKEN_SUBPROTOCOL}" WebSocket subprotocol instead.`,
        { connectionId },
      );
    }

    // Verify JWT token and extract userId
    const userId = await verifySupabaseToken(authHeader);

    if (!userId) {
      console.error('Authentication failed: Invalid or missing token');
      return {
        statusCode: 401,
        body: JSON.stringify({
          message: 'Unauthorized: Invalid or missing authentication token',
        }),
      };
    }

    // Check if user is a super admin (store for later authorization checks)
    const isSuperAdmin = await isSuperAdminFromToken(authHeader);
    console.log('[Auth] Connection authorization:', {
      userId: userId.substring(0, 8) + '...',
      isSuperAdmin,
    });

    // Check connection limit for this user
    const existingConnections = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'userIdIndex',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        Select: 'COUNT',
      }),
    );

    const connectionCount = existingConnections.Count || 0;

    if (connectionCount >= MAX_CONNECTIONS_PER_USER) {
      console.warn(
        `User ${userId} exceeded connection limit (${connectionCount}/${MAX_CONNECTIONS_PER_USER})`,
      );
      return {
        statusCode: 429,
        body: JSON.stringify({
          message: `Too many connections. Maximum ${MAX_CONNECTIONS_PER_USER} concurrent connections allowed.`,
        }),
      };
    }

    // Store connection in DynamoDB with userId and authorization flags
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          connectionId,
          userId,
          isSuperAdmin, // Store super admin status for authorization checks
          connectedAt,
          ttl: Math.floor(Date.now() / 1000) + 3600, // 1 hour TTL
        },
      }),
    );

    console.log(
      `Connection ${connectionId} stored successfully for user ${userId}`,
    );

    return {
      statusCode: 200,
      // API Gateway forwards this header in the 101 response; a browser that
      // offered a subprotocol drops a connection that does not select one.
      ...(source === 'subprotocol' && {
        headers: { 'Sec-WebSocket-Protocol': TOKEN_SUBPROTOCOL },
      }),
      body: JSON.stringify({ message: 'Connected', userId }),
    };
  } catch (error) {
    console.error('Error storing connection:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to connect' }),
    };
  }
};
