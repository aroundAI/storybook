---
description: Server side functions logging
globs: 
alwaysApply: false
---
## Logging

Consider logging asynchronous requests using the `@kit/shared/logger` [logger.ts](mdc:packages/shared/src/logger/logger.ts) package in a structured way to provide context to the logs in both server actions and route handlers.

The logger uses the following interface:

```tsx
type LogFn = {
  <T extends object>(obj: T, msg?: string, ...args: unknown[]): void;
  (obj: unknown, msg?: string, ...args: unknown[]): void;
  (msg: string, ...args: unknown[]): void;
};

/**
 * @name Logger
 * @description Logger interface for logging messages
 */
export interface Logger {
  info: LogFn;
  error: LogFn;
  warn: LogFn;
  debug: LogFn;
  fatal: LogFn;
}
```

Using the logger:

```tsx
import { getLogger } from '@kit/shared/logger';

async function fetchNotes() {
    const logger = await getLogger();

    const ctx = {
        name: 'notes', // use a meaningful name
        userId: user.id, // use the authenticated user's ID
    };

    logger.info(ctx, 'Request started...');

    const { data, error } = await supabase.from('notes').select('*');

    if (error) {
        logger.error({ ...ctx, error }, 'Request failed...');
    // handle error
    } else {
        logger.info(ctx, 'Request succeeded...');
    // use data
    }
}
```
