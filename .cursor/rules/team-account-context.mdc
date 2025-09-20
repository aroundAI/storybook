---
description: Team Accounts context and functionality
globs: apps/*/app/home/[account],packages/features/team-accounts/**
alwaysApply: false
---
## Team Accounts

The team account context in the application lives under the path `app/home/[account]`. The `[account]` segment is the slug of the team account, from which we can identify the team.

### Accessing the Account Workspace Data in Client Components

The data fetched from the account workspace API is available in the team context. You can access this data using the `useTeamAccountWorkspace` hook [use-team-account-workspace.ts](mdc:packages/features/team-accounts/src/hooks/use-team-account-workspace.ts)

```tsx
'use client';
import { useTeamAccountWorkspace } from '@kit/team-accounts/hooks/use-team-account-workspace';

export default function SomeComponent() {
  const { account, user, accounts } = useTeamAccountWorkspace();
  // use account, user, and accounts
}
```

The `useTeamAccountWorkspace` hook returns the same data structure as the `loadTeamWorkspace` function.

NB: the hooks is not to be used is Server Components, only in Client Components. Additionally, this is only available in the pages under /home/[account] layout.

### Team Pages

These pages are dedicated to the team account, which means they are only accessible to team members. To access these pages, the user must be authenticated and belong to the team.

## Guidelines

### State Management
- Use the `TeamAccountWorkspaceContext` to access account workspace data
- Team account data can be accessed using `useTeamAccountWorkspace` hook
- Server-side loading done with `loadTeamWorkspace` in `team-account-workspace.loader.ts` [team-account-workspace.loader.ts](mdc:apps/web/app/home/[account]/_lib/server/team-account-workspace.loader.ts)

### Account Management Features
- Role-based permissions control what users can do within a team
- Team members can be invited, roles can be updated, and members can be removed
- Primary account owner has special privileges (transfer ownership, delete team)
- Account deletion requires OTP verification

### Billing Integration
- Team account billing uses [team-billing.service.ts](mdc:apps/web/app/home/[account]/billing/_lib/server/team-billing.service.ts)
- Per-seat billing handled by [account-per-seat-billing.service.ts](mdc:packages/features/team-accounts/src/server/services/account-per-seat-billing.service.ts)

## API

The API for the personal account is [api.ts](mdc:packages/features/team-accounts/src/server/api.ts)

### Factory
```typescript
createAccountsApi(client: SupabaseClient<Database>): AccountsApi
```

### TeamAccountsApi
```typescript
constructor(client: SupabaseClient<Database>)
```

### Methods
- `getTeamAccount(slug: string)` - Get team by slug
- `getTeamAccountById(accountId: string)` - Get team by ID
- `getSubscription(accountId: string)` - Get team subscription
- `getOrder(accountId: string)` - Get team order
- `getAccountWorkspace(slug: string)` - Get team workspace
- `hasPermission({accountId, userId, permission})` - Check user permission
- `getMembersCount(accountId: string)` - Get team member count
- `getCustomerId(accountId: string)` - Get team customer ID
- `getInvitation(adminClient, token)` - Get invitation by token

## Feature Flags
- Key flags at [feature-flags.config.ts](mdc:apps/web/config/feature-flags.config.ts)
  - `enableTeamAccountBilling`
  - `enableTeamDeletion`
  - `enableTeamCreation`
  - `enableNotifications`
