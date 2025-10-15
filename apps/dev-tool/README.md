# Development Tool

![Complexity: Simple](https://img.shields.io/badge/complexity-simple-green)

## Overview

A development utility application for testing and showcasing components, features, and integrations during development. This tool provides a sandbox environment for developers to test new features without affecting the main application.

## Purpose

This development tool provides:

- **Component playground**: Test and showcase UI components
- **Feature testing**: Isolated environment for new feature development
- **Integration testing**: Test third-party service integrations
- **Design system documentation**: Visual component library
- **Development utilities**: Tools for debugging and development

## Technology Stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- React Query
- Zod
- React Hook Form

## Available Scripts

### `dev`

```bash
pnpm --filter dev-tool dev
```

Starts the development server with hot reloading

## Utilities

- `i18n.resolver` - Utility function
- `i18n.server` - Utility function
- `i18n.settings` - Utility function

## Installation

This is an application package. To run it:

```bash
pnpm --filter dev-tool dev
```

## Project Structure

````
apps/dev-tool/
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
````
