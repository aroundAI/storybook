---
description: Next.js API Endpoints/Route Handlers
globs: apps/**/route.{ts,tsx}
alwaysApply: false
---
# Route Handler / API Routes

- Use Route Handlers when data fetching from Client Components
- To create API routes (route.ts), always use the `enhanceRouteHandler` function from the "@kit/supabase/routes" package. [index.ts](mdc:packages/next/src/routes/index.ts)

```tsx
import { z } from 'zod';
import { enhanceRouteHandler } from '@kit/next/routes';
import { NextResponse } from 'next/server';

const ZodSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const POST = enhanceRouteHandler(
  async function({ body, user, request }) {
    // 1. "body" is already a valid ZodSchema and it's safe to use
    // 2. "user" is the authenticated user
    // 3. "request" is NextRequest
    // ... your code here
    return NextResponse.json({
      success: true,
    });
  },
  {
    schema: ZodSchema,
  },
);

// example of unauthenticated route (careful!)
export const GET = enhanceRouteHandler(
  async function({ user, request }) {
    // 1. "user" is null, as "auth" is false and we don't require authentication
    // 2. "request" is NextRequest
    // ... your code here
    return NextResponse.json({
      success: true,
    });
  },
  {
    auth: false,
  },
);
```