---
description: Security guidelines for writing secure code
globs: 
alwaysApply: false
---
# Next.js-Specific Security

### Client Component Data Passing

- **Never pass sensitive data** to Client Components
- **Never pass unsanitized data** to Client Components (raw cookies, client-provided data)

### Server Components Security

- **Always sanitize user input** before using in Server Components
- **Validate cookies and headers** in Server Components

### Environment Variables

- **Use `import 'server-only'`** for code that should only be run on the server side
- **Never expose server-only env vars** to the client
- **Never pass environment variables as props to client components** unless they're suffixed with `NEXT_PUBLIC_`
- **Never use `NEXT_PUBLIC_` prefix** for sensitive data (ex. API keys, secrets)
- **Use `NEXT_PUBLIC_` prefix** only for client-safe variables

### Client Hydration Protection

- **Never expose sensitive data** in initial HTML

## Authentication & Authorization

### Row Level Security (RLS)

- **Always enable RLS** on all tables unless explicitly specified otherwise [database.mdc](mdc:.cursor/rules/database.mdc)

### Super Admin Protected Routes
Always perform extra checks when writing Super Admin code [super-admin.mdc](mdc:.cursor/rules/super-admin.mdc)

## Server Actions & API Routes

### Server Actions

- Always use `enhanceAction` wrapper for consistent security [server-actions.mdc](mdc:.cursor/rules/server-actions.mdc)
- Always use 'use server' directive at the top of the file to safely bundle server-side code
- Validate input with Zod schemas
- Implement authentication checks:

```typescript
'use server';

import { enhanceAction } from '@kit/next/actions';
import { MyActionSchema } from '../schema';

export const secureAction = enhanceAction(
  async function(data, user) {
    // Additional permission checks
    const hasPermission = await checkUserPermission(user.id, data.accountId, 'action.perform');
    if (!hasPermission) throw new Error('Insufficient permissions');

    // Validated data available
    return processAction(data);
  },
  {
    auth: true,
    schema: MyActionSchema
  }
);
```

### API Routes

- Use `enhanceRouteHandler` for consistent security [route-handlers.mdc](mdc:.cursor/rules/route-handlers.mdc)
- Implement authentication and authorization checks:

```typescript
import { enhanceRouteHandler } from '@kit/next/routes';
import { RouteSchema } from '../schema';

export const POST = enhanceRouteHandler(
  async function({ body, user, request }) {
    // Additional authorization checks
    const canAccess = await canAccessResource(user.id, body.resourceId);

    if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Safe to process with validated body
    return NextResponse.json({ success: true });
  },
  {
    auth: true,
    schema: RouteSchema
  }
);
```

## Client Components Security

### Context Awareness

- Use appropriate workspace contexts for access control:
  - `useUserWorkspace()` in personal account pages
  - `useTeamAccountWorkspace()` in team account pages
- Check permissions before rendering sensitive UI elements:

```typescript
function SecureComponent() {
  const { account, user } = useTeamAccountWorkspace();
  const canEdit = account.permissions.includes('entity.update');

  if (!canEdit) return null;

  return <EditComponent />;
}
```

### Data Fetching

- Use React Query with proper error handling
- Never trust client-side permission checks alone

## One-Time Tokens

Consider using OTP tokens when implementing highly destructive operations like deleting an entity that would otherwise require a full backup: [otp.mdc](mdc:.cursor/rules/otp.mdc)

## Critical Data Protection

### Personal Information

- Never log or expose sensitive user data (api keys, passwords, secrets, etc.)
- Use proper session management

## Error Handling

- Never expose internal errors to clients
- Log errors securely with appropriate context
- Return generic error messages to users

```typescript
try {
  await sensitiveOperation();
} catch (error) {
  logger.error({ error, context }, 'Operation failed');
  return { error: 'Unable to complete operation' };
}
```

## Database Security

- Avoid dynamic SQL generation
- Use SECURITY DEFINER functions sparingly and carefully, warn user if you do so
- Implement proper foreign key constraints
- Use appropriate data types with constraints