# @kit/team-accounts

Multi-tenant team collaboration system with role-based access control, member management, and per-seat billing.

## Purpose

This package provides complete team account functionality including team creation, member management, invitations, role-based permissions, and team billing integration. It implements a multi-tenant architecture where users can belong to multiple teams with different roles.

## Public API

### Server API

```typescript
import { createTeamAccountsApi } from '@kit/team-accounts/api';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const client = getSupabaseServerClient();
const api = createTeamAccountsApi(client);

// Get team account by slug
const account = await api.getTeamAccount('my-team-slug');

// Get team workspace data
const workspace = await api.getAccountWorkspace('my-team-slug');

// Check user permissions
const canManageBilling = await api.hasPermission({
  accountId: 'account-id',
  userId: 'user-id',
  permission: 'billing.manage'
});

// Get team members count
const memberCount = await api.getMembersCount('account-id');

// Process invitation
const invitation = await api.getInvitation(adminClient, 'invitation-token');
```

### React Components

```typescript
// Team Settings Page
import { TeamSettings } from '@kit/team-accounts/components';

export function TeamSettingsPage() {
  return <TeamSettings />;
}

// Team Members Management
import { TeamMembersList } from '@kit/team-accounts/components';

export function MembersPage() {
  return <TeamMembersList />;
}

// Invite Team Members
import { InviteTeamMembers } from '@kit/team-accounts/components';

export function InvitePage() {
  return <InviteTeamMembers />;
}

// Team Switcher (for navigation)
import { TeamSwitcher } from '@kit/team-accounts/components';

export function Navigation() {
  return (
    <nav>
      <TeamSwitcher />
      {/* other nav items */}
    </nav>
  );
}

// Create Team Form
import { CreateTeamForm } from '@kit/team-accounts/components';

export function CreateTeamPage() {
  return <CreateTeamForm onSuccess={(team) => redirect(`/home/${team.slug}`)} />;
}
```

### React Hooks

```typescript
import {
  useTeamAccountWorkspace,
  useTeam,
  useTeamMembers,
  useTeamPermissions
} from '@kit/team-accounts/hooks';

function TeamDashboard() {
  // Get complete team workspace context
  const { account, user, accounts } = useTeamAccountWorkspace();

  // Get current team info
  const team = useTeam();

  // Get team members list
  const members = useTeamMembers();

  // Check permissions
  const permissions = useTeamPermissions();
  const canManageTeam = permissions.has('settings.manage');

  return (
    <div>
      <h1>Team: {account.name}</h1>
      <p>Members: {members.length}</p>
      {canManageTeam && <TeamSettings />}
    </div>
  );
}
```

### Team Workspace Provider

For team routes (`app/home/[account]/*`), wrap with the workspace provider:

```typescript
// app/home/[account]/layout.tsx
import { TeamAccountWorkspaceProvider } from '@kit/team-accounts/providers';

export default async function TeamLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { account: string };
}) {
  const { account } = await params;

  // Load workspace data server-side
  const api = createTeamAccountsApi(getSupabaseServerClient());
  const workspace = await api.getAccountWorkspace(account);

  return (
    <TeamAccountWorkspaceProvider workspace={workspace}>
      {children}
    </TeamAccountWorkspaceProvider>
  );
}
```

## Permissions System

The package implements a flexible RBAC system with these default permissions:

```typescript
const PERMISSIONS = {
  'members.manage': 'Add, remove, and update team members',
  'billing.manage': 'Manage team subscription and billing',
  'settings.manage': 'Update team settings and configuration'
};
```

### Checking Permissions

```typescript
// Server-side
const hasPermission = await api.hasPermission({
  accountId: 'team-account-id',
  userId: 'user-id',
  permission: 'billing.manage'
});

// Client-side
const permissions = useTeamPermissions();
if (permissions.has('members.manage')) {
  // Show member management UI
}
```

## Team Roles

Three built-in roles with different permission levels:

- **Owner**: Full access to all team features
- **Admin**: Can manage members and settings (no billing)
- **Member**: Basic access to team resources

