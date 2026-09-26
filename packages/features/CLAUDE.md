# Feature Packages Instructions

This file contains instructions for working with feature packages including accounts, teams, billing, auth, and notifications.

> **Verification process:** [docs/ENGINEERING-WORKFLOW.md](../../docs/ENGINEERING-WORKFLOW.md)
> — the six failure modes, what each test layer can and cannot see, and the
> pre-PR audit. Before citing a test count, check the package is actually in the
> CI job: two were missing for months.

## Feature Package Structure

- `accounts/` - Personal account management
- `admin/` - Super admin functionality
- `auth/` - Authentication features
- `notifications/` - Notification system
- `projects/` - Project management (multi-user collaboration)
- `team-accounts/` - Team account management

## Account Services

### Personal Accounts API

Located at: `packages/features/accounts/src/server/api.ts`

```typescript
import { createAccountsApi } from '@kit/accounts/api';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const client = getSupabaseServerClient();
const api = createAccountsApi(client);

// Get account data
const account = await api.getAccount(accountId);

// Get account workspace
const workspace = await api.getAccountWorkspace();

// Load user accounts
const accounts = await api.loadUserAccounts();

// Get subscription
const subscription = await api.getSubscription(accountId);

// Get customer ID
const customerId = await api.getCustomerId(accountId);
```

### Team Accounts API

Located at: `packages/features/team-accounts/src/server/api.ts`

```typescript
import { createTeamAccountsApi } from '@kit/team-accounts/api';

const api = createTeamAccountsApi(client);

// Get team account by slug
const account = await api.getTeamAccount(slug);

// Get account workspace
const workspace = await api.getAccountWorkspace(slug);

// Check permissions
const hasPermission = await api.hasPermission({
  accountId,
  userId,
  permission: 'billing.manage'
});

// Get members count
const count = await api.getMembersCount(accountId);

// Get invitation
const invitation = await api.getInvitation(adminClient, token);
```

## Projects API

**New Feature**: Multi-user project collaboration within team accounts.

Located at: `packages/features/projects/src/lib/server/project.queries.ts` and `project.mutations.ts`

### Project Queries

```typescript
import {
  getAccountProjects,
  getProject,
  getProjectMembers,
  hasProjectRole,
  canPerformProjectAction,
  getUserProjectRole,
  getAvailableProjectMembers,
} from '@kit/projects/server';

// Get all projects for an account
const projects = await getAccountProjects(accountId);
// Returns: ProjectWithRole[] (includes user's role)

// Get single project
const project = await getProject(projectId);
// Returns: Project | null

// Get project members with user info
const members = await getProjectMembers(projectId);
// Returns: ProjectMemberWithUser[]

// Check if user has specific role
const isOwner = await hasProjectRole(projectId, 'owner');
const hasAccess = await hasProjectRole(projectId); // Any role

// Check specific permissions
const canEdit = await canPerformProjectAction(projectId, 'project.edit');
const canManageMembers = await canPerformProjectAction(projectId, 'project.members.add');

// Get user's role on project
const role = await getUserProjectRole(projectId);
// Returns: 'owner' | 'admin' | 'member' | 'viewer' | null

// Get available users to add (account members not in project)
const availableUsers = await getAvailableProjectMembers(projectId, accountSlug);
```

### Project Mutations

```typescript
import {
  createProjectAction,
  updateProjectAction,
  deleteProjectAction,
  addProjectMemberAction,
  updateProjectMemberAction,
  removeProjectMemberAction,
} from '@kit/projects/server';

// Create project
const result = await createProjectAction({
  account_id: accountId,
  name: 'My Project',
  description: 'Project description',
  slug: 'my-project',
  metadata: { custom: 'data' },
});

// Update project
await updateProjectAction({
  id: projectId,
  name: 'Updated Name',
  status: 'active', // or 'archived'
});

// Delete project (a refusal comes back as a value: unwrap throws it)
await unwrap(deleteProjectAction({ id: projectId }));

// Add member
await addProjectMemberAction({
  project_id: projectId,
  user_id: userId,
  role: 'member', // 'owner' | 'admin' | 'member' | 'viewer'
});

// Update member role
await updateProjectMemberAction({
  project_id: projectId,
  user_id: userId,
  role: 'admin',
});

// Remove member (a refusal comes back as a value: unwrap throws it)
await unwrap(removeProjectMemberAction({
  project_id: projectId,
  user_id: userId,
}));
```

