# Development Scripts

![Complexity: Simple](https://img.shields.io/badge/complexity-simple-green)

## Overview

Collection of development and deployment scripts for the StoryBook monorepo. Provides automation for common tasks like database management, deployment, and development workflows.

## Purpose

This package provides:
- **Database automation**: Migration and seeding scripts
- **Deployment automation**: Build and deployment workflows
- **Development utilities**: Setup and maintenance scripts
- **Code generation**: Automated code scaffolding
- **Monorepo management**: Cross-package operations
- **CI/CD helpers**: Automation for continuous integration

## Available Scripts

### `dev`
```bash
pnpm --filter scripts dev
```
Starts the development server with hot reloading

## Installation

```bash
pnpm add scripts
```

## Code Statistics

- **Total Files**: 6
- **Total Lines**: 519

## Project Structure

```
tooling/scripts/
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
