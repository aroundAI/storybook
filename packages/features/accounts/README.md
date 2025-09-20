# @kit/accounts

Personal account management for individual users in a multi-tenant SaaS application.

## Purpose

This package manages personal user accounts, providing:
- Personal workspace context and management
- Account creation and setup
- User profile and settings
- Account-level data access
- Personal billing and subscriptions
- User preferences and configurations

## Installation

```bash
pnpm add @kit/accounts
```

## User Workspace Context

### Using the User Workspace Hook

For personal account pages (`/home/(user)/*`):

```tsx
'use client';
import { useUserWorkspace } from '@kit/accounts/hooks/use-user-workspace';

function PersonalDashboard() {
  const { user, account } = useUserWorkspace();

  return (
    <div>
      <h1>Welcome, {user.displayName || user.email}!</h1>
      <p>Account ID: {account.id}</p>
      <p>Account Type: {account.type}</p>
    </div>
  );
}
```

### User Workspace Provider

```tsx
import { UserWorkspaceContextProvider } from '@kit/accounts/components/user-workspace-context-provider';

export default function PersonalLayout({ children }) {
  return (
    <UserWorkspaceContextProvider>
      {children}
    </UserWorkspaceContextProvider>
  );
}
```

## Accounts API

### Creating the API Client

```typescript
import { createAccountsApi } from '@kit/accounts/api';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const client = getSupabaseServerClient();
const api = createAccountsApi(client);
```

### API Methods

```typescript
// Get account data
const account = await api.getAccount(accountId);

// Get user workspace
const workspace = await api.getAccountWorkspace();
// Returns: { account, user }

// Load all user accounts
const accounts = await api.loadUserAccounts();
// Returns all accounts user has access to

// Get subscription
const subscription = await api.getSubscription(accountId);

// Get billing customer ID
const customerId = await api.getCustomerId(accountId);

// Update account
await api.updateAccount(accountId, {
  name: 'New Name',
  settings: { theme: 'dark' }
});
```

## Account Hooks

### usePersonalAccountData

```tsx
import { usePersonalAccountData } from '@kit/accounts/hooks/use-personal-account-data';

function AccountInfo() {
  const { data: account, isLoading } = usePersonalAccountData();

  if (isLoading) return <Spinner />;

  return (
    <div>
      <h2>{account.name}</h2>
      <p>Created: {account.created_at}</p>
    </div>
  );
}
```

### useUpdateAccountData

```tsx
import { useUpdateAccountData } from '@kit/accounts/hooks/use-update-account-data';

function AccountSettings() {
  const updateAccount = useUpdateAccountData();

  const handleUpdate = async (data) => {
    await updateAccount.mutateAsync({
      name: data.name,
      settings: data.settings
    });

    toast.success('Account updated');
  };

  return <SettingsForm onSubmit={handleUpdate} />;
}
```

### useRevalidatePersonalAccountDataQuery

```tsx
import { useRevalidatePersonalAccountDataQuery } from '@kit/accounts/hooks';

function RefreshButton() {
  const revalidate = useRevalidatePersonalAccountDataQuery();

  return (
    <Button onClick={() => revalidate()}>
      Refresh Account Data
    </Button>
  );
}
```

## Account Creation

### Create Account Mutation

```typescript
import { createAccount } from '@kit/accounts/mutations/create-account';

const account = await createAccount(client, {
  name: 'My Personal Account',
  slug: 'my-account', // Optional, auto-generated if not provided
});
```

### Account Setup Flow

```tsx
import { AccountSetupForm } from '@kit/accounts/components/account-setup-form';

function OnboardingPage() {
  return (
    <AccountSetupForm
      onSuccess={(account) => {
        // Redirect to dashboard
        router.push(`/home/${account.slug}`);
      }}
    />
  );
}
```

## Server Actions

### Account Management Actions

```typescript
import {
  updateAccountAction,
  deleteAccountAction,
  updateBillingAction
} from '@kit/accounts/server-actions';

// Update account details
await updateAccountAction({
  accountId,
  name: 'Updated Name',
  settings: { notifications: true }
});

// Delete account (with confirmation)
await deleteAccountAction(accountId, confirmationToken);

// Update billing
await updateBillingAction({
  accountId,
  planId: 'pro',
  paymentMethodId: 'pm_xxx'
});
```

## Components

### Account Settings Form

