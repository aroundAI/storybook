# Tailorist Web Application

![Complexity: Complex](https://img.shields.io/badge/complexity-complex-orange)

## Overview

The main SaaS web application built with Next.js 15 and the App Router. This is a multi-tenant SaaS platform supporting both personal accounts and team workspaces, with comprehensive authentication, billing, and feature management.

## Purpose

This application serves as the primary user interface for the SaaS platform, providing:
- **Multi-tenant architecture**: Personal and team account support
- **Authentication & authorization**: Complete auth flow with Supabase
- **Billing integration**: Stripe and LemonSqueezy payment processing
- **Admin interface**: Super admin functionality
- **Content management**: CMS integration for marketing content
- **Internationalization**: Multi-language support
- **Real-time features**: Notifications and live updates

## Technology Stack

- **Next.js 15**: React framework with App Router
- **React 19**: UI library with concurrent features
- **TypeScript**: Type-safe development
- **Tailwind CSS 4**: Utility-first styling
- **Supabase**: Database, auth, and real-time features
- **TanStack Query**: Server state management
- **Zod**: Schema validation
- **Radix UI**: Accessible component primitives
- **React Hook Form**: Form handling
- **i18next**: Internationalization
- **Lucide React**: Icon library

## Available Scripts

### `build`
```bash
pnpm --filter web build
```
Creates an optimized production build

### `dev`
```bash
pnpm --filter web dev
```
Starts the development server with hot reloading

### `lint`
```bash
pnpm --filter web lint
```
Checks code for style and potential errors

### `typecheck`
```bash
pnpm --filter web typecheck
```
Verifies TypeScript type correctness

## API Endpoints

- `/billing/webhook`
- `/db/webhook`

## Utilities

- `create-csp-response` - Utility function
- `database.types` - Utility function
- `dev-mock-modules` - Utility function
- `fonts` - Utility function
- `i18n.resolver` - Utility function
- `i18n.server` - Utility function
- `i18n.settings` - Utility function
- `root-metdata` - Utility function
- `root-theme` - Utility function
- `require-user-in-server-component` - Utility function

## Installation

This is an application package. To run it:

```bash
pnpm --filter web dev
```

## Package Dependencies

### This package depends on:
- [@kit/accounts](../../packages/features/accounts)
- [@kit/admin](../../packages/features/admin)
- [@kit/analytics](../../packages/analytics)
- [@kit/auth](../../packages/features/auth)
- [@kit/billing](../../packages/billing/core)
- [@kit/billing-gateway](../../packages/billing/gateway)
- [@kit/cms](../../packages/cms/core)
- [@kit/database-webhooks](../../packages/database-webhooks)
- [@kit/email-templates](../../packages/email-templates)
- [@kit/i18n](../../packages/i18n)
- [@kit/mailers](../../packages/mailers/core)
- [@kit/monitoring](../../packages/monitoring/api)
- [@kit/next](../../packages/next)
- [@kit/notifications](../../packages/features/notifications)
- [@kit/shared](../../packages/shared)
- [@kit/supabase](../../packages/supabase)
- [@kit/team-accounts](../../packages/features/team-accounts)
- [@kit/ui](../../packages/ui)

## Project Structure

```
apps/web/
├── src/           # Source code
│   └── utils/       # Utility functions
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
