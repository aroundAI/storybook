import type { NextRequest } from 'next/server';
import { NextResponse, URLPattern } from 'next/server';

import { CsrfError, createCsrfProtect } from '@edge-csrf/nextjs';

import { isSuperAdmin } from '@kit/admin';
import { checkRequiresMultiFactorAuthentication } from '@kit/supabase/check-requires-mfa';
import { createMiddlewareClient } from '@kit/supabase/middleware-client';

import appConfig from '~/config/app.config';
import pathsConfig from '~/config/paths.config';

const CSRF_SECRET_COOKIE = 'csrfSecret';
const NEXT_ACTION_HEADER = 'next-action';

export const config = {
  matcher: ['/((?!_next/static|_next/image|images|locales|assets|api/).*)'],
};

const getUser = (request: NextRequest, response: NextResponse) => {
  const supabase = createMiddlewareClient(request, response);

  return supabase.auth.getClaims();
};

export async function middleware(request: NextRequest) {
  const secureHeaders = await createResponseWithSecureHeaders();
  const response = NextResponse.next(secureHeaders);

  // set a unique request ID for each request
  // this helps us log and trace requests
  setRequestId(request);

  // apply CSRF protection for mutating requests
  const csrfResponse = await withCsrfMiddleware(request, response);

  // handle patterns for specific routes
  const handlePattern = matchUrlPattern(request.url);

  // if a pattern handler exists, call it
  if (handlePattern) {
    const patternHandlerResponse = await handlePattern(request, csrfResponse);

    // if a pattern handler returns a response, return it
    if (patternHandlerResponse) {
      return patternHandlerResponse;
    }
  }

  // append the action path to the request headers
  // which is useful for knowing the action path in server actions
  if (isServerAction(request)) {
    csrfResponse.headers.set('x-action-path', request.nextUrl.pathname);
  }

  // in all other cases, return the response
  return csrfResponse;
}

async function withCsrfMiddleware(
  request: NextRequest,
  response: NextResponse,
) {
  // set up CSRF protection
  const csrfProtect = createCsrfProtect({
    cookie: {
      secure: appConfig.production,
      name: CSRF_SECRET_COOKIE,
    },
    // ignore CSRF errors for server actions since protection is built-in
    ignoreMethods: isServerAction(request)
      ? ['POST']
      : // always ignore GET, HEAD, and OPTIONS requests
        ['GET', 'HEAD', 'OPTIONS'],
  });

  try {
    await csrfProtect(request, response);

    return response;
  } catch (error) {
    // if there is a CSRF error, return a 403 response
    if (error instanceof CsrfError) {
      return NextResponse.json('Invalid CSRF token', {
        status: 401,
      });
    }

    throw error;
  }
}

function isServerAction(request: NextRequest) {
  const headers = new Headers(request.headers);

  return headers.has(NEXT_ACTION_HEADER);
}

async function adminMiddleware(request: NextRequest, response: NextResponse) {
  const isAdminPath = request.nextUrl.pathname.startsWith('/admin');

  if (!isAdminPath) {
    return;
  }

  const { data, error } = await getUser(request, response);

  // If user is not logged in, redirect to sign in page.
  // This should never happen, but just in case.
  if (!data?.claims || error) {
    return NextResponse.redirect(
      new URL(pathsConfig.auth.signIn, request.nextUrl.origin).href,
    );
  }

  const client = createMiddlewareClient(request, response);
  const userIsSuperAdmin = await isSuperAdmin(client);

  // If user is not an admin, redirect to 404 page.
  if (!userIsSuperAdmin) {
    return NextResponse.redirect(new URL('/404', request.nextUrl.origin).href);
  }

  // in all other cases, return the response
  return response;
}

// ============================================
// Rate Limiting for Public Routes
// ============================================
const publicRouteRateLimits = new Map<
  string,
  { count: number; resetTime: number }
>();

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 60; // 60 requests per minute per IP

function getRateLimitKey(request: NextRequest): string {
  // Use x-forwarded-for for proxied requests, fallback to IP
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() || 'unknown';
  return `public:${ip}`;
}

function checkRateLimit(request: NextRequest): {
  allowed: boolean;
  remaining: number;
  resetIn: number;
} {
  const key = getRateLimitKey(request);
  const now = Date.now();

  const entry = publicRouteRateLimits.get(key);

  if (!entry || now > entry.resetTime) {
    // New window
    publicRouteRateLimits.set(key, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW_MS,
    });
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - 1,
      resetIn: RATE_LIMIT_WINDOW_MS,
    };
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetIn: entry.resetTime - now };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - entry.count,
    resetIn: entry.resetTime - now,
  };
}