### Project Roles & Permissions

**Roles** (hierarchical):
- **Owner**: Full control, can delete project
- **Admin**: Manage members, edit settings
- **Member**: Edit project content
- **Viewer**: Read-only access

**Permissions**:
- `project.view` - View project details
- `project.edit` - Edit project metadata
- `project.delete` - Delete project (owner only)
- `project.members.view` - View member list
- `project.members.add` - Add new members
- `project.members.remove` - Remove members
- `project.settings.view` - View project settings
- `project.settings.edit` - Modify project settings

**Database Functions**:
```sql
-- Check access with permission
public.has_permission(user_id, account_id, 'projects.manage'::app_permissions)

-- Get projects with user's role
public.get_account_projects(target_account_id uuid)

-- Get project members with user info
public.get_project_members(target_project_id uuid)

-- Check specific role
public.has_role_on_project(target_project_id uuid, target_role text)

-- Check action permission
public.can_perform_project_action(target_project_id uuid, action text)
```

### Project Components

**UI Components** (located in `packages/features/projects/src/components/`):

```typescript
import {
  CreateProjectForm,
  UpdateProjectForm,
  DeleteProjectDialog,
  ProjectsList,
  ProjectCard,
  ProjectMembersList,
  AddProjectMemberForm,
  UpdateProjectMemberDialog,
  RemoveProjectMemberDialog,
} from '@kit/projects/components';

// Create project
<CreateProjectForm
  accountId={accountId}
  onSuccess={() => router.refresh()}
/>

// Update project
<UpdateProjectForm
  project={project}
  onSuccess={() => router.refresh()}
/>

// Manage members
<AddProjectMemberForm
  projectId={projectId}
  availableMembers={availableMembers}
  onSuccess={() => router.refresh()}
/>
```

### Project Routes

**Personal Account Projects**:
- List: `/home/(user)/projects`
- Detail: `/home/(user)/projects/[id]`
- Settings: `/home/(user)/projects/[id]/settings`

**Team Account Projects**:
- List: `/home/[account]/projects`
- Detail: `/home/[account]/projects/[id]`
- Settings: `/home/[account]/projects/[id]/settings`

### Project Usage Example

```typescript
// app/home/[account]/projects/page.tsx
import { getAccountProjects } from '@kit/projects/server';
import { ProjectsList } from '@kit/projects/components';

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ account: string }>;
}) {
  const { account } = await params;

  // Fetch projects (RLS ensures user has access)
  const projects = await getAccountProjects(account);

  return (
    <div>
      <h1>Projects</h1>
      <ProjectsList projects={projects} accountSlug={account} />
    </div>
  );
}
```

### Project Security

**Row Level Security (RLS)**:
- Projects table enforces account membership
- Project members table validates project access
- Automatic creator added as owner via trigger

**Authorization Pattern**:
```typescript
// Check permission before action
const canDelete = await canPerformProjectAction(projectId, 'project.delete');

if (!canDelete) {
  throw new Error('Insufficient permissions');
}

await unwrap(deleteProjectAction({ id: projectId }));
```

**See**: `packages/features/projects/src/lib/server/project.queries.ts` for implementation details

## Workspace Contexts

### Personal Account Context

Use in `apps/web/app/home/(user)` routes:

```tsx
import { useUserWorkspace } from 'kit/accounts/hooks/use-user-workspace';

function PersonalComponent() {
  const { user, account } = useUserWorkspace();
  
  // user: authenticated user data
  // account: personal account data
  
  return <div>Welcome {user.name}</div>;
}
```

Context provider: `packages/features/accounts/src/components/user-workspace-context-provider.tsx`

### Team Account Context

Use in `apps/web/app/home/[account]` routes:

