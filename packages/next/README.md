# @kit/next

Next.js utilities package providing enhanced server actions, route handlers, middleware, and other Next.js-specific helpers for building robust SaaS applications.

## Purpose

This package provides essential Next.js enhancements including:
- Type-safe server actions with automatic validation
- Enhanced route handlers with built-in auth and validation
- Middleware utilities for authentication and authorization
- Error handling and logging utilities
- Redirect and revalidation helpers
- Internationalization utilities

## Installation

```bash
pnpm add @kit/next
```

## Server Actions

### Enhanced Server Actions with `enhanceAction`

Always use `enhanceAction` for creating server actions with automatic validation and authentication:

```typescript
'use server';

import { enhanceAction } from '@kit/next/actions';
import { z } from 'zod';

// Define your validation schema
const CreateNoteSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  content: z.string().min(1, 'Content is required'),
  accountId: z.string().uuid('Invalid account ID'),
});

// Create enhanced server action
export const createNoteAction = enhanceAction(
  async function (data, user) {
    // data is automatically validated against the schema
    // user is automatically authenticated if auth: true

    const client = getSupabaseServerClient();

    const { data: note, error } = await client
      .from('notes')
      .insert({
        title: data.title,
        content: data.content,
        account_id: data.accountId,
        user_id: user.id,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Revalidate the notes page
    revalidatePath('/notes');

    return { success: true, note };
  },
  {
    auth: true, // Require authentication
    schema: CreateNoteSchema, // Validate input with Zod
  },
);
```

### Server Action Options

```typescript
export const myAction = enhanceAction(
  async function (data, user) {
    // Handler function
    // data: validated input (if schema provided)
    // user: authenticated user (if auth: true)

    return { success: true, result: data };
  },
  {
    // Options
    auth: true, // Require authentication (default: false)
    schema: MySchema, // Zod schema for validation (optional)
  },
);
```

### Using Server Actions in Client Components

```tsx
'use client';

import { useTransition } from 'react';
import { toast } from '@kit/ui/sonner';
import { createNoteAction } from './actions';
import { isRedirectError } from 'next/dist/client/components/redirect-error';

function CreateNoteForm() {
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (formData: FormData) => {
    startTransition(async () => {
      try {
        const result = await createNoteAction({
          title: formData.get('title') as string,
          content: formData.get('content') as string,
        });

        toast.success('Note created successfully!');
      } catch (error) {
        // Handle redirects gracefully
        if (!isRedirectError(error)) {
          toast.error('Failed to create note');
        }
      }
    });
  };

  return (
    <form action={handleSubmit}>
      <input name="title" required />
      <textarea name="content" required />
      <button disabled={isPending}>
        {isPending ? 'Creating...' : 'Create Note'}
      </button>
    </form>
  );
}
```

## Route Handlers (API Routes)

### Enhanced Route Handlers with `enhanceRouteHandler`

Use `enhanceRouteHandler` for creating API routes with automatic validation and authentication:

```typescript
import { enhanceRouteHandler } from '@kit/next/routes';
import { NextResponse } from 'next/server';
import { z } from 'zod';

// Define validation schema
const CreateItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

// POST handler with validation and auth
export const POST = enhanceRouteHandler(
  async function ({ body, user, request }) {
    // body is validated against schema
    // user is available if auth: true
    // request is the original NextRequest

    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('items')
      .insert({
        name: body.name,
        description: body.description,
        user_id: user.id,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: 'Failed to create item' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  },
  {
    auth: true, // Require authentication
    schema: CreateItemSchema, // Validate request body
  },
);

// GET handler without body validation
export const GET = enhanceRouteHandler(
  async function ({ user, request }) {
    const url = new URL(request.url);
    const limit = url.searchParams.get('limit') || '10';

    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('items')
      .select('*')
      .eq('user_id', user.id)
      .limit(parseInt(limit));

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch items' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data });
  },
  {
    auth: true, // Require authentication
  },
);
```

### Route Handler Options

```typescript
export const POST = enhanceRouteHandler(
  async function ({ body, user, request }) {
    // Handler receives:
    // - body: validated request body (if schema provided)
    // - user: authenticated user (if auth: true)
    // - request: original NextRequest

    return NextResponse.json({ success: true });
  },
  {
    auth: true, // Require authentication (default: false)
    schema: MySchema, // Zod schema for body validation (optional)
  },
);
```

## Middleware Utilities

### Authentication Middleware

```typescript
import { createMiddleware } from '@kit/next/middleware';

export const middleware = createMiddleware({
  // Protected routes that require authentication
  protected: ['/dashboard', '/settings', '/api/protected'],

  // Public routes that don't require authentication
  public: ['/auth', '/api/public'],

  // Redirect paths
  redirects: {
    unauthenticated: '/auth/sign-in',
    authenticated: '/dashboard',
  },
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

### Custom Middleware

```typescript
import { withAuth } from '@kit/next/middleware';

export const middleware = withAuth(
  async function middleware(request, user) {
    // user is available if authenticated

    // Custom logic here
    if (request.nextUrl.pathname.startsWith('/admin')) {
      const isAdmin = await checkAdminStatus(user.id);

      if (!isAdmin) {
        return NextResponse.redirect(
          new URL('/unauthorized', request.url)
        );
      }
    }

    return NextResponse.next();
  }
);
```

## Revalidation and Redirects

### Revalidation Patterns

```typescript
import { revalidatePath, revalidateTag } from 'next/cache';
import { redirect } from 'next/navigation';

