import { createClient } from '@supabase/supabase-js';

import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyStructuredResultV2,
  APIGatewayProxyWebsocketEventV2,
} from 'aws-lambda';
import ws from 'ws';

import type { Database } from '@kit/supabase/database';

import { validateWebSocketMessage } from './schemas/websocket-messages.schema';
import { isValidUUID } from './utils/validation';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.CONNECTIONS_TABLE_NAME || '';

// Initialize Supabase client for authorization checks
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey, {
  realtime: {
    // ws is the WHATWG client the realtime transport expects; @types/ws leads
    // with a server-mode `new (address: null)` overload that defeats inference.
    transport: ws as unknown as typeof WebSocket,
  },
});

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
 * Check if sender and target users share a team account
 * Uses atomic query to prevent TOCTOU race conditions
 * @param senderId - Sender's userId
 * @param targetId - Target userId
 * @returns true if they share at least one team account, false otherwise
 */
async function canUserMessageUser(
  senderId: string,
  targetId: string,
): Promise<boolean> {
  try {
    // Validate UUID formats before database queries
    if (!isValidUUID(senderId)) {
      console.error('[Validation] Invalid UUID format for senderId:', senderId);
      return false;
    }

    if (!isValidUUID(targetId)) {
      console.error('[Validation] Invalid UUID format for targetId:', targetId);
      return false;
    }

    // Users can always message themselves (for testing/debugging)
    if (senderId === targetId) {
      return true;
    }

    // Atomic query: Check if sender and target share any account_id
    // This uses a self-join to find shared team memberships in a single query,
    // eliminating the race condition window between separate queries
    // @ts-expect-error KB-91: defined only in supabase/schemas/, which builds nothing; no migration creates it, so this RPC errors and send-to-user is refused
    const { data, error } = await supabase.rpc('check_shared_team_membership', {
      sender_user_id: senderId,
      target_user_id: targetId,
    });

    // If RPC function fails, deny authorization
    // The check_shared_team_membership function should exist in the database
    // If it doesn't exist, this is a deployment issue that should be fixed
    if (error) {
      console.error(
        '[Auth] Failed to check team membership - RPC function error:',
        error,
        '\nEnsure check_shared_team_membership function exists in database',
      );
      return false;
    }

    const hasSharedAccount = data === true;

    console.log('[Auth] Team membership check:', {
      senderId: senderId.substring(0, 8) + '...',
      targetId: targetId.substring(0, 8) + '...',
      hasSharedAccount,
    });

    return hasSharedAccount;
  } catch (error) {
    console.error('[Auth] Error checking team membership:', error);
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
      case 'send-to-user': {
        // Send message to all connections of a specific user (by userId)
        const {
          targetUserId,
          message: messageContent,
          data: messageData,
        } = validatedMessage;

        if (!targetUserId) {
          await apiGatewayClient.send(
            new PostToConnectionCommand({
              ConnectionId: connectionId,
              Data: JSON.stringify({
                type: 'error',
                message: 'targetUserId is required',
              }),
            }),
          );
          break;
        }

        // SECURITY: Get sender's userId from connection
        const senderId = await getSenderUserId(connectionId);

        if (!senderId) {
          console.error(
            '[Security] Unauthorized: Could not identify sender for send-to-user',
          );
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

        // SECURITY: Check if sender and target share a team account
        const canMessage = await canUserMessageUser(senderId, targetUserId);

        if (!canMessage) {
          console.warn('[Security] Unauthorized message attempt:', {
            senderId: senderId.substring(0, 8) + '...',
            targetUserId: targetUserId.substring(0, 8) + '...',
            action: 'send-to-user',
          });

          await apiGatewayClient.send(
            new PostToConnectionCommand({
              ConnectionId: connectionId,
              Data: JSON.stringify({
                type: 'error',
                message:
                  'Unauthorized: You can only message users in your team',
              }),
            }),
          );
          break;
        }

        console.log(
          `[Security] Authorized: Sending message from ${senderId.substring(0, 8)}... to user ${targetUserId}`,
        );

        // Query DynamoDB for all connections belonging to targetUserId
        const connections = await ddb.send(
          new QueryCommand({
            TableName: TABLE_NAME,
            IndexName: 'userIdIndex',
            KeyConditionExpression: 'userId = :userId',
            ExpressionAttributeValues: {
              ':userId': targetUserId,
            },
          }),
        );

        console.log(
          `Found ${connections.Items?.length || 0} connections for user ${targetUserId}`,
        );

        // Send to all connections of the target user
        const postCalls = (connections.Items || []).map(
          async ({ connectionId: targetId }) => {
            try {
              await apiGatewayClient.send(
                new PostToConnectionCommand({
                  ConnectionId: targetId,
                  Data: JSON.stringify({
                    type: 'notification',
                    channel,
                    message: messageContent,
                    data: messageData,
                    timestamp: new Date().toISOString(),
                  }),
                }),
              );
              console.log(`Message sent to connection ${targetId}`);
            } catch (error: unknown) {
              const statusCode =
                error &&
                typeof error === 'object' &&
                'statusCode' in error &&
                typeof error.statusCode === 'number'
                  ? error.statusCode
                  : null;

              if (statusCode === 410) {
                // Connection is gone, remove it from DynamoDB
                console.log(
                  `Stale connection found: ${targetId}, removing from DynamoDB`,
                );
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
