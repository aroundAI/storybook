import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.CONNECTIONS_TABLE_NAME || '';

/**
 * WebSocket $disconnect handler
 * Called when a client disconnects from the WebSocket API
 */
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  console.log('WebSocket disconnect event:', JSON.stringify(event, null, 2));

  const connectionId = event.requestContext.connectionId;

  try {
    // Remove connection from DynamoDB
    await ddb.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          connectionId,
        },
      }),
    );

    console.log(`Connection ${connectionId} deleted successfully`);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Disconnected' }),
    };
  } catch (error) {
    console.error('Error deleting connection:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to disconnect' }),
    };
  }
};
