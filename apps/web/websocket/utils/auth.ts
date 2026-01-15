import { createLocalJWKSet, jwtVerify, type JWK } from 'jose';

// Cache for JWKS to avoid fetching on every request
let cachedJWKS: ReturnType<typeof createLocalJWKSet> | null = null;
let cachedJWKSExpiry = 0;
const JWKS_CACHE_TTL = 3600000; // 1 hour in milliseconds

/**
 * Fetch JWKS from Supabase with apikey header
 */
async function getSupabaseJWKS() {
  const now = Date.now();
  if (cachedJWKS && now < cachedJWKSExpiry) {
    return cachedJWKS;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY not set');
  }

  // Supabase JWKS endpoint requires apikey header
  const jwksUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
  const response = await fetch(jwksUrl, {
    headers: {
      'apikey': supabaseAnonKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status} ${response.statusText}`);
  }

  const jwks = await response.json() as { keys: JWK[] };
  cachedJWKS = createLocalJWKSet(jwks);
  cachedJWKSExpiry = now + JWKS_CACHE_TTL;

  return cachedJWKS;
}

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

    // Get JWKS (fetched with apikey header, cached for 1 hour)
    const JWKS = await getSupabaseJWKS();

    // Verify the JWT token with jose library
    // This automatically validates signature, expiration (exp), and not-before (nbf) claims
    // Note: Supabase JWT issuer includes /auth/v1 path
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${supabaseUrl}/auth/v1`,
      audience: 'authenticated',
      clockTolerance: 60, // Allow 60 seconds clock skew
    });

    // Extract user ID from the payload
    const userId = payload.sub;

    if (!userId) {
      console.log('No user ID found in token payload');
      return null;
    }

    // Explicit expiration check with maximum token lifetime (24 hours)
    const now = Math.floor(Date.now() / 1000);
    const exp = payload.exp;
    const iat = payload.iat;

    if (!exp) {
      console.error('Token missing expiration claim (exp)');
      return null;
    }

    if (!iat) {
      console.error('Token missing issued-at claim (iat)');
      return null;
    }

    // Check if token has expired
    if (exp < now) {
      console.error('Token has expired:', {
        exp: new Date(exp * 1000).toISOString(),
        now: new Date(now * 1000).toISOString(),
      });
      return null;
    }

    // Enforce maximum token lifetime of 24 hours
    const MAX_TOKEN_LIFETIME = 24 * 60 * 60; // 24 hours in seconds
    const tokenAge = now - iat;

    if (tokenAge > MAX_TOKEN_LIFETIME) {
      console.error('Token exceeds maximum lifetime:', {
        tokenAge,
        maxLifetime: MAX_TOKEN_LIFETIME,
        iat: new Date(iat * 1000).toISOString(),
      });
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

/**
 * Extract app_metadata from JWT token
 * @param authHeader - Authorization header value (e.g., "Bearer eyJ...")
 * @returns app_metadata object if present, null otherwise
 */
export async function extractAppMetadataFromToken(
  authHeader: string | undefined,
): Promise<Record<string, unknown> | null> {
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

    // Get JWKS (fetched with apikey header, cached for 1 hour)
    const JWKS = await getSupabaseJWKS();

    // Verify the JWT token with jose library
    // This automatically validates signature, expiration (exp), and not-before (nbf) claims
    // Note: Supabase JWT issuer includes /auth/v1 path
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${supabaseUrl}/auth/v1`,
      audience: 'authenticated',
      clockTolerance: 60, // Allow 60 seconds clock skew
    });

    // Explicit expiration check
    const now = Math.floor(Date.now() / 1000);
    const exp = payload.exp;

    if (!exp) {
      console.error('Token missing expiration claim (exp)');
      return null;
    }

    if (exp < now) {
      console.error('Token has expired');
      return null;
    }

    // Extract app_metadata from the payload
    const appMetadata = payload.app_metadata as Record<string, unknown>;

    if (!appMetadata) {
      console.log('No app_metadata found in token payload');
      return null;
    }

    return appMetadata;
  } catch (error) {
    console.error('Error extracting app_metadata from token:', error);
    return null;
  }
}

/**
 * Check if user is a super admin from JWT token
 * Replicates the logic of the database is_super_admin() function
 * @param authHeader - Authorization header value (e.g., "Bearer eyJ...")
 * @returns true if user is super admin, false otherwise
 */
export async function isSuperAdminFromToken(
  authHeader: string | undefined,
): Promise<boolean> {
  try {
    const appMetadata = await extractAppMetadataFromToken(authHeader);

    if (!appMetadata) {
      return false;
    }

    // Check if role is 'super-admin' (same logic as database function)
    const role = appMetadata.role as string;
    const isSuperAdmin = role === 'super-admin';

    console.log('Super admin check:', { role, isSuperAdmin });
    return isSuperAdmin;
  } catch (error) {
    console.error('Error checking super admin status:', error);
    return false;
  }
}
