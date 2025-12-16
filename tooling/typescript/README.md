# @kit/tsconfig

![Complexity: Simple](https://img.shields.io/badge/complexity-simple-green)

## Overview

Shared TypeScript configuration for all packages in the StoryBook monorepo. Provides consistent TypeScript settings optimized for Next.js, React, and Node.js development.

## Purpose

This package provides:
- **Consistent TypeScript settings**: Unified configuration across all packages
- **Next.js optimization**: Optimized for Next.js development
- **Strict type checking**: Enhanced type safety and error detection
- **Modern JavaScript features**: Support for latest ECMAScript features
- **Path mapping**: Simplified import paths with aliases
- **Monorepo support**: Optimized for workspace development

## Installation

```bash
pnpm add -D @kit/tsconfig
```

## Package Dependencies

### Packages that use this:
- [dev-tool](../../apps/dev-tool)
- [web](../../apps/web)
- [@kit/analytics](../../packages/analytics)
- [@kit/billing](../../packages/billing/core)
- [@kit/billing-gateway](../../packages/billing/gateway)
- [@kit/lemon-squeezy](../../packages/billing/lemon-squeezy)
- [@kit/stripe](../../packages/billing/stripe)
- [@kit/cms](../../packages/cms/core)
- [@kit/keystatic](../../packages/cms/keystatic)
- [@kit/cms-types](../../packages/cms/types)
- [@kit/wordpress](../../packages/cms/wordpress)
- [@kit/database-webhooks](../../packages/database-webhooks)
- [@kit/email-templates](../../packages/email-templates)
- [@kit/accounts](../../packages/features/accounts)
- [@kit/admin](../../packages/features/admin)
- [@kit/auth](../../packages/features/auth)
- [@kit/notifications](../../packages/features/notifications)
- [@kit/team-accounts](../../packages/features/team-accounts)
- [@kit/i18n](../../packages/i18n)
- [@kit/mailers](../../packages/mailers/core)
- [@kit/nodemailer](../../packages/mailers/nodemailer)
- [@kit/resend](../../packages/mailers/resend)
- [@kit/mailers-shared](../../packages/mailers/shared)
- [@kit/mcp-server](../../packages/mcp-server)
- [@kit/monitoring](../../packages/monitoring/api)
- [@kit/monitoring-core](../../packages/monitoring/core)
- [@kit/sentry](../../packages/monitoring/sentry)
- [@kit/next](../../packages/next)
- [@kit/otp](../../packages/otp)
- [@kit/shared](../../packages/shared)
- [@kit/supabase](../../packages/supabase)
- [@kit/ui](../../packages/ui)
- [@kit/eslint-config](../eslint)
- [@kit/prettier-config](../prettier)

## Project Structure

```
tooling/typescript/
├── src/           # Source code
├── package.json   # Package configuration
├── tsconfig.json  # TypeScript configuration
└── README.md      # This file```

## Contributing

When making changes to this package:

1. Follow the existing code style and patterns
2. Update tests if applicable
3. Run `pnpm lint` and `pnpm typecheck` before committing
4. Update this README if adding new features or changing behavior

---

*Generated on 9/20/2025*