```tsx
import { AccountSettingsForm } from '@kit/accounts/components/account-settings-form';

function SettingsPage() {
  return (
    <AccountSettingsForm
      accountId={account.id}
      defaultValues={{
        name: account.name,
        email: account.email,
        timezone: account.timezone
      }}
      onSuccess={() => {
        toast.success('Settings updated');
      }}
    />
  );
}
```

### Account Deletion Dialog

```tsx
import { DeleteAccountDialog } from '@kit/accounts/components/delete-account-dialog';

function DangerZone() {
  return (
    <DeleteAccountDialog
      accountId={account.id}
      onSuccess={() => {
        router.push('/goodbye');
      }}
    >
      <Button variant="destructive">
        Delete Account
      </Button>
    </DeleteAccountDialog>
  );
}
```

### Account Switcher

```tsx
import { AccountSwitcher } from '@kit/accounts/components/account-switcher';

function Navigation() {
  return (
    <AccountSwitcher
      currentAccountId={account.id}
      accounts={userAccounts}
      onSwitch={(accountId) => {
        router.push(`/home/${accountId}`);
      }}
    />
  );
}
```

## Personal vs Team Accounts

### Account Type Detection

```typescript
import { isPersonalAccount, isTeamAccount } from '@kit/accounts/utils';

if (isPersonalAccount(account)) {
  // Personal account logic
  // account.id === user.id
}

if (isTeamAccount(account)) {
  // Team account logic
  // Redirect to team routes
}
```

### Account Type Guards

```tsx
import { PersonalAccountOnly } from '@kit/accounts/components/guards';

function PersonalFeature() {
  return (
    <PersonalAccountOnly fallback="/home">
      <PersonalOnlyContent />
    </PersonalAccountOnly>
  );
}
```

## Billing Integration

### Personal Subscription Management

```typescript
import { getPersonalSubscription } from '@kit/accounts/queries/subscription';

const subscription = await getPersonalSubscription(accountId);

if (subscription?.status === 'active') {
  // Show premium features
}
```

### Billing Portal Link

```tsx
import { BillingPortalButton } from '@kit/accounts/components/billing-portal-button';

function BillingPage() {
  return (
    <BillingPortalButton accountId={account.id}>
      Manage Subscription
    </BillingPortalButton>
  );
}
```

## Security

### Account Access Control

```typescript
// Personal accounts are always owned by the user
// account.id === user.id for personal accounts

const canAccess = account.id === user.id;
const canModify = account.primary_owner_user_id === user.id;
```

### Data Isolation

```sql
-- RLS policy for personal accounts
CREATE POLICY "personal_account_access" ON accounts
  FOR ALL TO authenticated
  USING (id = auth.uid());
```

## Error Handling

```typescript
import { AccountError } from '@kit/accounts/errors';
import { getLogger } from '@kit/shared/logger';

async function updateAccountSafely(accountId: string, data: any) {
  const logger = await getLogger();

  try {
    logger.info({ accountId }, 'Updating account');
    await updateAccount(accountId, data);
    logger.info({ accountId }, 'Account updated successfully');
  } catch (error) {
    if (error instanceof AccountError) {
      switch (error.code) {
        case 'ACCOUNT_NOT_FOUND':
          logger.warn({ accountId }, 'Account not found');
          break;
        case 'INSUFFICIENT_PERMISSIONS':
          logger.error({ accountId, userId }, 'Permission denied');
          break;
      }
    }
    throw error;
  }
}
```

## Testing

```typescript
import { createMockAccount, createMockUser } from '@kit/accounts/testing';

describe('Account Management', () => {
  it('should update account', async () => {
    const mockAccount = createMockAccount();
    const mockUser = createMockUser();

    // Test account operations
  });
});
```

## Package Dependencies

### External
- `@supabase/supabase-js`: Database operations
- `react-hook-form`: Form handling
- `zod`: Schema validation
- `react-query`: Data fetching
- `@radix-ui/*`: UI primitives

### Internal
- `@kit/supabase`: Database client
- `@kit/ui`: UI components
- `@kit/shared`: Shared utilities
- `@kit/billing-gateway`: Billing integration
- `@kit/i18n`: Internationalization

### Packages that use this:
- [web](../../../apps/web)
- [@kit/team-accounts](../team-accounts)

## Contributing

When making changes to this package:

1. Maintain separation between personal and team accounts
2. Ensure RLS policies are properly configured
3. Test billing integration thoroughly
4. Run `pnpm typecheck` before committing
5. Update workspace context when adding features

---

*Updated on 9/20/2025*