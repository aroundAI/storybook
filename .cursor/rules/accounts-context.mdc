---
description: Personal Accounts context and functionality
globs: 
alwaysApply: false
---
# Personal Account Context

This rule provides guidance for working with personal account related components in the application.

The user/personal account context in the application lives under the path `app/home/(user)`. Under this context, we identify the user using Supabase Auth.

We can use the `requireUserInServerComponent` to retrieve the relative Supabase User object and identify the user. [require-user-in-server-component.ts](mdc:apps/web/lib/server/require-user-in-server-component.ts)

### Client Components

In a Client Component, we can access the `UserWorkspaceContext` and use the `user` object to identify the user.

We can use it like this:

```tsx
import { useUserWorkspace } from '@kit/accounts/hooks/use-user-workspace';
```

This utility only works in paths under `apps/*/app/home/(user)`.

## Guidelines

### Components and Structure
- Personal account components are used in the `/home/(user)` route
- Reusable components should be in `packages/features/accounts/src/components`
- Settings-related components should be in `packages/features/accounts/src/components/personal-account-settings`

### State Management
- Use the `UserWorkspaceContext` to access user workspace data
- Personal account data can be fetched using `usePersonalAccountData` hook
- Mutations should use React Query's `useMutation` hooks

### Authentication Flow
- User authentication status is available via `useUser` hook
- Account deletion requires OTP verification
- Password updates may require reauthentication

### Feature Flags
- Personal account features are controlled via `featureFlagsConfig` [feature-flags.config.ts](mdc:apps/web/config/feature-flags.config.ts)
- Key flags: 
  - `enableAccountDeletion`
  - `enablePasswordUpdate`
  - `enablePersonalAccountBilling`
  - `enableNotifications`

## Personal Account API

The API for the personal account is [api.ts](mdc:packages/features/accounts/src/server/api.ts)

A class that provides methods for interacting with account-related data in the database. Initializes a new instance of the `AccountsApi` class with a Supabase client.

### AccountsApi
```typescript
constructor(client: SupabaseClient<Database>)
```

### Methods
- `getAccount(id: string)` - Get account by ID
- `getAccountWorkspace()` - Get current user's account workspace
- `loadUserAccounts()` - Get all accounts for current user
- `getSubscription(accountId: string)` - Get account subscription
- `getOrder(accountId: string)` - Get account order
- `getCustomerId(accountId: string)` - Get account customer ID

## Database

When applying Database rules [database.mdc](mdc:.cursor/rules/database.mdc) must ensure the authenticated user matches the account ID of the entity

```sql
account_id = (select auth.uid())
```