// Clean up old entries periodically (every 5 minutes)
if (typeof setInterval !== 'undefined') {
  setInterval(
    () => {
      const now = Date.now();
      for (const [key, entry] of publicRouteRateLimits.entries()) {
        if (now > entry.resetTime + RATE_LIMIT_WINDOW_MS) {
          publicRouteRateLimits.delete(key);
        }
      }
    },
    5 * 60 * 1000,
  );
}

async function publicRouteMiddleware(
  request: NextRequest,
  response: NextResponse,
) {
  const { allowed, remaining, resetIn } = checkRateLimit(request);

  // Set rate limit headers
  response.headers.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX_REQUESTS));
  response.headers.set('X-RateLimit-Remaining', String(remaining));
  response.headers.set('X-RateLimit-Reset', String(Math.ceil(resetIn / 1000)));

  if (!allowed) {
    return new NextResponse(
      JSON.stringify({ error: 'Too many requests. Please try again later.' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil(resetIn / 1000)),
          'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(resetIn / 1000)),
        },
      },
    );
  }

  // Allow the request to continue
  return response;
}

/**
 * Define URL patterns and their corresponding handlers.
 */
function getPatterns() {
  return [
    {
      pattern: new URLPattern({ pathname: '/@*' }),
      handler: publicRouteMiddleware,
    },
    {
      pattern: new URLPattern({ pathname: '/admin/*?' }),
      handler: adminMiddleware,
    },
    {
      pattern: new URLPattern({ pathname: '/auth/*?' }),
      handler: async (req: NextRequest, res: NextResponse) => {
        const { data } = await getUser(req, res);

        // the user is logged out, so we don't need to do anything
        if (!data?.claims) {
          return;
        }

        // check if we need to verify MFA (user is authenticated but needs to verify MFA)
        const isVerifyMfa = req.nextUrl.pathname === pathsConfig.auth.verifyMfa;

        // If user is logged in and does not need to verify MFA,
        // redirect to home page.
        if (!isVerifyMfa) {
          const nextPath =
            req.nextUrl.searchParams.get('next') ?? pathsConfig.app.home;

          return NextResponse.redirect(
            new URL(nextPath, req.nextUrl.origin).href,
          );
        }
      },
    },
    {
      pattern: new URLPattern({ pathname: '/home/*?' }),
      handler: async (req: NextRequest, res: NextResponse) => {
        const { data } = await getUser(req, res);

        const origin = req.nextUrl.origin;
        const next = req.nextUrl.pathname;

        // If user is not logged in, redirect to sign in page.
        if (!data?.claims) {
          const signIn = pathsConfig.auth.signIn;
          const redirectPath = `${signIn}?next=${next}`;

          return NextResponse.redirect(new URL(redirectPath, origin).href);
        }

        const supabase = createMiddlewareClient(req, res);

        const requiresMultiFactorAuthentication =
          await checkRequiresMultiFactorAuthentication(supabase);

        // If user requires multi-factor authentication, redirect to MFA page.
        if (requiresMultiFactorAuthentication) {
          return NextResponse.redirect(
            new URL(pathsConfig.auth.verifyMfa, origin).href,
          );
        }
      },
    },
  ];
}

const patterns = getPatterns();

/**
 * Match URL patterns to specific handlers.
 * @param url
 */
function matchUrlPattern(url: string) {
  const input = url.split('?')[0];

  for (const pattern of patterns) {
    const patternResult = pattern.pattern.exec(input);

    if (patternResult !== null && 'pathname' in patternResult) {
      return pattern.handler;
    }
  }
}

/**
 * Set a unique request ID for each request.
 * @param request
 */
function setRequestId(request: Request) {
  request.headers.set('x-correlation-id', crypto.randomUUID());
}

/**
 * @name createResponseWithSecureHeaders
 * @description Create a middleware with enhanced headers applied (if applied).
 * This is disabled by default. To enable set ENABLE_STRICT_CSP=true
 */
async function createResponseWithSecureHeaders() {
  const enableStrictCsp = process.env.ENABLE_STRICT_CSP ?? 'false';

  // we disable ENABLE_STRICT_CSP by default
  if (enableStrictCsp === 'false') {
    return {};
  }

  const { createCspResponse } = await import('./lib/create-csp-response');

  return createCspResponse();
}
