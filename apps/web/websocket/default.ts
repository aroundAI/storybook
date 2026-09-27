import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { awsClientOptions } from '@kit/shared/vendors';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyStructuredResultV2,
  APIGatewayProxyWebsocketEventV2,
} from 'aws-lambda';

import { validateWebSocketMessage } from './schemas/websocket-messages.schema';

const ddbClient = new DynamoDBClient(awsClientOptions('dynamodb'));
const ddb = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.CONNECTIONS_TABLE_NAME || '';

/**
 * Get sender's userId from connectionId
 * @param connectionId - The WebSocket connection ID
 * @returns userId if found, null otherwise
 */
async function getSenderUserId(connectionId: string): Promise<string | null> {
  try {
    const { Item } = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { connectionId },
      }),
    );

    if (!Item?.userId) {
      console.error('[Auth] No userId found for connection:', connectionId);
      return null;
    }

    return Item.userId as string;
  } catch (error) {
    console.error('[Auth] Error getting userId from connection:', error);
    return null;
  }
}

/**
 * Check if sender is a super admin (from stored connection data)
 * @param connectionId - The WebSocket connection ID
 * @returns true if user is super admin, false otherwise
 */
async function isSenderSuperAdmin(connectionId: string): Promise<boolean> {
  try {
    const { Item } = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { connectionId },
      }),
    );

    if (!Item) {
      console.error(
        '[Auth] No connection found for super admin check:',
        connectionId,
      );
      return false;
    }

    const isSuperAdmin = Item.isSuperAdmin === true;
    console.log('[Auth] Super admin check from stored connection:', {
      connectionId: connectionId.substring(0, 8) + '...',
      isSuperAdmin,
    });

    return isSuperAdmin;
  } catch (error) {
    console.error('[Auth] Error checking super admin status:', error);
    return false;
  }
}

/**
 * WebSocket $default handler
 * Called for all WebSocket messages that don't match a specific route
 */
export const handler = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  console.log('WebSocket default event:', JSON.stringify(event, null, 2));

  const connectionId = event.requestContext.connectionId;
  const domain = event.requestContext.domainName;
  const stage = event.requestContext.stage;

  // Create API Gateway Management API client for sending messages
  const apiGatewayClient = new ApiGatewayManagementApiClient({
    endpoint: `https://${domain}/${stage}`,
    ...awsClientOptions('apigateway'),
  });

  try {
    // Validate incoming message
    const validatedMessage = event.body
      ? validateWebSocketMessage(event.body)
      : null;

    if (!validatedMessage) {
      console.error('Invalid message format or validation failed');
      await apiGatewayClient.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: JSON.stringify({
            type: 'error',
            message:
              'Invalid message format. Please check message schema and size limits.',
          }),
        }),
      );
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid message format' }),
      };
    }

    const { action, channel, message, data } = validatedMessage as Record<
      string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    >;

    console.log('Message received:', { action, channel, connectionId });

    switch (validatedMessage.action) {
      case 'broadcast': {
        // Broadcast to ALL users (admin-only feature - use sparingly)
        // SECURITY: Verify the sender has super admin privileges
        console.log(
          '[Security] Broadcast request received, checking admin status',
        );

        // Check if sender is a super admin using stored connection data
        // This prevents authentication state desynchronization by using
        // connection-time auth state instead of message-time auth state
        const isAdmin = await isSenderSuperAdmin(connectionId);

        if (!isAdmin) {
          console.warn(
            '[Security] Unauthorized broadcast attempt from non-admin user',
            {
              connectionId,
            },
          );

          await apiGatewayClient.send(
            new PostToConnectionCommand({
              ConnectionId: connectionId,
              Data: JSON.stringify({
                type: 'error',
                message:
                  'Unauthorized: Broadcast requires super admin privileges',
              }),
            }),
          );
          break;
        }

        console.log('[Security] Authorized: Super admin broadcast approved');

        const connections = await ddb.send(
          new ScanCommand({
            TableName: TABLE_NAME,
            ProjectionExpression: 'connectionId',
          }),
        );

        const postCalls = (connections.Items || []).map(
          async ({ connectionId: targetId }) => {
            try {
              await apiGatewayClient.send(
                new PostToConnectionCommand({
                  ConnectionId: targetId,
                  Data: JSON.stringify({
                    type: 'broadcast',
                    channel,
                    message,
                    data,
                    sender: connectionId,
                  }),
                }),
              );
            } catch (error: unknown) {
              const statusCode =
                error &&
                typeof error === 'object' &&
                'statusCode' in error &&
                typeof error.statusCode === 'number'
                  ? error.statusCode
                  : null;

              if (statusCode === 410) {
                console.log(`Stale connection found: ${targetId}`);
                await ddb.send(
                  new DeleteCommand({
                    TableName: TABLE_NAME,
                    Key: { connectionId: targetId },
                  }),
                );
              } else {
                console.error(`Error sending to ${targetId}:`, error);
              }
            }
          },
        );

        await Promise.all(postCalls);
        break;
      }

      case 'subscribe': {
        // Store channel subscription in DynamoDB
        const senderId = await getSenderUserId(connectionId);
        if (!senderId) {
          await apiGatewayClient.send(
            new PostToConnectionCommand({
              ConnectionId: connectionId,
              Data: JSON.stringify({
                type: 'error',
                message: 'Unauthorized: Could not verify sender identity',
              }),
            }),
          );
          break;
        }

        // Add channel to the subscription set (ADD creates the set if it doesn't exist)
        await ddb.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { connectionId },
            UpdateExpression: 'ADD #ch :channel_set',
            ExpressionAttributeNames: { '#ch': 'channels' },
            ExpressionAttributeValues: { ':channel_set': new Set([channel]) },
          }),
        );

        await apiGatewayClient.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: JSON.stringify({
              type: 'subscribed',
              channel,
            }),
          }),
        );
        break;
      }

      case 'unsubscribe': {
        // Remove channel subscription from DynamoDB
        await ddb.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { connectionId },
            UpdateExpression: 'DELETE #ch :channel_set',
            ExpressionAttributeNames: { '#ch': 'channels' },
            ExpressionAttributeValues: { ':channel_set': new Set([channel]) },
          }),
        );

        await apiGatewayClient.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: JSON.stringify({
              type: 'unsubscribed',
              channel,
            }),
          }),
        );
        break;
      }

      case 'ping': {
        // Handle ping/pong for keepalive
        await apiGatewayClient.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: JSON.stringify({
              type: 'pong',
            }),
          }),
        );
        break;
      }

      default: {
        // Echo back unknown messages
        await apiGatewayClient.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: JSON.stringify({
              type: 'echo',
              message: validatedMessage,
            }),
          }),
        );
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Message processed' }),
    };
  } catch (error) {
    console.error('Error processing message:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to process message' }),
    };
  }
};
