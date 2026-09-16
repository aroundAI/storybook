# @kit/supabase

Comprehensive Supabase integration package providing database clients, authentication utilities, and type-safe database operations with Row Level Security (RLS).

## Purpose

This package provides the core Supabase integration for the application, including:
- Server and client-side database clients
- Authentication helpers and MFA support
- Type-safe database operations
- Row Level Security (RLS) utilities
- Admin client for privileged operations
- Storage utilities

## Installation

```bash
pnpm add @kit/supabase
```

## Core Clients

### Server Client (Preferred for Server Components)

```typescript
import { getSupabaseServerClient } from '@kit/supabase/server-client';

async function NotesPage() {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('notes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return <NotesList notes={data} />;
}
```

### Client Hook (For Client Components)

```typescript
'use client';
import { useSupabase } from '@kit/supabase/hooks/use-supabase';

function InteractiveComponent() {
  const supabase = useSupabase();

  const handleAction = async () => {
    const { data, error } = await supabase
      .from('table')
      .insert({ /* data */ });
  };

  return <button onClick={handleAction}>Action</button>;
}
```

### Admin Client (Use with Extreme Caution ⚠️)

```typescript
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

// ⚠️ CRITICAL: Admin client bypasses ALL Row Level Security
// Always manually verify permissions before using
async function adminOperation(userId: string) {
  const adminClient = getSupabaseServerAdminClient();

  // MUST validate permissions manually
  const currentUser = await getCurrentUser();
  if (!await isSuperAdmin(currentUser)) {
    throw new Error('Unauthorized: Admin access required');
  }

  // Now safe to use admin privileges
  const { data } = await adminClient
    .from('accounts')
    .select('*')
    .eq('id', userId);

  return data;
}
```

## Authentication Utilities

### Require User

```typescript
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

export default async function ProtectedPage() {
  const client = getSupabaseServerClient();

  // Throws if user not authenticated
  const user = await requireUser(client, {
    verifyMfa: true // Optionally require MFA verification
  });

  return <div>Welcome {user.email}</div>;
}
```

### Multi-Factor Authentication

```typescript
import { checkRequiresMultiFactorAuthentication } from '@kit/supabase/check-requires-mfa';

const requiresMFA = await checkRequiresMultiFactorAuthentication(client);

if (requiresMFA) {
  redirect('/auth/verify');
}
```

### MFA Verification Status

```typescript
import { shouldVerifyMFA } from '@kit/supabase/should-verify-mfa';

const needsVerification = await shouldVerifyMFA(client);
```

## Authentication Hooks

### Sign In/Sign Up

```typescript
import { useSignInWithEmailPassword } from '@kit/supabase/hooks/use-sign-in-with-email-password';
import { useSignUpWithEmailAndPassword } from '@kit/supabase/hooks/use-sign-up-with-email-password';
import { useSignInWithProvider } from '@kit/supabase/hooks/use-sign-in-with-provider';
import { useSignInWithOtp } from '@kit/supabase/hooks/use-sign-in-with-otp';

// Email/Password sign in
const signIn = useSignInWithEmailPassword();
await signIn.mutateAsync({ email, password });

// Sign up
const signUp = useSignUpWithEmailAndPassword();
await signUp.mutateAsync({ email, password });

// OAuth provider
const signInWithProvider = useSignInWithProvider();
await signInWithProvider.mutateAsync({ provider: 'google' });

// OTP sign in
const signInWithOtp = useSignInWithOtp();
await signInWithOtp.mutateAsync({ email });
```

### User Management

```typescript
import { useUser } from '@kit/supabase/hooks/use-user';
import { useUpdateUser } from '@kit/supabase/hooks/use-update-user';
import { useSignOut } from '@kit/supabase/hooks/use-sign-out';

// Get current user
const { data: user } = useUser();

// Update user
const updateUser = useUpdateUser();
await updateUser.mutateAsync({
  email: 'new@example.com',
  data: { display_name: 'New Name' }
});

// Sign out
const signOut = useSignOut();
await signOut.mutateAsync();
```

### Identity Management

