# @kit/monitoring-core

![Complexity: Simple](https://img.shields.io/badge/complexity-simple-green)

## Overview

The `@kit/monitoring-core` package provides the foundational interfaces and base implementations for the monitoring system. It defines the contract that all monitoring providers must implement, ensuring a consistent API across different monitoring services like Sentry, LogRocket, or custom solutions.

## Purpose

This package serves as the core abstraction layer for monitoring, providing:
- **Abstract service interface**: Defines the contract for monitoring providers
- **Console fallback**: Basic console-based monitoring for development
- **React context**: Shared context for client-side monitoring
- **Type safety**: Full TypeScript support for monitoring operations

## Technology Stack

- **TypeScript**: Full type safety and interfaces
- **React**: Context provider for client-side integration
- **Abstract classes**: Extensible monitoring service pattern

## Installation

```bash
pnpm add @kit/monitoring-core
```

## Core Concepts

### MonitoringService Abstract Class

The base class that all monitoring providers must extend:

```typescript
import { MonitoringService } from '@kit/monitoring-core';

export abstract class MonitoringService {
  // Capture and report exceptions
  abstract captureException<Extra, Config>(
    error: Error & { digest?: string },
    extra?: Extra,
    config?: Config,
  ): unknown;

  // Track custom events
  abstract captureEvent<Extra extends object>(
    event: string,
    extra?: Extra,
  ): unknown;

  // Identify users for tracking
  abstract identifyUser<Info extends { id: string }>(info: Info): unknown;

  // Wait for service initialization
  abstract ready(): Promise<unknown>;
}
```

### Console Monitoring Service

A development-friendly implementation that logs to console:

```typescript
import { ConsoleMonitoringService } from '@kit/monitoring-core';

const monitoring = new ConsoleMonitoringService();

// Logs to console: "[Console Monitoring] Caught exception: ..."
monitoring.captureException(new Error('Something went wrong'));

// Logs to console: "[Console Monitoring] Captured event: user_login"
monitoring.captureEvent('user_login', { userId: '123' });

// Logs to console: "[Console Monitoring] Identified user {id: '123'}"
monitoring.identifyUser({ id: '123', email: 'user@example.com' });
```

### Monitoring Context

React context for sharing monitoring service across components:

```typescript
import { MonitoringContext } from '@kit/monitoring-core';
import { useContext } from 'react';

function MyComponent() {
  const monitoring = useContext(MonitoringContext);

  const handleError = (error: Error) => {
    monitoring.captureException(error);
  };

  return <div>My Component</div>;
}
```

## API Reference

### MonitoringService Methods

#### `captureException(error, extra?, config?)`

Captures and reports exceptions to the monitoring service.

**Parameters:**
- `error: Error & { digest?: string }` - The error to capture
- `extra?: Record<string, unknown>` - Additional context data
- `config?: Record<string, unknown>` - Provider-specific configuration

**Returns:** `unknown` (provider-dependent)

**Example:**
```typescript
try {
  await riskyOperation();
} catch (error) {
  await monitoring.captureException(error, {
    userId: '123',
    action: 'data_fetch',
  });
}
```

#### `captureEvent(event, extra?)`

Tracks custom events and user interactions.

**Parameters:**
- `event: string` - Event name
- `extra?: object` - Additional event data

**Returns:** `unknown` (provider-dependent)

**Example:**
```typescript
monitoring.captureEvent('button_clicked', {
  buttonId: 'checkout',
  page: '/cart',
  timestamp: Date.now(),
});
```

#### `identifyUser(info)`

Associates monitoring data with a specific user.

**Parameters:**
- `info: { id: string } & Record<string, any>` - User information

**Returns:** `unknown` (provider-dependent)

**Example:**
```typescript
monitoring.identifyUser({
  id: '123',
  email: 'user@example.com',
  plan: 'premium',
});
```

#### `ready()`

Waits for the monitoring service to be fully initialized.

**Returns:** `Promise<unknown>`

**Example:**
```typescript
await monitoring.ready();
console.log('Monitoring service is ready');
```

## Implementation Examples

### Creating a Custom Provider

```typescript
import { MonitoringService } from '@kit/monitoring-core';

export class CustomMonitoringService extends MonitoringService {
  private apiKey: string;

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }

  async captureException(error: Error, extra?: object) {
    return fetch('/api/errors', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({ error: error.message, extra }),
    });
  }

  async captureEvent(event: string, extra?: object) {
    return fetch('/api/events', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({ event, extra }),
    });
  }

  identifyUser(info: { id: string }) {
    localStorage.setItem('monitoring_user', JSON.stringify(info));
  }

  async ready() {
    // Check if service is available
    const response = await fetch('/api/health');
    if (!response.ok) {
      throw new Error('Monitoring service unavailable');
    }
  }
}
```

### Using with React Context

```typescript
import { MonitoringContext, ConsoleMonitoringService } from '@kit/monitoring-core';

function App() {
  const monitoring = new ConsoleMonitoringService();

  return (
    <MonitoringContext.Provider value={monitoring}>
      <MyApp />
    </MonitoringContext.Provider>
  );
}
```

## Available Scripts

### Development

```bash
# Lint the package
pnpm --filter @kit/monitoring-core lint

# Type check
pnpm --filter @kit/monitoring-core typecheck

# Format code
pnpm --filter @kit/monitoring-core format
```

## Package Structure

```
packages/monitoring/core/
├── src/
│   ├── monitoring.service.ts        # Abstract base class
│   ├── console-monitoring.service.ts # Console implementation
│   ├── monitoring.context.ts        # React context
│   └── index.ts                     # Package exports
├── package.json                     # Package configuration
├── tsconfig.json                    # TypeScript configuration
└── README.md                        # This documentation
```

## Dependencies

### Required Packages
- `react` - React context support
- `@types/react` - React TypeScript definitions

### Used By
- `@kit/monitoring` - Main monitoring package
- `@kit/sentry` - Sentry monitoring implementation

## Best Practices

1. **Extend MonitoringService**: Always extend the abstract class for new providers
2. **Handle errors gracefully**: Monitoring shouldn't break your app
3. **Use TypeScript**: Leverage full type safety for method signatures
4. **Implement all methods**: Ensure complete interface implementation
5. **Test thoroughly**: Verify provider behavior in different scenarios

## Error Handling

The abstract class includes error digest support for Next.js error boundaries:

```typescript
// Error with digest (from Next.js error boundary)
const error = new Error('Database connection failed');
error.digest = 'abc123';

monitoring.captureException(error, {
  component: 'UserProfile',
  route: '/profile',
});
```

## Contributing

When contributing to this package:

1. **Maintain interface compatibility**: Don't break existing method signatures
2. **Add comprehensive JSDoc**: Document all public methods
3. **Update implementations**: Ensure ConsoleMonitoringService reflects changes
4. **Test integrations**: Verify changes work with existing providers
5. **Follow TypeScript best practices**: Use proper generic constraints

## Migration Guide

### From v0.0.x to v0.1.x

- Method signatures now support generic types for better type safety
- `captureException` now accepts optional digest property
- Context provider now defaults to `ConsoleMonitoringService`

---

*Last updated: September 20, 2025*
