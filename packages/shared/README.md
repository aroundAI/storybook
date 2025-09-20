# @kit/shared

Core shared utilities, types, and helpers used across the entire application, providing essential functionality for logging, error handling, utilities, and common patterns.

## Purpose

This package provides foundational utilities including:
- Structured logging with Pino
- Error handling and custom error types
- CSRF token management
- Environment variable utilities
- Common TypeScript types and interfaces
- Utility functions for strings, dates, and data manipulation
- React hooks for cross-cutting concerns

## Installation

```bash
pnpm add @kit/shared
```

## Logging

### Basic Usage

```typescript
import { getLogger } from '@kit/shared/logger';

async function performOperation() {
  const logger = await getLogger();

  // Log with context
  const ctx = {
    operation: 'user-signup',
    userId: '123',
    email: 'user@example.com'
  };

  logger.info(ctx, 'Starting user signup');

  try {
    // Perform operation
    const result = await signUpUser();

    logger.info({ ...ctx, result }, 'User signup successful');
    return result;
  } catch (error) {
    logger.error({ ...ctx, error }, 'User signup failed');
    throw error;
  }
}
```

### Log Levels

```typescript
const logger = await getLogger();

// Different log levels
logger.trace('Detailed trace information');
logger.debug('Debug information');
logger.info('Informational message');
logger.warn('Warning message');
logger.error('Error message');
logger.fatal('Fatal error message');
```

### Structured Logging

```typescript
// Log with structured data
logger.info({
  event: 'payment_processed',
  userId: user.id,
  amount: 99.99,
  currency: 'USD',
  paymentMethod: 'card',
  timestamp: Date.now()
}, 'Payment processed successfully');

// Child logger with persistent context
const userLogger = logger.child({ userId: user.id });
userLogger.info('User action performed'); // Always includes userId
```

### Performance Logging

```typescript
const logger = await getLogger();

// Log operation duration
const startTime = Date.now();

// Perform operation
await performExpensiveOperation();

logger.info({
  operation: 'expensive_operation',
  duration: Date.now() - startTime,
  success: true
}, 'Operation completed');
```

## Error Handling

### Custom Error Types

```typescript
import {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError
} from '@kit/shared/errors';

// Application error with context
throw new AppError({
  code: 'OPERATION_FAILED',
  message: 'Failed to process request',
  statusCode: 500,
  context: {
    userId: user.id,
    operation: 'data_processing'
  }
});

// Validation error
throw new ValidationError({
  code: 'INVALID_INPUT',
  message: 'Invalid email format',
  field: 'email',
  value: userInput.email
});

// Authentication error
throw new AuthenticationError({
  code: 'INVALID_CREDENTIALS',
  message: 'Invalid username or password'
});

// Authorization error
throw new AuthorizationError({
  code: 'INSUFFICIENT_PERMISSIONS',
  message: 'You do not have permission to perform this action',
  requiredPermission: 'admin.write'
});

// Not found error
throw new NotFoundError({
  code: 'RESOURCE_NOT_FOUND',
  message: 'User not found',
  resourceType: 'user',
  resourceId: userId
});

// Conflict error
throw new ConflictError({
  code: 'RESOURCE_EXISTS',
  message: 'Email already in use',
  conflictingField: 'email'
});

// Rate limit error
throw new RateLimitError({
  code: 'RATE_LIMIT_EXCEEDED',
  message: 'Too many requests',
  retryAfter: 60 // seconds
});
```

### Error Utilities

```typescript
import {
  isAppError,
  getErrorMessage,
  serializeError
} from '@kit/shared/errors';

try {
  await riskyOperation();
} catch (error) {
  // Check if it's an app error
  if (isAppError(error)) {
    logger.error({
      code: error.code,
      statusCode: error.statusCode,
      context: error.context
    }, error.message);
  }

  // Get safe error message
  const message = getErrorMessage(error);

  // Serialize error for logging
  const serialized = serializeError(error);
  logger.error(serialized, 'Operation failed');
}
```

## CSRF Protection

### Using CSRF Token Hook

```typescript
'use client';
import { useCsrfToken } from '@kit/shared/hooks/use-csrf-token';

function ProtectedForm() {
  const csrfToken = useCsrfToken();

  const handleSubmit = async (data: FormData) => {
    const response = await fetch('/api/protected', {
      method: 'POST',
      headers: {
        'X-CSRF-Token': csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error('Request failed');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input type="hidden" name="csrf_token" value={csrfToken} />
      {/* Form fields */}
    </form>
  );
}
```

### Verifying CSRF Token (Server)

```typescript
import { verifyCsrfToken } from '@kit/shared/csrf';

export async function POST(request: Request) {
  const token = request.headers.get('X-CSRF-Token');

  if (!verifyCsrfToken(token)) {
    return new Response('Invalid CSRF token', { status: 403 });
  }

  // Process protected request
}
```

## Environment Variables

### Safe Environment Access

```typescript
import { getEnv, requireEnv } from '@kit/shared/env';

// Get optional environment variable
const apiUrl = getEnv('API_URL', 'https://api.example.com'); // With default

// Require environment variable (throws if missing)
const databaseUrl = requireEnv('DATABASE_URL');

// Type-safe environment variables
const port = getEnv('PORT', '3000', 'number') as number;
const isProduction = getEnv('NODE_ENV') === 'production';
```

### Environment Validation

```typescript
import { validateEnv } from '@kit/shared/env';

// Validate all required environment variables at startup
validateEnv({
  DATABASE_URL: 'string',
  REDIS_URL: 'string',
  API_KEY: 'string',
  PORT: 'number',
  ENABLE_FEATURE: 'boolean'
});
```

