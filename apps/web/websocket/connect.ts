import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';

import { verifySupabaseToken } from './utils/auth';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.CONNECTIONS_TABLE_NAME || '';
const MAX_CONNECTIONS_PER_USER = 5; // Maximum concurrent connections per user

/**
 * WebSocket $connect handler
 * Called when a client connects to the WebSocket API
 * Requires authentication via JWT token in Authorization header or query string
 */
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
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
    const authHeader =
      event.headers?.Authorization ||
      event.headers?.authorization ||
      event.queryStringParameters?.token; // Support token via query string as fallback

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

    // Store connection in DynamoDB with userId
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          connectionId,
          userId,
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
