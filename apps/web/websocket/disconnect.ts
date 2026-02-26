import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.CONNECTIONS_TABLE_NAME || '';

/**
 * WebSocket $disconnect handler
 * Called when a client disconnects from the WebSocket API.
 *
 * Responsibilities:
 * 1. Read the connection record to find channel subscriptions + userId
 * 2. Notify all peers in those channels that this user left (presence removal)
 * 3. Delete the connection record from DynamoDB
 */
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  console.log('WebSocket disconnect event:', JSON.stringify(event, null, 2));

  const connectionId = event.requestContext.connectionId;
  const endpoint = `https://${event.requestContext.domainName}/${event.requestContext.stage}`;

  try {
    // 1. Read the connection record to get channels and userId
    const { Item: connection } = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { connectionId },
      }),
    );

    const channels: string[] = connection?.channels ?? [];
    const userId: string = connection?.userId ?? '';

    // 2. If this connection had channel subscriptions, notify peers
    if (channels.length > 0 && userId) {
      const apiGw = new ApiGatewayManagementApiClient({ endpoint });

      const message = JSON.stringify({
        type: 'user-left',
        userId,
        connectionId,
      });

      // Find all other connections that share a channel
      // TODO: Replace ScanCommand with GSI-based query for channel subscribers
      const { Items: allConnections } = await ddb.send(
        new ScanCommand({ TableName: TABLE_NAME }),
      );

      const peerConnectionIds = new Set<string>();

      for (const conn of allConnections ?? []) {
        if (conn.connectionId === connectionId) continue;
        const connChannels: string[] = conn.channels ?? [];
        if (connChannels.some((ch: string) => channels.includes(ch))) {
          peerConnectionIds.add(conn.connectionId);
        }
      }

      // Send presence removal to all peers
      const notifications = Array.from(peerConnectionIds).map(
        async (peerId) => {
          try {
            await apiGw.send(
              new PostToConnectionCommand({
                ConnectionId: peerId,
                Data: new TextEncoder().encode(message),
              }),
            );
          } catch (err: unknown) {
            const error = err as { statusCode?: number };
            if (error.statusCode === 410) {
              console.log(
                `Peer ${peerId} already disconnected, skipping`,
              );
            }
          }
        },
      );

      await Promise.allSettled(notifications);
      console.log(
        `Notified ${peerConnectionIds.size} peers about user ${userId} leaving`,
      );
    }

    // 3. Delete connection record
    await ddb.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { connectionId },
      }),
    );

    console.log(`Connection ${connectionId} deleted successfully`);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Disconnected' }),
    };
  } catch (error) {
    console.error('Error during disconnect cleanup:', error);

    // Best-effort: still try to delete the connection record
    try {
      await ddb.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { connectionId },
        }),
      );
    } catch {
      console.error('Failed to delete connection record');
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to disconnect' }),
    };
  }
};
