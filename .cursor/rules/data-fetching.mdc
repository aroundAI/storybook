---
description: Fetch data from the Database using the Supabase Clients
globs: apps/**,packages/**
alwaysApply: false
---
# Data Fetching

## General Data Flow
- In a Server Component context, please use the Supabase Client directly for data fetching
- In a Client Component context, please use the `useQuery` hook from the "@tanstack/react-query" package

Data Flow works in the following way:

1. Server Component uses the Supabase Client to fetch data.
2. Data is rendered in Server Components or passed down to Client Components when absolutely necessary to use a client component (e.g. when using React Hooks or any interaction with the DOM).

```tsx
import { getSupabaseServerClient } from '@kit/supabase/server-client';

async function ServerComponent() {
  const client = getSupabaseServerClient();
  const { data, error } = await client.from('notes').select('*');

  // use data
}
```

or pass down the data to a Client Component:

```tsx
import { getSupabaseServerClient } from '@kit/supabase/server-client';

export default function ServerComponent() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('notes').select('*');

  if (error) {
    return <SomeErrorComponent error={error} />;
  }

  return <SomeClientComponent data={data} />;
}
```

## Supabase Clients
- In a Server Component context, use the `getSupabaseServerClient` function from the "@kit/supabase/server-client" package [server-client.ts](mdc:packages/supabase/src/clients/server-client.ts)
- In a Client Component context, use the `useSupabase` hook from the "@kit/supabase/hooks/use-supabase" package.

### Admin Actions

Only in rare cases suggest using the Admin client `getSupabaseServerAdminClient` when needing to bypass RLS from the package `@kit/supabase/server-admin-client` [server-admin-client.ts](mdc:packages/supabase/src/clients/server-admin-client.ts)

## React Query

When using `useQuery`, make sure to define the data fetching hook. Create two components: one that fetches the data and one that displays the data. For example a good usage is [roles-data-provider.tsx](mdc:packages/features/team-accounts/src/components/members/roles-data-provider.tsx) as shown in [update-member-role-dialog.tsx](mdc:packages/features/team-accounts/src/components/members/update-member-role-dialog.tsx)

## Error Handling

- Logging using the `@kit/shared/logger` package [logger.ts](mdc:packages/shared/src/logger/logger.ts)
- Don't swallow errors, always handle them appropriately
- Handle promises and async/await gracefully
- Consider the unhappy path and handle errors appropriately
- Context without sensitive data

```tsx
'use server';

import { getLogger } from '@kit/shared/logger';

export async function myServerAction() {
  const logger = await getLogger();

  logger.info('Request started...');

  try {
    // your code here
    await someAsyncFunction();

    logger.info('Request succeeded...');
  } catch (error) {
    logger.error('Request failed...');

    // handle error
  }

  return {
    success: true,
  };
}
```