## Per-Seat Billing Integration

The package includes per-seat billing support:

```typescript
import { createAccountPerSeatBillingService } from '@kit/team-accounts/billing';

const billingService = createAccountPerSeatBillingService(client);

// Automatically called when members are added/removed
await billingService.increaseSeats('account-id'); // Member added
await billingService.decreaseSeats('account-id'); // Member removed

// Get per-seat subscription item
const subscription = await billingService.getPerSeatSubscriptionItem('account-id');
```

## Invitation Flow

### Sending Invitations

```typescript
// Server action
import { inviteTeamMember } from '@kit/team-accounts/actions';

await inviteTeamMember({
  accountId: 'team-account-id',
  email: 'new.member@example.com',
  role: 'member'
});
```

### Accepting Invitations

```typescript
// app/invite/[token]/page.tsx
import { acceptInvitation } from '@kit/team-accounts/actions';

export default async function InvitePage({ params }) {
  const { token } = await params;

  // Process invitation
  await acceptInvitation(token);

  // Redirect to team workspace
  redirect('/home/team-slug');
}
```

## Database Schema

The package uses these main tables:

- `accounts` - Base account table (shared with personal accounts)
- `team_accounts` - Team-specific data
- `accounts_memberships` - User-team relationships and roles
- `team_accounts_invitations` - Pending invitations
- `team_accounts_permissions` - Custom permission assignments

## Usage Examples

### Creating a New Team

```typescript
import { createTeam } from '@kit/team-accounts/actions';

const team = await createTeam({
  name: 'My Company',
  slug: 'my-company'
});

// User is automatically added as owner
redirect(`/home/${team.slug}`);
```

### Managing Team Members

```typescript
// Add member
await addTeamMember({
  accountId: team.id,
  userId: 'user-id',
  role: 'member'
});

// Update member role
await updateMemberRole({
  accountId: team.id,
  userId: 'user-id',
  role: 'admin'
});

// Remove member
await removeTeamMember({
  accountId: team.id,
  userId: 'user-id'
});
```

### Team Subscription Management

```typescript
// Navigate to team billing page
<Link href={`/home/${team.slug}/billing`}>
  Manage Subscription
</Link>

// Check if team has active subscription
const subscription = await api.getSubscription(team.id);
if (subscription?.status === 'active') {
  // Team has active subscription
}
```

## Security

- All operations use RLS (Row Level Security) in Supabase
- Permission checks are enforced at database level
- Invitation tokens are single-use and expire after 7 days
- Team slugs must be unique across the platform

## Best Practices

1. Always use the workspace provider in team routes
2. Check permissions before showing UI elements
3. Handle team switching properly (clear caches, refresh data)
4. Use server-side data loading for initial page loads
5. Implement proper error handling for permission denials

### `typecheck`
```bash
pnpm --filter team-accounts typecheck
```
Verifies TypeScript type correctness

## Available Hooks

### `useTeamAccountWorkspace`
```typescript
import { useTeamAccountWorkspace } from '@kit/team-accounts/hooks';
```

## Installation

```bash
pnpm add @kit/team-accounts
```

## Package Dependencies

### Packages that use this:
- [web](../../../apps/web)
- [@kit/database-webhooks](../../database-webhooks)

## Code Statistics

- **Total Files**: 51
- **Total Lines**: 5,137

## Project Structure

```
packages/features/team-accounts/
├── src/           # Source code
│   ├── hooks/       # Custom React hooks
├── package.json   # Package configuration
├── tsconfig.json  # TypeScript configuration
└── README.md      # This file```

## Usage Example

```typescript
import { useTeamAccountWorkspace } from '@kit/team-accounts/hooks';

function MyComponent() {
  const data = useTeamAccountWorkspace();
  return <div>{/* Use data here */}</div>;
}
```

## Contributing

When making changes to this package:

1. Follow the existing code style and patterns
2. Update tests if applicable
3. Run `pnpm lint` and `pnpm typecheck` before committing
4. Update this README if adding new features or changing behavior

---

*Generated on 9/20/2025*