```typescript
import { useUserIdentities } from '@kit/supabase/hooks/use-user-identities';
import { useLinkIdentityWithProvider } from '@kit/supabase/hooks/use-link-identity-with-provider';
import { useUnlinkIdentity } from '@kit/supabase/hooks/use-unlink-identity';

// Get user identities
const { data: identities } = useUserIdentities(userId);

// Link new provider
const linkProvider = useLinkIdentityWithProvider();
await linkProvider.mutateAsync({ provider: 'github' });

// Unlink provider
const unlinkIdentity = useUnlinkIdentity();
await unlinkIdentity.mutateAsync({ identityId });
```

## Database Types

```typescript
import { Database, Tables, Enums } from '@kit/supabase/database';

// Use generated types for type safety
type Account = Tables<'accounts'>;
type Subscription = Tables<'subscriptions'>;
type UserRole = Enums<'account_role'>;

// Example usage
const account: Account = {
  id: '123',
  name: 'My Team',
  slug: 'my-team',
  // ... other fields
};
```

## Row Level Security Helpers

### Common RLS Functions

The database includes pre-built RLS helper functions:

```sql
-- Check team membership
public.has_role_on_account(account_id, role?)

-- Check specific permissions
public.has_permission(user_id, account_id, permission)

-- Verify account ownership
public.is_account_owner(account_id)

-- Check subscription status
public.has_active_subscription(account_id)

-- Verify team membership
public.is_team_member(account_id, user_id)

-- Check if user can modify team member
public.can_action_account_member(target_account_id, target_user_id)

-- Administrative checks
public.is_super_admin()
public.is_aal2() -- MFA verification
public.is_mfa_compliant()
```

### Using RLS in Policies

```sql
-- Example: Allow read access to team members
CREATE POLICY "team_documents_read" ON documents
  FOR SELECT TO authenticated
  USING (
    account_id = auth.uid() OR
    public.has_role_on_account(account_id)
  );

-- Example: Require specific permission for write
CREATE POLICY "team_documents_write" ON documents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission(
      auth.uid(),
      account_id,
      'documents.write'::app_permissions
    )
  );
```

## Account Management

### Create Account

```typescript
import { createAccount } from '@kit/supabase/mutations/create-account';

const account = await createAccount(client, {
  name: 'New Team',
  slug: 'new-team', // Optional, auto-generated if not provided
});
```

### Check Subscription Status

```typescript
import { checkSubscriptionStatus } from '@kit/supabase/check-subscription-status';

const hasActiveSubscription = await checkSubscriptionStatus(
  client,
  accountId
);

if (!hasActiveSubscription) {
  redirect('/billing/upgrade');
}
```

## Storage Operations

### Upload Files

```typescript
const { data, error } = await client.storage
  .from('account_image')
  .upload(`${accountId}/${fileName}`, file, {
    contentType: file.type,
    upsert: true,
  });
```

### Storage Security

Storage paths must include account_id for proper RLS:

```sql
-- Storage RLS policy example
create policy account_files on storage.objects
  using (
    bucket_id = 'account_files' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );
```

## Common Patterns

### Data Fetching in Server Components

```typescript
import { getSupabaseServerClient } from '@kit/supabase/server-client';

export default async function DataPage() {
  const client = getSupabaseServerClient();

  // Fetch with joins
  const { data: posts } = await client
    .from('posts')
    .select(`
      *,
      author:profiles(*),
      comments(
        *,
        user:profiles(*)
      )
    `)
    .order('created_at', { ascending: false });

  return <PostList posts={posts} />;
}
```

### Realtime Subscriptions

```typescript
'use client';
import { useSupabase } from '@kit/supabase/hooks/use-supabase';
import { useEffect } from 'react';

function RealtimeComponent() {
  const supabase = useSupabase();

  useEffect(() => {
    const channel = supabase
      .channel('posts')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'posts'
      }, (payload) => {
        console.log('Change received:', payload);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  return <div>Listening for changes...</div>;
}
```

### Transactions

```typescript
const { data, error } = await client.rpc('transfer_credits', {
  from_account: sourceId,
  to_account: targetId,
  amount: 100
});

if (error) {
  throw error;
}
```

## Error Handling

```typescript
import { getLogger } from '@kit/shared/logger';

async function databaseOperation() {
  const logger = await getLogger();
  const ctx = { operation: 'fetch-notes', userId: user.id };

  try {
    logger.info(ctx, 'Fetching notes');

    const { data, error } = await client
      .from('notes')
      .select('*');

    if (error) {
      logger.error({ ...ctx, error }, 'Database query failed');
      throw error;
    }

    return data;
  } catch (error) {
    logger.error({ ...ctx, error }, 'Operation failed');
    throw error;
  }
}
```

