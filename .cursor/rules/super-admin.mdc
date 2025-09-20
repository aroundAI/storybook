---
description: Super Admin functionalities
globs: apps/*/app/admin/**,packages/features/admin/**
alwaysApply: false
---
## Super Admin

1. Page Authentication:
   - All pages in the admin section must be wrapped with the `AdminGuard` HOC
   - This ensures only users with the 'super-admin' role and MFA enabled can access these pages
   - Example: `export default AdminGuard(AdminPageComponent);`

2. Server Actions:
   - Use the `adminAction` wrapper for all server actions in the admin section
   - This checks if the current user is a super admin before executing the action
   - Example: 
     ```typescript
     export const yourAdminAction = adminAction(
       enhanceAction(
         async (data) => {
           // Action implementation
         },
         {
           schema: YourActionSchema,
         }
       )
     );
     ```

3. Authorization Functions:
   - Import and use `isSuperAdmin` from '@kit/admin' to check if the current user is a super admin [is-super-admin.ts](mdc:packages/features/admin/src/lib/server/utils/is-super-admin.ts)
   - This function returns a boolean indicating whether the user has the super-admin role and MFA enabled
   - Example: 
     ```typescript
     const isAdmin = await isSuperAdmin(getSupabaseServerClient());
     if (!isAdmin) {
       notFound(); // or redirect/throw error
     }
     ```

4. Schema Validation:
   - Define Zod schemas for all admin actions in the 'schema' directory
   - Follow the pattern in [admin-actions.schema.ts](mdc:packages/features/admin/src/lib/server/schema/admin-actions.schema.ts)
   - Include appropriate validation for all fields

5. Data Fetching
  - Do not use `ServerDataLoader` unless the query is very simple
  - Use the authed Supabase Server Client such as [admin-dashboard.loader.ts](mdc:packages/features/admin/src/lib/server/loaders/admin-dashboard.loader.ts)

The Super Admin section requires strict access control as it provides elevated privileges. Always ensure the current user cannot perform destructive actions on their own account and properly validate input data."

## Writing Pages in the Admin Sections

1. Basic Page Structure:
   ```typescript
   import { AdminGuard } from '@kit/admin/components/admin-guard';
   import { PageBody, PageHeader } from '@kit/ui/page';
   import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';

   // Optional metadata export
   export const metadata = {
     title: `Page Title`,
   };

   async function YourAdminPage() {
     // Load data using cached loaders
     const data = await loadYourAdminData();

     return (
       <>
         <PageHeader description={<AppBreadcrumbs />} />
         <PageBody>
           {/* Page content */}
         </PageBody>
       </>
     );
   }

   // IMPORTANT: Always wrap with AdminGuard
   export default AdminGuard(YourAdminPage);
   ```

2. Data Loading:
   - Create a cached loader function in a server directory
   - Use the Supabase client for database operations
   - Example:
     ```typescript
     // in _lib/server/loaders/your-loader.ts
     import { cache } from 'react';
     import { getSupabaseServerClient } from '@kit/supabase/server-client';

     export const loadYourAdminData = cache(async () => {
       const client = getSupabaseServerClient();
       
       const { data, error } = await client.from('your_table').select('*');
       
       if (error) throw error;
       return data;
     });
     ```

3. Dynamic Routes:
   - For pages that need parameters (like `[id]`), handle them appropriately
   - For example:
     ```typescript
     interface Params {
       params: Promise<{
         id: string;
       }>;
     }

     async function AdminDetailPage({ params }: Params) {
       const { id } = await params;
       const item = await loadItemById(id);
       // ...
     }
     ```

4. Updating Sidebar navigation at [admin-sidebar.tsx](mdc:apps/web/app/admin/_components/admin-sidebar.tsx) to include new pages

### Security Considerations:
   - Validate that the target is not the current super admin
   - Implement confirmation steps for destructive actions
   - Never expose sensitive error details to the client

### Services

1. Basic Service Structure:
   ```typescript
   import 'server-only';
   import { SupabaseClient } from '@supabase/supabase-js';
   import { Database } from '@kit/supabase/database';
   import { getLogger } from '@kit/shared/logger';

   export function createYourAdminService(client: SupabaseClient<Database>) {
     return new YourAdminService(client);
   }

   class YourAdminService {
     constructor(private readonly client: SupabaseClient<Database>) {}

     async performAction(params: YourActionParams) {
       const logger = await getLogger();
       const ctx = { name: 'admin.yourService', ...params };

       logger.info(ctx, 'Starting admin action');

       // Perform the action
       const { data, error } = await this.client
         .from('your_table')
         .update({ some_field: params.value })
         .eq('id', params.id);

       if (error) {
         logger.error({ ...ctx, error }, 'Admin action failed');
         throw error;
       }

       logger.info(ctx, 'Admin action completed successfully');
       return data;
     }
   }
   ```

2. Important Patterns:
   - Mark files with 'server-only' directive
   - Use factory functions to create service instances
   - Use class-based services with typed parameters
   - Properly type the Supabase client with the Database type
   - Use structured logging with context
   - Handle errors consistently

3. Security Checks:
   - Implement methods to verify the current user is not taking action on their own account
   - Example:
     ```typescript
     private async assertUserIsNotCurrentSuperAdmin(targetId: string) {
       const { data } = await this.client.auth.getUser();
       const currentUserId = data.user?.id;

       if (!currentUserId) {
         throw new Error(`Error fetching user`);
       }

       if (currentUserId === targetId) {
         throw new Error(
           `You cannot perform a destructive action on your own account as a Super Admin`
         );
       }
     }
     ```

4. Data Access:
   - Use the appropriate Supabase client (admin or regular)
   - For admin-only operations, use the admin client
   - For regular operations, use the standard client
   - Example:
     ```typescript
     constructor(
       private readonly client: SupabaseClient<Database>,
       private readonly adminClient?: SupabaseClient<Database>
     ) {}
     ```

5. Error Handling:
   - Use structured error handling
   - Include appropriate context in error logs
   - Return typed error responses

Services should be focused on specific domains and follow the principle of single responsibility.