# @kit/prettier-config

![Complexity: Simple](https://img.shields.io/badge/complexity-simple-green)

## Overview

Shared Prettier configuration for consistent code formatting across the StoryBook monorepo. Ensures uniform code style for JavaScript, TypeScript, JSON, Markdown, and CSS files including Tailwind CSS class sorting.

## Purpose

This package provides:
- **Consistent formatting**: Unified code formatting across all packages
- **Multi-language support**: JavaScript, TypeScript, JSON, Markdown, CSS formatting
- **Tailwind CSS sorting**: Automatic Tailwind class organization
- **Team collaboration**: Eliminates code style debates
- **Automated formatting**: Integrates with editors and CI/CD
- **Best practices**: Follows industry-standard formatting conventions

## Technology Stack

- **Prettier**: Code formatting engine
- **TypeScript**: TypeScript formatting support
- **Tailwind CSS**: CSS class sorting plugin

## Available Scripts

### `typecheck`
```bash
pnpm --filter prettier-config typecheck
```
Verifies TypeScript type correctness

## Installation

```bash
pnpm add @kit/prettier-config
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

## Project Structure

```
tooling/prettier/
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