## Security Best Practices ⚠️

### 1. Always Enable RLS

```sql
-- Enable RLS on all tables
ALTER TABLE public.your_table ENABLE ROW LEVEL SECURITY;
```

### 2. Avoid SECURITY DEFINER Without Checks

```sql
-- ❌ DANGEROUS - Bypasses all RLS
CREATE FUNCTION dangerous_function()
  SECURITY DEFINER AS $$
  BEGIN
    DELETE FROM sensitive_table;
  END;
$$;

-- ✅ SAFE - Validates permissions first
CREATE FUNCTION safe_function(target_id uuid)
  SECURITY DEFINER AS $$
  BEGIN
    IF NOT public.is_account_owner(target_id) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
    -- Safe to proceed
  END;
$$;
```

### 3. Use Admin Client Sparingly

```typescript
// ⚠️ Admin client bypasses ALL security
// Always validate permissions manually
const adminClient = getSupabaseServerAdminClient();

// ✅ Proper validation before admin operations
if (!await canPerformAdminAction(user)) {
  throw new Error('Unauthorized');
}
```

## Migration Workflow

### Creating Database Changes

1. **Edit schema file**: `apps/web/supabase/schemas/XX-feature.sql`
> ⛔ **`db diff` does not work in this repo.** The database is built from
> `apps/web/supabase/migrations/`, and `schemas/` is missing 33 of the 99
> tables — a diff against it would propose dropping them. Write migrations by
> hand; see the root `CLAUDE.md`.

2. **Write the migration by hand** in `apps/web/supabase/migrations/` (see the warning above)
3. **Apply migration**: `pnpm --filter web supabase migration up`
4. **Generate types**: `pnpm supabase:web:typegen`

### Reset Database (Development)

```bash
# Reset to latest schema (clean rebuild)
pnpm supabase:web:reset

# Regenerate types
pnpm supabase:web:typegen
```

## Testing

```typescript
import { createClient } from '@supabase/supabase-js';

// Create test client
const testClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Test with authenticated user
const { data: { session } } = await testClient.auth.signInWithPassword({
  email: 'test@example.com',
  password: 'password',
});

// Now test operations
const { data, error } = await testClient
  .from('table')
  .select('*');
```

## Environment Variables

```bash
# Required environment variables
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key # Admin operations only
```

## Troubleshooting

### Common Issues

1. **"relation does not exist" error**
   - Schema file edited but migration not generated
   - Write the migration by hand in `apps/web/supabase/migrations/`

2. **Type errors after schema changes**
   - Types not regenerated after migration
   - Run: `pnpm supabase:web:typegen`

3. **RLS blocking legitimate access**
   - Check RLS policies with: `SELECT * FROM pg_policies WHERE tablename = 'your_table';`
   - Verify helper functions return expected results

4. **Admin client not working**
   - Missing `SUPABASE_SERVICE_ROLE_KEY` environment variable
   - Check `.env.local` for proper configuration

## Package Dependencies

### External
- `@supabase/supabase-js`: Core Supabase client
- `@supabase/ssr`: Server-side rendering utilities

### Internal
- `@kit/shared`: Shared utilities and logger

### Packages that use this:
- [web](../../apps/web)
- [@kit/billing](../billing/core)
- [@kit/billing-gateway](../billing/gateway)
- [@kit/lemon-squeezy](../billing/lemon-squeezy)
- [@kit/stripe](../billing/stripe)
- [@kit/database-webhooks](../database-webhooks)
- [@kit/accounts](../features/accounts)
- [@kit/admin](../features/admin)
- [@kit/auth](../features/auth)
- [@kit/notifications](../features/notifications)
- [@kit/team-accounts](../features/team-accounts)
- [@kit/next](../next)
- [@kit/otp](../otp)

## Contributing

When making changes to this package:

1. Always enable RLS on new tables
2. Use existing helper functions for RLS policies
3. Never use SECURITY DEFINER without permission checks
4. Test with both authenticated and anonymous users
5. Run `pnpm typecheck` before committing

---

*Updated on 9/20/2025*