## Utility Functions

### String Utilities

```typescript
import {
  capitalize,
  slugify,
  truncate,
  isEmail,
  isUrl
} from '@kit/shared/utils/string';

// Capitalize first letter
const title = capitalize('hello world'); // 'Hello world'

// Create URL-safe slug
const slug = slugify('My Blog Post!'); // 'my-blog-post'

// Truncate text
const excerpt = truncate('Long text...', 100); // Truncated to 100 chars

// Validate email
if (isEmail('user@example.com')) {
  // Valid email
}

// Validate URL
if (isUrl('https://example.com')) {
  // Valid URL
}
```

### Date Utilities

```typescript
import {
  formatDate,
  formatRelativeTime,
  addDays,
  isAfter,
  isBefore
} from '@kit/shared/utils/date';

// Format date
const formatted = formatDate(new Date(), 'MMM dd, yyyy'); // 'Jan 15, 2024'

// Relative time
const relative = formatRelativeTime(new Date()); // '2 hours ago'

// Date manipulation
const nextWeek = addDays(new Date(), 7);

// Date comparison
if (isAfter(date1, date2)) {
  // date1 is after date2
}
```

### Data Utilities

```typescript
import {
  pick,
  omit,
  groupBy,
  chunk,
  debounce,
  throttle
} from '@kit/shared/utils/data';

// Pick specific properties
const subset = pick(user, ['id', 'name', 'email']);

// Omit properties
const withoutPassword = omit(user, ['password']);

// Group array by property
const grouped = groupBy(users, 'role');

// Split array into chunks
const pages = chunk(items, 10); // 10 items per page

// Debounce function
const debouncedSearch = debounce(search, 300);

// Throttle function
const throttledScroll = throttle(handleScroll, 100);
```

## Type Definitions

### Common Types

```typescript
import type {
  Nullable,
  Optional,
  ValueOf,
  DeepPartial,
  DeepReadonly
} from '@kit/shared/types';

// Nullable type
type UserOrNull = Nullable<User>; // User | null

// Optional properties
type PartialUser = Optional<User, 'email' | 'phone'>;

// Value of object
type UserRole = ValueOf<typeof USER_ROLES>;

// Deep partial
type PartialSettings = DeepPartial<Settings>;

// Deep readonly
type ImmutableConfig = DeepReadonly<Config>;
```

### API Types

```typescript
import type {
  ApiResponse,
  ApiError,
  PaginatedResponse,
  SortOrder
} from '@kit/shared/types';

// API response wrapper
type UserResponse = ApiResponse<User>;
// { success: true; data: User } | { success: false; error: ApiError }

// Paginated response
type UsersPage = PaginatedResponse<User>;
// { items: User[]; total: number; page: number; pageSize: number }

// Sort order
const sortOrder: SortOrder = 'asc'; // 'asc' | 'desc'
```

## React Utilities

### Common Hooks

```typescript
import {
  useDebounce,
  useThrottle,
  usePrevious,
  useInterval,
  useTimeout,
  useLocalStorage,
  useMediaQuery
} from '@kit/shared/hooks';

// Debounced value
const debouncedSearchTerm = useDebounce(searchTerm, 500);

// Throttled value
const throttledScrollPosition = useThrottle(scrollY, 100);

// Previous value
const previousCount = usePrevious(count);

// Interval
useInterval(() => {
  fetchData();
}, 5000); // Every 5 seconds

// Timeout
useTimeout(() => {
  showNotification();
}, 3000); // After 3 seconds

// Local storage
const [theme, setTheme] = useLocalStorage('theme', 'light');

// Media query
const isMobile = useMediaQuery('(max-width: 768px)');
```

## Constants

```typescript
import {
  HTTP_STATUS,
  ERROR_CODES,
  DATE_FORMATS,
  REGEX_PATTERNS
} from '@kit/shared/constants';

// HTTP status codes
if (response.status === HTTP_STATUS.NOT_FOUND) {
  // Handle 404
}

// Error codes
throw new AppError({
  code: ERROR_CODES.VALIDATION_ERROR,
  message: 'Invalid input'
});

// Date formats
const formatted = format(date, DATE_FORMATS.SHORT); // 'MM/dd/yyyy'

// Regex patterns
if (REGEX_PATTERNS.EMAIL.test(input)) {
  // Valid email
}
```

## Testing Utilities

```typescript
import {
  createMockLogger,
  createMockUser,
  createMockRequest,
  waitFor
} from '@kit/shared/testing';

// Mock logger for tests
const logger = createMockLogger();

// Mock user
const user = createMockUser({
  email: 'test@example.com'
});

// Mock request
const request = createMockRequest({
  method: 'POST',
  body: { test: 'data' }
});

// Wait for condition
await waitFor(() => {
  return element.textContent === 'Loaded';
}, { timeout: 5000 });
```

## Best Practices

1. **Always use structured logging** with context objects
2. **Handle errors gracefully** with appropriate error types
3. **Validate environment variables** at application startup
4. **Use type-safe utilities** to prevent runtime errors
5. **Implement CSRF protection** for state-changing operations
6. **Debounce/throttle** expensive operations
7. **Use constants** instead of magic strings/numbers

## Package Dependencies

### External
- `pino`: High-performance logging
- `date-fns`: Date manipulation
- `zod`: Schema validation

### Internal
None - this is a foundational package

### Packages that use this:
- All packages in the monorepo depend on @kit/shared

## Contributing

When making changes to this package:

1. Maintain backward compatibility (widely used)
2. Add tests for new utilities
3. Document new functions with JSDoc
4. Run `pnpm typecheck` before committing
5. Consider performance implications

---

*Updated on 9/20/2025*