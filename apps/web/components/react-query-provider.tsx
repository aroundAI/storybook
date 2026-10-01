'use client';

import { useState } from 'react';

import { isRedirectError } from 'next/dist/client/components/redirect-error';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function ReactQueryProvider(props: React.PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // With SSR, we usually want to set some default staleTime
            // above 0 to avoid refetching immediately on the client
            staleTime: 60 * 1000,
            // A query whose server action redirected (the session ended)
            // must not retry: Next.js queues actions ahead of the redirect's
            // navigation, so each retry redirected again and held the user
            // off the sign-in page (KB-159).
            retry: (failureCount, error) =>
              !isRedirectError(error) && failureCount < 3,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {props.children}
    </QueryClientProvider>
  );
}
