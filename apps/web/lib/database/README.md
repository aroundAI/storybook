# Database Authorization Middleware

Application-level Row Level Security (RLS) for non-Supabase database providers.

## Overview

When using **Supabase**, RLS policies enforce data access at the database level automatically.

When using **PostgreSQL** or **MySQL** (without Supabase), this middleware provides equivalent authorization checks at the application level.

## Why This Exists

Supabase provides powerful Row Level Security (RLS) that enforces data access rules at the database:

```sql
-- Example Supabase RLS policy
CREATE POLICY "notes_read" ON public.notes FOR SELECT
  TO authenticated USING (
    account_id = auth.uid() OR
    public.has_role_on_account(account_id)
  );
```

When migrating to raw PostgreSQL/MySQL, these policies don't exist. This middleware **replicates that behavior** at the application level.

## Architecture

```
┌─────────────────────────────────────────┐
│   Application Code                      │
│   (Server Components, Actions)          │
└────────────┬────────────────────────────┘
             │
             ▼
     ┌────────────────┐
     │ Authorization  │ ◄── YOU ARE HERE
     │ Middleware     │
     └────────────┬───┘
                  │
                  ▼
     ┌────────────────────────┐
     │ Database Provider      │
     │ (PostgreSQL, MySQL)    │
     └────────────────────────┘
```

**When using Supabase**: Middleware is a no-op, RLS handles everything
**When using PostgreSQL/MySQL**: Middleware enforces authorization

## Usage

### Basic Pattern

```typescript
import { enforceRowLevelSecurity } from '@/lib/database/authorization';

async function getUserNotes(userId: string, accountId: string) {
  // 1. Enforce authorization BEFORE querying
  await enforceRowLevelSecurity({
    userId,
    accountId,
    table: 'notes',
    operation: 'read',
  });

  // 2. Now safe to query - user has been authorized
  const notes = await db
    .from('notes')
    .select('*')
    .where('account_id', accountId);

  return notes;
}
```

### Server Actions Example

```typescript
import { enforceRowLevelSecurity } from '@/lib/database/authorization';

import { enhanceAction } from '@kit/next/actions';

export const deleteNoteAction = enhanceAction(
  async (data, user) => {
    // Validate user is authorized to delete from this account
    await enforceRowLevelSecurity({
      userId: user.id,
      accountId: data.accountId,
      table: 'notes',
      operation: 'delete',
    });

    // Authorization passed - safe to delete
    await db.from('notes').delete().where('id', data.noteId);

    return { success: true };
  },
  {
    auth: true,
    schema: DeleteNoteSchema,
  },
);
```

### Server Component Example

```typescript
import { enforceRowLevelSecurity } from '@/lib/database/authorization';
import { requireUser } from '@kit/supabase/require-user';

async function NotesPage({ params }: { params: { account: string } }) {
  const user = await requireUser();

  // Verify user can access this account's data
  await enforceRowLevelSecurity({
    userId: user.id,
    accountId: params.account,
    table: 'notes',
    operation: 'read',
  });

  // Fetch notes - authorization already verified
  const notes = await db
    .from('notes')
    .select('*')
    .where('account_id', params.account);

  return <NotesList notes={notes} />;
}
```

## Authorization Rules

### Personal Accounts

Users can access their own data when `accountId === userId`:

```typescript
await enforceRowLevelSecurity({
  userId: 'user-123',
  accountId: 'user-123', // Same as userId
  table: 'notes',
  operation: 'read',
});
// ✅ Allowed - personal account access
```

### Team Accounts

Access controlled by team membership and roles:

| Role     | Read | Write | Delete | Manage |
| -------- | ---- | ----- | ------ | ------ |
| owner    | ✅   | ✅    | ✅     | ✅     |
| admin    | ✅   | ✅    | ✅     | ❌     |
| member   | ✅   | ✅    | ❌     | ❌     |
| readonly | ✅   | ❌    | ❌     | ❌     |

### Operations

- **read**: All team members can read
- **write**: Members, admins, and owners can write
- **delete**: Only admins and owners can delete
- **manage**: Only owners can manage (settings, billing, etc.)

## Permission Checking

For fine-grained permissions:

```typescript
import { hasPermission } from '@/lib/database/authorization';

async function updateAccountSettings(userId: string, accountId: string) {
  // Check specific permission
  const canManageSettings = await hasPermission(
    userId,
    accountId,
    'settings.manage',
  );

  if (!canManageSettings) {
    throw new Error('Access denied: settings.manage permission required');
  }

  // Proceed with settings update
}
```

