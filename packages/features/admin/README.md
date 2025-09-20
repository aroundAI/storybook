# @kit/admin

Super admin functionality for managing users, accounts, and system-wide operations in the SaaS application.

## Purpose

This package provides administrative features for super admins including:
- User management (create, ban, reactivate, delete)
- Account management and oversight
- User impersonation for support
- System-wide dashboard and metrics
- Password reset capabilities
- Security controls and audit logging

## Installation

```bash
pnpm add @kit/admin
```

## Admin Guard

Protect admin routes with the AdminGuard component:

```typescript
import { AdminGuard } from '@kit/admin/components/admin-guard';

function AdminDashboard() {
  return (
    <div>
      <h1>Admin Dashboard</h1>
      {/* Admin content */}
    </div>
  );
}

// Wrap the page component
export default AdminGuard(AdminDashboard);
```

## Admin Components

### Admin Dashboard

```tsx
import { AdminDashboard } from '@kit/admin/components/admin-dashboard';

export default function AdminPage() {
  return <AdminDashboard />;
}
```

### User Management Dialogs

```tsx
import {
  AdminCreateUserDialog,
  AdminDeleteUserDialog,
  AdminBanUserDialog,
  AdminReactivateUserDialog,
  AdminResetPasswordDialog,
  AdminImpersonateUserDialog
} from '@kit/admin/components';

// Create new user
<AdminCreateUserDialog onSuccess={(user) => console.log('User created:', user)} />

// Delete user
<AdminDeleteUserDialog userId={userId} onSuccess={() => console.log('User deleted')} />

// Ban user
<AdminBanUserDialog userId={userId} onSuccess={() => console.log('User banned')} />

// Reactivate user
<AdminReactivateUserDialog userId={userId} onSuccess={() => console.log('User reactivated')} />

// Reset password
<AdminResetPasswordDialog userId={userId} />

// Impersonate user
<AdminImpersonateUserDialog userId={userId} />
```

### Admin Tables

```tsx
import {
  AdminAccountsTable,
  AdminMembersTable,
  AdminMembershipsTable
} from '@kit/admin/components';

// Accounts table
<AdminAccountsTable accounts={accounts} />

// Members table
<AdminMembersTable members={members} />

// Memberships table
<AdminMembershipsTable memberships={memberships} />
```

## Server-Side Admin Utilities

### Check Super Admin Status

```typescript
import { isSuperAdmin } from '@kit/admin/is-super-admin';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

async function checkAdminAccess() {
  const client = getSupabaseServerClient();
  const isAdmin = await isSuperAdmin(client);

  if (!isAdmin) {
    throw new Error('Admin access required');
  }

  // Proceed with admin operations
}
```

### Admin Action Wrapper

```typescript
import { adminAction } from '@kit/admin/admin-action';

// Wrap actions that require admin privileges
export const deleteUserAction = adminAction(
  async function (userId: string) {
    // This code only runs if user is super admin
    await deleteUser(userId);
    return { success: true };
  }
);
```

## Admin Services

### Admin Dashboard Service

```typescript
import { createAdminDashboardService } from '@kit/admin/services/admin-dashboard';

const service = createAdminDashboardService(adminClient);

// Get dashboard metrics
const metrics = await service.getDashboardMetrics();
// Returns: { totalUsers, totalAccounts, activeSubscriptions, etc. }

// Get recent activity
const activity = await service.getRecentActivity();

// Get system health
const health = await service.getSystemHealth();
```

### Admin Accounts Service

```typescript
import { createAdminAccountsService } from '@kit/admin/services/admin-accounts';

const service = createAdminAccountsService(adminClient);

// List all accounts
const accounts = await service.listAccounts({
  limit: 20,
  offset: 0,
  search: 'acme'
});

// Get account details
const account = await service.getAccount(accountId);

// Delete account
await service.deleteAccount(accountId);

// Get account members
const members = await service.getAccountMembers(accountId);
```

