# @kit/sentry

![Complexity: Simple](https://img.shields.io/badge/complexity-simple-green)

## Overview

The `@kit/sentry` package provides a complete Sentry integration for Next.js applications. It implements the `@kit/monitoring-core` interface to deliver comprehensive error tracking, performance monitoring, and user session analysis through Sentry's powerful platform.

## Purpose

This package offers:
- **Complete Sentry integration**: Full-stack error tracking and performance monitoring
- **Next.js optimization**: Configured for both client and server-side monitoring
- **Automatic initialization**: Environment-aware client/server setup
- **User tracking**: Associate errors and events with user sessions
- **Performance insights**: Track application performance and bottlenecks

## Technology Stack

- **Sentry SDK**: Next.js-optimized Sentry package (`@sentry/nextjs`)
- **TypeScript**: Full type safety
- **React**: Client-side provider and context
- **Next.js**: Server and client-side instrumentation

## Installation

```bash
pnpm add @kit/sentry
```

## Configuration

### Environment Variables

Add these environment variables to your `.env.local`:

```bash
# Required
SENTRY_DSN=https://your-dsn@sentry.io/project-id

# Optional
NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
SENTRY_ORG=your-organization
SENTRY_PROJECT=your-project
SENTRY_AUTH_TOKEN=your-auth-token

# Sentry configuration
SENTRY_DISABLE_SERVER_WEBPACK_PLUGIN=1  # Optional: disable webpack plugin
SENTRY_HIDE_SOURCE_MAPS=true           # Optional: hide source maps
```

### Sentry Configuration Files

The package provides separate configurations for client and server:

```typescript
// sentry.client.config.ts
import { initializeSentryBrowserClient } from '@kit/sentry/config/client';

initializeSentryBrowserClient({
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
});
```

```typescript
// sentry.server.config.ts
import { initializeSentryServerClient } from '@kit/sentry/config/server';

initializeSentryServerClient({
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
});
```

## Usage

### Provider Setup

Wrap your application with the Sentry provider:

```typescript
import { SentryProvider } from '@kit/sentry/provider';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <SentryProvider>
          {children}
        </SentryProvider>
      </body>
    </html>
  );
}
```

### Direct Service Usage

Use the Sentry service directly:

```typescript
import { SentryMonitoringService } from '@kit/sentry';

const sentry = new SentryMonitoringService();

// Wait for initialization
await sentry.ready();

// Capture exceptions
try {
  await riskyOperation();
} catch (error) {
  sentry.captureException(error);
}

// Track events
sentry.captureEvent('user_action', {
  action: 'button_click',
  button_id: 'checkout',
});

// Identify users
sentry.identifyUser({
  id: 'user123',
  email: 'user@example.com',
  username: 'johndoe',
});
```

### Integration with Monitoring System

Use through the monitoring system for provider-agnostic code:

```typescript
import { getServerMonitoringService } from '@kit/monitoring/server';

export async function POST(request: Request) {
  const monitoring = await getServerMonitoringService();

  try {
    // Your API logic
    return Response.json({ success: true });
  } catch (error) {
    // Automatically uses Sentry if MONITORING_PROVIDER=sentry
    await monitoring.captureException(error, {
      request_id: request.headers.get('x-request-id'),
      endpoint: '/api/users',
    });

    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
```

### Client-Side Error Tracking

```typescript
import { useMonitoring } from '@kit/monitoring/hooks';

function MyComponent() {
  const monitoring = useMonitoring();

  const handleError = async (error: Error) => {
    await monitoring.captureException(error, {
      component: 'MyComponent',
      user_action: 'form_submit',
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Your form */}
    </form>
  );
}
```

## API Reference

### SentryMonitoringService

The main service class implementing the monitoring interface.

#### Constructor

```typescript
new SentryMonitoringService()
```

Automatically initializes Sentry based on the environment (client or server).

#### Methods

##### `ready(): Promise<unknown>`

Returns a promise that resolves when Sentry is fully initialized.

```typescript
await sentry.ready();
console.log('Sentry is ready for use');
```

##### `captureException(error, extra?, config?)`

Captures and reports exceptions to Sentry.

```typescript
sentry.captureException(error, {
  userId: '123',
  feature: 'checkout',
}, {
  tags: { priority: 'high' }
});
```

##### `captureEvent(event, extra?)`

Tracks custom events and metrics.

```typescript
sentry.captureEvent('user_signup', {
  plan: 'premium',
  source: 'landing_page',
  timestamp: Date.now(),
});
```

##### `identifyUser(user)`

Associates subsequent events with a user.

```typescript
sentry.identifyUser({
  id: 'user123',
  email: 'user@example.com',
  username: 'johndoe',
  subscription: 'premium',
});
```

### Configuration Functions

#### `initializeSentryBrowserClient(options)`

Initializes Sentry for client-side usage.

**Options:**
- `environment?: string` - Environment name (development, staging, production)

#### `initializeSentryServerClient(options)`

Initializes Sentry for server-side usage.

**Options:**
- `environment?: string` - Environment name (development, staging, production)

## Advanced Configuration

### Custom Sentry Configuration

Override default Sentry settings:

```typescript
// sentry.client.config.ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,

  // Custom configuration
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  beforeSend(event) {
    // Filter or modify events before sending
    if (event.exception) {
      // Custom filtering logic
      return event;
    }
    return event;
  },

  integrations: [
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],
});
```

### Performance Monitoring

Enable performance tracking:

```typescript
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig = {
  // Your Next.js config
};

export default withSentryConfig(nextConfig, {
  // Sentry webpack plugin options
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
});
```

### Source Maps

Configure source map uploads:

```javascript
// next.config.js
const withSentryConfig = require('@sentry/nextjs').withSentryConfig;

const nextConfig = {
  // Your config
};

const sentryWebpackPluginOptions = {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload source maps
  include: '.next',
  ignore: ['node_modules'],

  // Hide source maps from public
  hideSourceMaps: true,
};

module.exports = withSentryConfig(nextConfig, sentryWebpackPluginOptions);
```

## Available Scripts

### Development

```bash
# Lint the package
pnpm --filter @kit/sentry lint

# Type check
pnpm --filter @kit/sentry typecheck

# Format code
pnpm --filter @kit/sentry format
```

## Package Structure

```
packages/monitoring/sentry/
├── src/
│   ├── components/
│   │   └── provider.tsx                    # React provider
│   ├── services/
│   │   └── sentry-monitoring.service.ts    # Main service
│   ├── sentry.client.config.ts             # Client configuration
│   ├── sentry.server.config.ts             # Server configuration
│   └── index.ts                            # Package exports
├── package.json                            # Package configuration
├── tsconfig.json                           # TypeScript configuration
└── README.md                               # This documentation
```

## Dependencies

### Required Packages
- `@sentry/nextjs` - Sentry SDK for Next.js
- `@kit/monitoring-core` - Monitoring interface
- `react` - React framework
- `import-in-the-middle` - ESM import handling

### Used By
- `@kit/monitoring` - Main monitoring package
- `apps/web` - Main application

## Environment-Specific Setup

### Development

```bash
# .env.local
SENTRY_DSN=https://your-dev-dsn@sentry.io/project-id
NEXT_PUBLIC_SENTRY_ENVIRONMENT=development
```

### Production

```bash
# .env.production
SENTRY_DSN=https://your-prod-dsn@sentry.io/project-id
NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
SENTRY_ORG=your-organization
SENTRY_PROJECT=your-project
SENTRY_AUTH_TOKEN=your-auth-token
```

## Best Practices

1. **Use environment-specific DSNs**: Separate development and production projects
2. **Configure sample rates**: Balance between data collection and performance
3. **Filter sensitive data**: Use `beforeSend` to remove sensitive information
4. **Set up alerts**: Configure Sentry alerts for critical errors
5. **Use releases**: Tag deployments for better error tracking
6. **Enable performance monitoring**: Track web vitals and API performance

## Troubleshooting

### Common Issues

**Sentry not initializing:**
- Check DSN configuration
- Verify environment variables
- Ensure `ready()` is called before usage

**Source maps not uploading:**
- Verify auth token permissions
- Check organization and project names
- Ensure build output is included

**Too many events:**
- Adjust sample rates
- Use `beforeSend` for filtering
- Set up quota management

### Debug Mode

Enable debug logging:

```typescript
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  debug: process.env.NODE_ENV === 'development',
});
```

## Contributing

When contributing to this package:

1. **Test with real Sentry project**: Verify integrations work end-to-end
2. **Update configurations**: Keep client/server configs in sync
3. **Document breaking changes**: Update migration guides
4. **Follow Sentry best practices**: Stay current with SDK recommendations
5. **Test across environments**: Verify development and production setups

## Migration Guide

### From v0.0.x to v0.1.x

- Service now auto-initializes based on environment
- Provider setup simplified
- Configuration split into client/server files

---

*Last updated: September 20, 2025*