### Built-in Permissions

| Permission        | Required Role        | Description                      |
| ----------------- | -------------------- | -------------------------------- |
| `settings.manage` | owner, admin         | Manage account settings          |
| `members.manage`  | owner, admin         | Add/remove team members          |
| `billing.manage`  | owner                | Manage billing and subscriptions |
| `notes.manage`    | owner, admin, member | Create/update notes              |

Extend `permissionMap` in `authorization.ts` to add custom permissions.

## Migration from Supabase

### Before (Supabase RLS)

```typescript
// No authorization code needed - RLS handles it automatically
const { data } = await client.from('notes').select('*');
```

### After (PostgreSQL/MySQL)

```typescript
// Add authorization check before query
await enforceRowLevelSecurity({
  userId: user.id,
  accountId: accountId,
  table: 'notes',
  operation: 'read',
});

const { data } = await client.from('notes').select('*');
```

## Environment Configuration

The middleware automatically detects your database provider:

```bash
# Supabase - RLS enforced at database level
DATABASE_PROVIDER=supabase

# PostgreSQL/MySQL - Middleware enforced
DATABASE_PROVIDER=postgresql
DATABASE_PROVIDER=mysql
```

## Error Handling

The middleware throws descriptive errors when authorization fails:

```typescript
try {
  await enforceRowLevelSecurity({
    userId: 'user-123',
    accountId: 'account-456',
    table: 'notes',
    operation: 'delete',
  });
} catch (error) {
  // Error: Access denied: Insufficient permissions for delete operation
  console.error(error.message);
}
```

## Best Practices

### 1. Always Check Before Queries

```typescript
// ❌ BAD - No authorization check
async function getNotes(accountId: string) {
  return await db.from('notes').select('*').where('account_id', accountId);
}

// ✅ GOOD - Authorization enforced
async function getNotes(userId: string, accountId: string) {
  await enforceRowLevelSecurity({
    userId,
    accountId,
    table: 'notes',
    operation: 'read',
  });

  return await db.from('notes').select('*').where('account_id', accountId);
}
```

### 2. Use Correct Operations

```typescript
// ✅ Read operation for SELECT queries
await enforceRowLevelSecurity({ operation: 'read' });

// ✅ Write operation for INSERT/UPDATE
await enforceRowLevelSecurity({ operation: 'write' });

// ✅ Delete operation for DELETE queries
await enforceRowLevelSecurity({ operation: 'delete' });

// ✅ Manage operation for account-level changes
await enforceRowLevelSecurity({ operation: 'manage' });
```

### 3. Handle Errors Gracefully

```typescript
async function deleteNote(userId: string, accountId: string, noteId: string) {
  try {
    await enforceRowLevelSecurity({
      userId,
      accountId,
      table: 'notes',
      operation: 'delete',
    });

    await db.from('notes').delete().where('id', noteId);

    return { success: true };
  } catch (error) {
    if (error.message.includes('Access denied')) {
      return { success: false, error: 'Insufficient permissions' };
    }

    throw error; // Re-throw unexpected errors
  }
}
```

## Testing

Run tests with:

```bash
pnpm --filter web test authorization.test.ts
```

See `authorization.test.ts` for comprehensive test examples.

## Implementation Notes

### Database Queries

The middleware uses Supabase client to query `accounts_memberships` and `accounts` tables. This works across all database providers since it uses the Supabase client as an abstraction layer.

### Performance

- **Supabase**: Zero overhead - RLS is at database level
- **PostgreSQL/MySQL**: One additional query per authorization check
  - Consider caching user roles/permissions in production
  - Use Redis or in-memory cache for high-traffic applications

### Future Enhancements

Potential improvements for production use:

1. **Permission Caching**: Cache role lookups in Redis (TTL: 5 minutes)
2. **Custom Permissions Table**: Store fine-grained permissions in database
3. **Audit Logging**: Log all authorization decisions for compliance
4. **Rate Limiting**: Prevent authorization check abuse

## Related Files

- `authorization.ts` - Core authorization logic
- `authorization.test.ts` - Unit tests
- `apps/web/supabase/schemas/05-roles.sql` - Role definitions
- `apps/web/supabase/schemas/06-public-api.sql` - Supabase RLS functions

## Support

For issues or questions:

1. Check Supabase RLS policies in `apps/web/supabase/schemas/`
2. Review authorization tests for usage examples
3. See `DEPLOYMENT.md` for migration guides
4. Open an issue in the repository

---

_Last updated: January 2025_