### Admin Auth User Service

```typescript
import { createAdminAuthUserService } from '@kit/admin/services/admin-auth-user';

const service = createAdminAuthUserService(adminClient);

// Create user
const user = await service.createUser({
  email: 'user@example.com',
  password: 'secure_password',
  displayName: 'John Doe'
});

// Ban user
await service.banUser(userId, reason);

// Reactivate user
await service.reactivateUser(userId);

// Delete user
await service.deleteUser(userId);

// Reset password
const newPassword = await service.resetPassword(userId);

// Impersonate user
const session = await service.impersonateUser(userId);
```

## Admin Server Actions

```typescript
import {
  createUserAction,
  deleteUserAction,
  banUserAction,
  reactivateUserAction,
  deleteAccountAction,
  resetPasswordAction
} from '@kit/admin/server-actions';

// Use in server components or API routes
await createUserAction({
  email: 'user@example.com',
  password: 'password',
  displayName: 'John Doe'
});

await banUserAction(userId);
await reactivateUserAction(userId);
await deleteUserAction(userId);
await deleteAccountAction(accountId);
const newPassword = await resetPasswordAction(userId);
```

## Schemas

### Create User Schema

```typescript
import { CreateUserSchema } from '@kit/admin/schema/create-user';

// Validate user creation data
const validatedData = CreateUserSchema.parse({
  email: 'user@example.com',
  password: 'secure_password',
  displayName: 'John Doe',
  emailVerified: true
});
```

### Admin Actions Schema

```typescript
import { AdminActionsSchema } from '@kit/admin/schema/admin-actions';

// Validate admin action data
const schemas = AdminActionsSchema;
// Includes: BanUserSchema, DeleteUserSchema, etc.
```

## Admin Dashboard Loader

```typescript
import { loadAdminDashboard } from '@kit/admin/loaders/admin-dashboard';

// Load dashboard data in server component
export default async function AdminDashboardPage() {
  const dashboardData = await loadAdminDashboard();

  return <AdminDashboard data={dashboardData} />;
}
```

## Security Considerations

1. **Always verify admin status** before performing sensitive operations
2. **Log all admin actions** for audit trails
3. **Use transaction locks** for data modifications
4. **Implement rate limiting** on admin endpoints
5. **Never expose admin routes** to regular users
6. **Validate all inputs** with schemas
7. **Use admin service account** for privileged operations

## Error Handling

```typescript
import { getLogger } from '@kit/shared/logger';

async function performAdminOperation(userId: string) {
  const logger = await getLogger();
  const ctx = { operation: 'admin_delete_user', userId, adminId: admin.id };

  try {
    logger.info(ctx, 'Starting admin operation');

    if (!await isSuperAdmin(client)) {
      throw new Error('Unauthorized');
    }

    await deleteUser(userId);

    logger.info(ctx, 'Admin operation completed');
  } catch (error) {
    logger.error({ ...ctx, error }, 'Admin operation failed');
    throw error;
  }
}
```

## Environment Variables

```bash
# Optional - for enhanced admin features
ADMIN_EMAIL_WHITELIST=admin1@example.com,admin2@example.com
ENABLE_USER_IMPERSONATION=true
ADMIN_ACTION_WEBHOOK_URL=https://audit.example.com/webhook
```

## Package Dependencies

### External
- `@supabase/supabase-js`: Database operations
- `react-hook-form`: Form handling
- `zod`: Schema validation

### Internal
- `@kit/supabase`: Database client
- `@kit/ui`: UI components
- `@kit/shared`: Shared utilities
- `@kit/auth`: Authentication

### Packages that use this:
- [web](../../../apps/web)

## Contributing

When making changes to this package:

1. Ensure admin operations are properly secured
2. Add audit logging for new admin actions
3. Test with both admin and non-admin users
4. Run `pnpm typecheck` before committing
5. Document new admin capabilities

---

*Updated on 9/20/2025*