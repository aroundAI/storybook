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
} from '@aws-sdk/lib-dynamodb';
import { createClient } from '@supabase/supabase-js';
import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';

import { isSuperAdminFromToken } from './utils/auth';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.CONNECTIONS_TABLE_NAME || '';

// Initialize Supabase client for authorization checks
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
 * Check if sender and target users share a team account
 * @param senderId - Sender's userId
 * @param targetId - Target userId
 * @returns true if they share at least one team account, false otherwise
 */
async function canUserMessageUser(
  senderId: string,
  targetId: string,
): Promise<boolean> {
  try {
    // Users can always message themselves (for testing/debugging)
    if (senderId === targetId) {
      return true;
    }

    // Query accounts_memberships to find shared team accounts
    const { data: senderAccounts, error: senderError } = await supabase
      .from('accounts_memberships')
      .select('account_id')
      .eq('user_id', senderId);

    if (senderError) {
      console.error('[Auth] Error fetching sender accounts:', senderError);
      return false;
    }

    const { data: targetAccounts, error: targetError } = await supabase
      .from('accounts_memberships')
      .select('account_id')
      .eq('user_id', targetId);

    if (targetError) {
      console.error('[Auth] Error fetching target accounts:', targetError);
      return false;
    }

    // Check if there's any overlap in account_ids
    const senderAccountIds = new Set(
      senderAccounts?.map((a) => a.account_id) || [],
    );
    const sharedAccount = targetAccounts?.some((a) =>
      senderAccountIds.has(a.account_id),
    );

    console.log('[Auth] Team membership check:', {
      senderId: senderId.substring(0, 8) + '...',
      targetId: targetId.substring(0, 8) + '...',
      sharedAccount,
    });

    return !!sharedAccount;
  } catch (error) {
    console.error('[Auth] Error checking team membership:', error);
    return false;
  }
}

/**
 * WebSocket $default handler
 * Called for all WebSocket messages that don't match a specific route
 */
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  console.log('WebSocket default event:', JSON.stringify(event, null, 2));

  const connectionId = event.requestContext.connectionId;
  const domain = event.requestContext.domainName;
  const stage = event.requestContext.stage;

  // Create API Gateway Management API client for sending messages
  const apiGatewayClient = new ApiGatewayManagementApiClient({
    endpoint: `https://${domain}/${stage}`,
  });

  try {
    // Parse incoming message
    const body = event.body ? JSON.parse(event.body) : {};
    const { action, channel, message, data } = body;

    console.log('Message received:', { action, channel, connectionId });

    switch (action) {
      case 'send-to-user': {
        // Send message to all connections of a specific user (by userId)
        const {
          targetUserId,
          message: messageContent,
          data: messageData,
        } = body;

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
        console.log('[Security] Broadcast request received, checking admin status');

        // Extract auth header from event (stored during connection)
        const authHeader =
          event.headers?.Authorization ||
          event.headers?.authorization ||
          event.queryStringParameters?.token;

        // Check if user is a super admin
        const isAdmin = await isSuperAdminFromToken(authHeader);

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
        // Handle channel subscription
        // TODO: Store channel subscriptions in DynamoDB
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
        // Handle channel unsubscription
        // TODO: Remove channel subscription from DynamoDB
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
              message: body,
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
