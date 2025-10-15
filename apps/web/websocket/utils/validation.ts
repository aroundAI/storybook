/**
 * WebSocket Input Validation Utilities
 *
 * Provides validation functions for user inputs to prevent injection attacks
 * and malformed data from reaching database queries.
 */

// UUID v4 validation regex (RFC 4122)
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// General UUID validation regex (any version)
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate if a string is a valid UUID (any version)
 * @param value - The string to validate
 * @param strict - If true, only allow UUIDv4 (default: false)
 * @returns true if valid UUID, false otherwise
 */
export function isValidUUID(value: unknown, strict = false): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const regex = strict ? UUID_V4_REGEX : UUID_REGEX;
  return regex.test(value);
}

/**
 * Validate and sanitize a UUID string
 * @param value - The value to validate
 * @param paramName - Parameter name for error logging
 * @param strict - If true, only allow UUIDv4 (default: false)
 * @returns Validated UUID string or null if invalid
 */
export function validateUUID(
  value: unknown,
  paramName: string,
  strict = false,
): string | null {
  if (!isValidUUID(value, strict)) {
    console.error(`[Validation] Invalid UUID format for ${paramName}:`, value);
    return null;
  }

  // Return lowercase normalized UUID
  return value.toLowerCase();
}

/**
 * Validate multiple UUIDs at once
 * @param values - Object with UUID values to validate
 * @param strict - If true, only allow UUIDv4 (default: false)
 * @returns Object with validated UUIDs or null if any validation fails
 */
export function validateUUIDs<T extends Record<string, unknown>>(
  values: T,
  strict = false,
): { [K in keyof T]: string } | null {
  const validated: Record<string, string> = {};

  for (const [key, value] of Object.entries(values)) {
    const validatedValue = validateUUID(value, key, strict);

    if (!validatedValue) {
      return null;
    }

    validated[key] = validatedValue;
  }

  return validated as { [K in keyof T]: string };
}

/**
 * Validate connection ID format (AWS API Gateway connection IDs)
 * Connection IDs are base64url-encoded strings, not UUIDs
 * @param value - The connection ID to validate
 * @returns true if valid format, false otherwise
 */
export function isValidConnectionId(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  // API Gateway connection IDs are alphanumeric with = padding
  // Typical format: A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6=
  const connectionIdRegex = /^[A-Za-z0-9_-]+=*$/;
  return (
    connectionIdRegex.test(value) && value.length >= 10 && value.length <= 128
  );
}