```tsx
import { useTeamAccountWorkspace } from '@kit/team-accounts/hooks/use-team-account-workspace';

function TeamComponent() {
  const { account, user, accounts } = useTeamAccountWorkspace();
  
  // account: current team account data
  // user: authenticated user data  
  // accounts: all accounts user has access to
  
  return <div>Team: {account.name}</div>;
}
```

Context provider: `packages/features/team-accounts/src/components/team-account-workspace-context-provider.tsx`

## Billing Services

### Personal Billing

Located at: `apps/web/app/home/(user)/billing/_lib/server/user-billing.service.ts`

```typescript
// Personal billing operations
// - Manage individual user subscriptions
// - Handle personal account payments
// - Process individual billing changes
```

### Team Billing  

Located at: `apps/web/app/home/[account]/billing/_lib/server/team-billing.service.ts`

```typescript
// Team billing operations
// - Manage team subscriptions
// - Handle team payments
// - Process team billing changes
```

### Per-Seat Billing Service

Located at: `packages/features/team-accounts/src/server/services/account-per-seat-billing.service.ts`

```typescript
import { createAccountPerSeatBillingService } from '@kit/team-accounts/billing';

const billingService = createAccountPerSeatBillingService(client);

// Increase seats when adding team members
await billingService.increaseSeats(accountId);

// Decrease seats when removing team members  
await billingService.decreaseSeats(accountId);

// Get per-seat subscription item
const subscription = await billingService.getPerSeatSubscriptionItem(accountId);
```

## Authentication Features

### OTP for Sensitive Operations

Use one-time tokens from `packages/otp/src/api/index.ts`:

```tsx
import { VerifyOtpForm } from '@kit/otp/components';

<VerifyOtpForm
  purpose="account-deletion"
  email={user.email}
  onSuccess={(otp) => {
    // Proceed with verified operation
    handleSensitiveOperation(otp);
  }}
  CancelButton={<Button variant="outline">Cancel</Button>}
/>
```

## Admin Features

### Super Admin Protection

For admin routes, use `AdminGuard`:

```tsx
import { AdminGuard } from '@kit/admin/components/admin-guard';

function AdminPage() {
  return (
    <div>
      <h1>Admin Dashboard</h1>
      {/* Admin content */}
    </div>
  );
}

// Wrap the page component
export default AdminGuard(AdminPage);
```

### Admin Service

Located at: `packages/features/admin/src/lib/server/services/admin.service.ts`

```typescript
// Admin service operations
// - Manage all accounts
// - Handle admin-level operations
// - Access system-wide data
```

### Checking Admin Status

```typescript
import { isSuperAdmin } from '@kit/admin';

function criticalAdminFeature() {
  const isAdmin = await isSuperAdmin(client);

  if (!isAdmin) {
    throw new Error('Access denied: Admin privileges required');
  }

  // ...
}
```

## Error Handling & Logging

### Structured Logging

Use logger from `packages/shared/src/logger/logger.ts`:

```typescript
import { getLogger } from '@kit/shared/logger';

async function featureOperation() {
  const logger = await getLogger();

  const ctx = { 
    name: 'feature-operation', 
    userId: user.id,
    accountId: account.id 
  };

  try {
    logger.info(ctx, 'Starting feature operation');
    
    // Perform operation
    const result = await performOperation();
    
    logger.info({ ...ctx, result }, 'Feature operation completed');
    return result;
  } catch (error) {
    logger.error({ ...ctx, error }, 'Feature operation failed');
    throw error;
  }
}
```

## Permission Patterns

### Team Permissions

```typescript
import { createTeamAccountsApi } from '@kit/team-accounts/api';

const api = createTeamAccountsApi(client);

// Check if user has specific permission on account
const canManageBilling = await api.hasPermission({
  accountId,
  userId,
  permission: 'billing.manage'
});

if (!canManageBilling) {
  throw new Error('Insufficient permissions');
}
```

### Account Ownership

```typescript
// Check if user is account owner (works for both personal and team accounts)
const isOwner = await client.rpc('is_account_owner', { 
  account_id: accountId 
});

if (!isOwner) {
  throw new Error('Only account owners can perform this action');
}
```