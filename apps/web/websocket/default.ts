import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const TABLE_NAME = process.env.CONNECTIONS_TABLE_NAME || '';

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

        console.log(`Sending message to user ${targetUserId}`);

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
        // For production, you should verify the sender has admin privileges
        console.warn(
          'Broadcast to ALL users requested - this should be admin-only',
        );

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
