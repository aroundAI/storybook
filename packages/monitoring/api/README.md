# @kit/monitoring

![Complexity: Simple](https://img.shields.io/badge/complexity-simple-green)

## Overview

The `@kit/monitoring` package provides a unified interface for application monitoring and error tracking across your Next.js application. It supports pluggable monitoring providers with built-in support for Sentry, allowing you to track errors, performance, and user interactions.

## Purpose

This package offers:
- **Provider-agnostic monitoring**: Easily switch between monitoring services
- **React integration**: Hooks and components for client-side monitoring
- **Server-side monitoring**: Services for tracking server-side errors and events
- **Error boundaries**: Built-in error boundary components
- **Exception capturing**: Automatic and manual error reporting

## Technology Stack

- **React 19**: Client-side hooks and components
- **TypeScript**: Full type safety
- **Zod**: Schema validation
- **Sentry**: Default monitoring provider
- **Next.js**: Server and client-side support

## Installation

```bash
pnpm add @kit/monitoring
```

## Configuration

Set the monitoring provider via environment variable:

```bash
# .env.local
MONITORING_PROVIDER=sentry
```

Supported providers:
- `sentry` - Sentry monitoring service
- `undefined` - Console-only monitoring (development)

## Usage

### Client-Side Monitoring

#### Setting up the Provider

Wrap your application with the monitoring provider:

```typescript
import { MonitoringProvider } from '@kit/monitoring/components';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <MonitoringProvider>
          {children}
        </MonitoringProvider>
      </body>
    </html>
  );
}
```

#### Using Monitoring Hooks

##### `useMonitoring`

Access the monitoring service instance:

```typescript
import { useMonitoring } from '@kit/monitoring/hooks';

function MyComponent() {
  const monitoring = useMonitoring();

  const handleAction = async () => {
    try {
      await someRiskyOperation();
    } catch (error) {
      await monitoring.captureException(error);
    }
  };

  return <button onClick={handleAction}>Perform Action</button>;
}
```

##### `useCaptureException`

Automatically capture exceptions:

```typescript
import { useCaptureException } from '@kit/monitoring/hooks';

function ErrorComponent({ error }: { error: Error }) {
  // Automatically reports the error to your monitoring service
  useCaptureException(error);

  return <div>Something went wrong!</div>;
}
```

#### Error Boundary

Use the built-in error boundary to catch React errors:

```typescript
import { ErrorBoundary } from '@kit/monitoring/components';

function App() {
  return (
    <ErrorBoundary fallback={<ErrorFallback />}>
      <MyComponent />
    </ErrorBoundary>
  );
}

function ErrorFallback() {
  return <div>Application error occurred</div>;
}
```

### Server-Side Monitoring

#### Getting the Monitoring Service

For server-side code (API routes, server actions):

```typescript
import { getServerMonitoringService } from '@kit/monitoring/server';

export async function POST(request: Request) {
  const monitoring = await getServerMonitoringService();

  try {
    // Your API logic here
    return Response.json({ success: true });
  } catch (error) {
    await monitoring.captureException(error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

#### Server Actions

```typescript
import { getServerMonitoringService } from '@kit/monitoring/server';

export async function createUser(formData: FormData) {
  const monitoring = await getServerMonitoringService();

  try {
    // Create user logic
    return { success: true };
  } catch (error) {
    await monitoring.captureException(error);
    throw error;
  }
}
```

### Instrumentation

For Next.js instrumentation (recommended for Sentry):

```typescript
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('@kit/monitoring/instrumentation');
  }
}
```

## API Reference

### Hooks

#### `useMonitoring()`

Returns the monitoring service instance.

**Returns**: `MonitoringService`

**Methods**:
- `captureException(error: Error): Promise<void>` - Report an error
- `captureMessage(message: string, level?: string): Promise<void>` - Log a message
- `setUser(user: { id: string; email?: string }): void` - Set user context

#### `useCaptureException(error: Error)`

Automatically reports an error when the component mounts or error changes.

**Parameters**:
- `error: Error` - The error to report

### Components

#### `MonitoringProvider`

Provides monitoring context to child components.

**Props**: `React.PropsWithChildren`

#### `ErrorBoundary`

Catches and reports React errors.

**Props**:
- `children: React.ReactNode` - Child components
- `fallback: React.ComponentType` - Component to render on error

### Server Functions

#### `getServerMonitoringService()`

Returns the server-side monitoring service.

**Returns**: `Promise<MonitoringService>`

## Available Scripts

### Development

```bash
# Lint the package
pnpm --filter @kit/monitoring lint

# Type check
pnpm --filter @kit/monitoring typecheck

# Format code
pnpm --filter @kit/monitoring format
```

## Package Structure

```
packages/monitoring/api/
├── src/
│   ├── components/
│   │   ├── error-boundary.tsx    # React error boundary
│   │   ├── provider.tsx          # Monitoring provider
│   │   └── index.ts             # Component exports
│   ├── hooks/
│   │   ├── use-monitoring.ts     # Monitoring service hook
│   │   ├── use-capture-exception.ts # Error capture hook
│   │   └── index.ts             # Hook exports
│   ├── services/
│   │   └── get-server-monitoring-service.ts # Server service
│   ├── get-monitoring-provider.ts # Provider detection
│   ├── instrumentation.ts        # Next.js instrumentation
│   └── server.ts                # Server exports
├── package.json
├── tsconfig.json
└── README.md
```

## Dependencies

### Required Packages
- `@kit/monitoring-core` - Core monitoring interfaces
- `@kit/sentry` - Sentry implementation
- `@kit/shared` - Shared utilities
- `react` - React framework
- `zod` - Schema validation

### Used By
- `apps/web` - Main application
- `@kit/accounts` - Account features
- `@kit/team-accounts` - Team management
- `@kit/next` - Next.js utilities

## Best Practices

1. **Always wrap your app** with `MonitoringProvider`
2. **Use error boundaries** to catch React errors
3. **Capture exceptions** in async operations
4. **Set user context** after authentication
5. **Use server monitoring** in API routes and server actions
6. **Configure instrumentation** for full-stack tracking

## Environment Variables

```bash
# Required
MONITORING_PROVIDER=sentry

# Sentry-specific (if using Sentry)
SENTRY_DSN=your_sentry_dsn
SENTRY_ORG=your_org
SENTRY_PROJECT=your_project
```

## Contributing

When contributing to this package:

1. Follow the existing code patterns
2. Add tests for new features
3. Update TypeScript interfaces in `@kit/monitoring-core`
4. Run linting and type checking before committing
5. Update this README for new features

---

*Last updated: September 20, 2025*