export const updateSettingsAction = enhanceAction(
  async function (data, user) {
    // Update settings
    await updateUserSettings(user.id, data);

    // Revalidate specific path
    revalidatePath('/settings');

    // Or revalidate by tag
    revalidateTag('user-settings');

    // Redirect after success
    redirect('/settings/success');
  },
  {
    auth: true,
    schema: UpdateSettingsSchema,
  },
);
```

### Handling Redirects in Client Components

```typescript
import { isRedirectError } from 'next/dist/client/components/redirect-error';

async function handleAction() {
  try {
    await serverAction();
  } catch (error) {
    // Don't treat redirects as errors
    if (!isRedirectError(error)) {
      // Handle actual errors
      console.error('Action failed:', error);
      toast.error('Something went wrong');
    }
    // Redirect will happen automatically
  }
}
```

## Internationalization (i18n)

### Page Component with i18n

```typescript
import { withI18n } from '@kit/next/i18n';

function HomePage() {
  return <div>Home Page Content</div>;
}

// Export with i18n support
export default withI18n(HomePage);
```

### Metadata with i18n

```typescript
import { generateMetadata } from '@kit/next/metadata';

export const metadata = generateMetadata({
  title: 'page.title',
  description: 'page.description',
  // Translations will be loaded automatically
});
```

## Error Handling

### Server Action Error Handling

```typescript
import { getLogger } from '@kit/shared/logger';

export const riskyAction = enhanceAction(
  async function (data, user) {
    const logger = await getLogger();
    const ctx = { action: 'risky-action', userId: user.id };

    try {
      logger.info(ctx, 'Starting risky action');

      const result = await performRiskyOperation(data);

      logger.info({ ...ctx, result }, 'Action completed');

      return { success: true, result };
    } catch (error) {
      logger.error({ ...ctx, error }, 'Action failed');

      // Re-throw to let client handle
      throw error;
    }
  },
  {
    auth: true,
    schema: RiskyActionSchema,
  },
);
```

### Route Handler Error Handling

```typescript
export const POST = enhanceRouteHandler(
  async function ({ body, user }) {
    const logger = await getLogger();
    const ctx = { endpoint: 'api-create', userId: user.id };

    try {
      logger.info(ctx, 'Processing request');

      const result = await processRequest(body);

      return NextResponse.json({ success: true, data: result });
    } catch (error) {
      logger.error({ ...ctx, error }, 'Request failed');

      if (error.message.includes('validation')) {
        return NextResponse.json(
          { error: 'Invalid input' },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  },
  {
    auth: true,
    schema: RequestSchema,
  },
);
```

## Security Best Practices

### Input Validation

Always use Zod schemas for input validation:

```typescript
const StrictSchema = z.object({
  email: z.string().email(),
  age: z.number().int().min(18).max(120),
  role: z.enum(['user', 'admin']),
});

export const secureAction = enhanceAction(
  async function (data, user) {
    // data is guaranteed to match schema
    // Additional business logic validation

    if (!await canPerformAction(user, data)) {
      throw new Error('Insufficient permissions');
    }

    return await performSecureOperation(data);
  },
  {
    auth: true,
    schema: StrictSchema,
  },
);
```

### Authorization Checks

```typescript
export const adminAction = enhanceAction(
  async function (data, user) {
    // Check admin status
    const isAdmin = await checkAdminStatus(user.id);

    if (!isAdmin) {
      throw new Error('Admin access required');
    }

    // Check resource ownership
    const ownsResource = await checkResourceOwnership(
      user.id,
      data.resourceId
    );

    if (!ownsResource) {
      throw new Error('You do not own this resource');
    }

    // Proceed with authorized action
    return await performAdminOperation(data);
  },
  {
    auth: true,
    schema: AdminActionSchema,
  },
);
```

## Testing Utilities

### Mock Server Actions

```typescript
import { mockEnhanceAction } from '@kit/next/testing';

describe('Server Actions', () => {
  it('should handle action correctly', async () => {
    const action = mockEnhanceAction(
      async (data) => ({ success: true, data }),
      { schema: TestSchema }
    );

    const result = await action({ test: 'data' });
    expect(result.success).toBe(true);
  });
});
```

## Best Practices

### 1. Schema Organization

Organize schemas for reusability:

```
_lib/
├── schemas/
│   └── note.schema.ts    # Shared schemas
├── server/
│   └── actions.ts        # Server actions using schemas
└── client/
    └── forms.tsx         # Forms using same schemas
```

### 2. Avoid `router.refresh()`

Use server-side revalidation instead:

```typescript
// ❌ Bad - client-side refresh
router.refresh();

// ✅ Good - server-side revalidation
revalidatePath('/notes');
```

### 3. Handle Redirects Properly

```typescript
// ✅ In server action
export const action = enhanceAction(
  async function (data) {
    // Process...
    redirect('/success'); // Server-side redirect
  }
);

// ✅ In client component
try {
  await action();
} catch (error) {
  if (!isRedirectError(error)) {
    // Handle real errors only
  }
}
```

## Environment Variables

```bash
# Optional - for enhanced logging
LOG_LEVEL=info
NODE_ENV=production
```

## Package Dependencies

### External
- `next`: Next.js framework
- `zod`: Schema validation
- `server-only`: Server-only code marker

### Internal
- `@kit/supabase`: Database client
- `@kit/shared`: Shared utilities and logger
- `@kit/auth`: Authentication utilities

### Packages that use this:
- [web](../../apps/web)
- [@kit/accounts](../features/accounts)
- [@kit/admin](../features/admin)
- [@kit/team-accounts](../features/team-accounts)
- [@kit/otp](../otp)

## Contributing

When making changes to this package:

1. Maintain backward compatibility
2. Add tests for new utilities
3. Document new patterns
4. Run `pnpm typecheck` before committing
5. Update examples for new features

---

*Updated on 9/20/2025*