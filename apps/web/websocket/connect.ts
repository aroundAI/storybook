import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { awsClientOptions } from '@kit/shared/vendors';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyStructuredResultV2,
  APIGatewayProxyWebsocketEventV2,
} from 'aws-lambda';

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
 * WebSocket $connect handler
 * Called when a client connects to the WebSocket API
 * Requires authentication via JWT token in Authorization header or query string
 */
export const handler = async (
  event: WebsocketConnectEvent,
): Promise<APIGatewayProxyStructuredResultV2> => {
  console.log('WebSocket connect event:', {
    connectionId: event.requestContext.connectionId,
    hasAuthHeader:
      !!event.headers?.Authorization || !!event.headers?.authorization,
    hasQueryParams: !!event.queryStringParameters,
  });

  const connectionId = event.requestContext.connectionId;
  const connectedAt = new Date().toISOString();

  try {
    // Extract Authorization header (check both cases)
    // SECURITY WARNING: Query string authentication is supported as a fallback
    // but exposes tokens in logs and browser history. Use Authorization header instead.
    const authHeader =
      event.headers?.Authorization ||
      event.headers?.authorization ||
      event.queryStringParameters?.token;

    // Log security warning if query string auth is used
    if (
      !event.headers?.Authorization &&
      !event.headers?.authorization &&
      event.queryStringParameters?.token
    ) {
      console.warn(
        '[Security] Query string authentication used (tokens exposed in logs). ' +
          'Recommended: Use Authorization header instead.',
        {
          connectionId,
          hasQueryToken: true,
        },
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
