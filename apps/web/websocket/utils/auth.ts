import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Verify Supabase JWT token and extract userId
 * @param authHeader - Authorization header value (e.g., "Bearer eyJ...")
 * @returns userId if token is valid, null otherwise
 */
export async function verifySupabaseToken(
  authHeader: string | undefined,
): Promise<string | null> {
  if (!authHeader) {
    console.log('No Authorization header provided');
    return null;
  }

  // Extract token from "Bearer <token>" format
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  if (!token) {
    console.log('No token found in Authorization header');
    return null;
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (!supabaseUrl) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL environment variable not set');
    }

    // Get Supabase JWT secret from environment
    const supabaseJwtSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseJwtSecret) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable not set');
    }

    // Create JWKS endpoint for Supabase
    // Supabase uses a JWKS endpoint at: https://<project-ref>.supabase.co/auth/v1/jwks
    const JWKS = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/jwks`));

    // Verify the JWT token
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: supabaseUrl,
      audience: 'authenticated',
    });

    // Extract user ID from the payload
    const userId = payload.sub;

    if (!userId) {
      console.log('No user ID found in token payload');
      return null;
    }

    console.log('Token verified successfully for user:', userId);
    return userId;
  } catch (error) {
    console.error('Error verifying Supabase token:', error);
    return null;
  }
}

/**
 * Extract userId from query string parameters (fallback method)
 * @param queryStringParameters - API Gateway query string parameters
 * @returns userId if present, null otherwise
 */
export function extractUserIdFromQuery(
  queryStringParameters?: Record<string, string | undefined>,
): string | null {
  if (!queryStringParameters) {
    return null;
  }

  const userId = queryStringParameters.userId || queryStringParameters.user_id;

  if (!userId) {
    return null;
  }

  console.log('Extracted userId from query parameters:', userId);
  return userId;
}
