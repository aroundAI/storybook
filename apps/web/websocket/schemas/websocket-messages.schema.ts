import { z } from 'zod';

/**
 * WebSocket Message Validation Schemas
 *
 * These schemas provide comprehensive input validation for all WebSocket messages
 * to prevent malformed data, oversized payloads, and injection attacks.
 */

// Maximum message size: 256KB
const MAX_MESSAGE_SIZE = 256 * 1024;

// Base schema for common fields
const baseMessageSchema = z.object({
  action: z.string().min(1).max(50),
  channel: z.string().max(255).optional(),
});

/**
 * Broadcast Message Schema
 * Validates admin broadcast messages
 */
export const broadcastMessageSchema = baseMessageSchema.extend({
  action: z.literal('broadcast'),
  message: z.string().max(10000).optional(),
  data: z.record(z.unknown()).optional(),
});

/**
 * Subscribe Message Schema
 * Validates channel subscription requests
 */
export const subscribeMessageSchema = baseMessageSchema.extend({
  action: z.literal('subscribe'),
  channel: z.string().min(1).max(255),
});

/**
 * Unsubscribe Message Schema
 * Validates channel unsubscription requests
 */
export const unsubscribeMessageSchema = baseMessageSchema.extend({
  action: z.literal('unsubscribe'),
  channel: z.string().min(1).max(255),
});

/**
 * Ping Message Schema
 * Validates keepalive ping messages
 */
export const pingMessageSchema = z.object({
  action: z.literal('ping'),
});

/**
 * Generic Message Schema
 * Union of all possible message types
 */
export const websocketMessageSchema = z.union([
  broadcastMessageSchema,
  subscribeMessageSchema,
  unsubscribeMessageSchema,
  pingMessageSchema,
]);

/**
 * Validate WebSocket message payload
 * @param body - Raw message body (string or object)
 * @returns Validated message object or null if invalid
 */
export function validateWebSocketMessage(
  body: string | Record<string, unknown>,
): z.infer<typeof websocketMessageSchema> | null {
  try {
    // Check message size (for string bodies)
    if (typeof body === 'string') {
      if (body.length > MAX_MESSAGE_SIZE) {
        console.error('Message exceeds maximum size:', {
          size: body.length,
          maxSize: MAX_MESSAGE_SIZE,
        });
        return null;
      }
    }

    // Parse JSON if body is a string
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;

    // Validate against schema
    const result = websocketMessageSchema.safeParse(parsed);

    if (!result.success) {
      console.error('Message validation failed:', {
        errors: result.error.errors,
        message: parsed,
      });
      return null;
    }

    return result.data;
  } catch (error) {
    console.error('Error validating WebSocket message:', error);
    return null;
  }
}

/**
 * Type exports for TypeScript
 */
export type BroadcastMessage = z.infer<typeof broadcastMessageSchema>;
export type SubscribeMessage = z.infer<typeof subscribeMessageSchema>;
export type UnsubscribeMessage = z.infer<typeof unsubscribeMessageSchema>;
export type PingMessage = z.infer<typeof pingMessageSchema>;
export type WebSocketMessage = z.infer<typeof websocketMessageSchema>;
