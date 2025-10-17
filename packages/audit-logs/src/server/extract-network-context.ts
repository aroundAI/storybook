import 'server-only';

import { headers } from 'next/headers';

/**
 * Network context for audit logging
 */
export interface NetworkContext {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Extract network context from Next.js request headers
 *
 * This function extracts:
 * - IP address from x-forwarded-for, x-real-ip, or x-client-ip headers
 * - User agent from user-agent header
 *
 * @returns Network context object with IP and user agent
 *
 * @example
 * ```typescript
 * const networkContext = await extractNetworkContext();
 * await createAuditLog({
 *   ...params,
 *   ...networkContext,
 * });
 * ```
 */
export async function extractNetworkContext(): Promise<NetworkContext> {
  try {
    const headersList = await headers();

    // Extract IP address
    // Priority: x-forwarded-for > x-real-ip > x-client-ip
    let ipAddress: string | undefined;

    const forwardedFor = headersList.get('x-forwarded-for');
    if (forwardedFor) {
      // x-forwarded-for can be a comma-separated list, take the first one
      ipAddress = forwardedFor.split(',')[0]?.trim();
    }

    if (!ipAddress) {
      ipAddress =
        headersList.get('x-real-ip') ||
        headersList.get('x-client-ip') ||
        undefined;
    }

    // Extract user agent
    const userAgent = headersList.get('user-agent') || undefined;

    return {
      ipAddress,
      userAgent,
    };
  } catch {
    // If headers are not available (e.g., in middleware or edge runtime),
    // return empty context
    return {};
  }
}

/**
 * Format IP address for PostgreSQL inet type
 *
 * @param ip - IP address string
 * @returns Formatted IP or undefined if invalid
 */
export function formatIpAddress(ip: string | undefined): string | undefined {
  if (!ip) return undefined;

  // Remove any port number if present
  const parts = ip.split(':');
  const ipWithoutPort = parts[0] ?? ip;

  // Basic validation (IPv4 or IPv6)
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Pattern = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

  if (ipv4Pattern.test(ipWithoutPort) || ipv6Pattern.test(ipWithoutPort)) {
    return ipWithoutPort;
  }

  return undefined;
}
