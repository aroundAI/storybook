# Testing Guide

This repository uses **Vitest 3.2.4** for unit and integration testing with comprehensive coverage across packages.

## Overview

**Current Status** (as of 2025-10-19):
- ✅ Test infrastructure: 100% complete
- ✅ CI/CD integration: GitHub Actions configured
- ✅ Tests passing: 62 tests across 2 packages
- 📊 Coverage: Foundation established, ~80 test files remaining

**Configured Packages**:
- ✅ @kit/branding
- ✅ @kit/next
- ✅ @kit/llm
- ✅ @kit/cache (pre-existing)

**See also**: `apps/web/CLAUDE.md` for web-specific testing patterns.

## Quick Commands

```bash
# Run all tests for web app
pnpm --filter web test

# Run tests for specific package
pnpm --filter @kit/branding test
pnpm --filter @kit/next test
pnpm --filter @kit/cache test

# Run with coverage report
pnpm --filter web test:coverage

# Run with interactive UI
pnpm --filter web test:ui

# Watch mode (auto-run on file changes)
pnpm --filter web test
```

## Test Infrastructure

**Locations**:
- `apps/web/vitest.config.ts` - React component testing (happy-dom)
- `apps/web/vitest.setup.ts` - Next.js mocks and test setup
- `apps/web/test/` - Web app test files
- `packages/*/vitest.config.ts` - Package-specific configs
- `packages/*/__tests__/` - Package test files

## Writing Tests

### Test File Naming Convention

```bash
# Unit tests (pure functions, utilities)
packages/my-package/__tests__/utils.test.ts

# Integration tests (server actions, API routes)
apps/web/app/api/__tests__/route.test.ts

# Feature tests (complex features)
packages/features/my-feature/__tests__/mutations.test.ts
```

### Basic Test Structure

```typescript
import { describe, expect, it } from 'vitest';
import { functionToTest } from '../src/function';

describe('Feature Name', () => {
  describe('functionToTest', () => {
    it('should handle valid inputs', () => {
      const result = functionToTest(validInput);
      expect(result).toBe(expectedOutput);
    });

    it('should handle invalid inputs', () => {
      expect(() => functionToTest(invalidInput)).toThrow();
    });

    it('should handle edge cases', () => {
      expect(functionToTest(null)).toBeNull();
      expect(functionToTest(undefined)).toBeUndefined();
      expect(functionToTest('')).toBe('');
    });
  });
});
```

### Mocking Patterns

**Next.js Navigation**:
```typescript
import { vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
```

**Server-Only Module**:
```typescript
// vitest.config.ts
resolve: {
  alias: {
    'server-only': './src/__mocks__/server-only.ts'
  }
}

// src/__mocks__/server-only.ts
export {};
```

**Supabase Client** (to be implemented):
```typescript
vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    })),
  })),
}));
```

## Test Categories

### 1. Utility Functions (Pure Functions)

**What to test**:
- Color utilities (hex validation, WCAG contrast)
- String formatting (currency, dates)
- Validation functions
- Calculation algorithms

**Example** (packages/branding/__tests__/color-utils.test.ts):
```typescript
describe('hexToRgb', () => {
  it('should convert valid hex to RGB', () => {
    expect(hexToRgb('#FF0000')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('should return null for invalid hex', () => {
    expect(hexToRgb('#GGGGGG')).toBeNull();
  });
});
```

### 2. Server Actions

**What to test**:
- Schema validation
- Authentication enforcement
- Error handling
- Return value correctness

**Example** (packages/next/__tests__/enhance-action.test.ts):
```typescript
describe('enhanceAction', () => {
  it('should validate input with schema', async () => {
    const action = enhanceAction(mockFn, {
      schema: TestSchema,
      auth: false,
    });

    const result = await action({ name: 'John', age: 30 });
    expect(mockFn).toHaveBeenCalledWith({ name: 'John', age: 30 }, undefined);
  });
});
```

### 3. Provider Abstractions

**What to test**:
- Factory pattern (singleton behavior)
- Provider switching
- Configuration loading from env
- Error handling for missing config

**Example** (to be implemented - @kit/llm):
```typescript
describe('createLLMClient', () => {
  it('should create client from environment variables', () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';

    const client = createLLMClient();
    expect(client).toBeDefined();
  });

  it('should return singleton instance', () => {
    const client1 = createLLMClient();
    const client2 = createLLMClient();
    expect(client1).toBe(client2);
  });
});
```

### 4. Business Logic

**What to test**:
- Permission checks
- Validation logic
- State transitions
- Edge cases and error conditions

**Example** (to be implemented - @kit/projects):
```typescript
describe('hasProjectRole', () => {
  it('should return true when user has role', async () => {
    const hasRole = await hasProjectRole('project-id', 'user-id', 'owner');
    expect(hasRole).toBe(true);
  });

  it('should return false when user lacks role', async () => {
    const hasRole = await hasProjectRole('project-id', 'user-id', 'admin');
    expect(hasRole).toBe(false);
  });
});
```

## Adding Tests to New Packages

**Step 1: Add vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // or 'happy-dom' for React components
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', '**/*.test.ts', '**/*.config.ts'],
    },
  },
});
```

**Step 2: Update package.json**

```json
{
  "scripts": {
    "test": "vitest",
    "test:coverage": "vitest --coverage"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  }
}
```

**Step 3: Create test file**

```bash
mkdir -p packages/my-package/__tests__
touch packages/my-package/__tests__/feature.test.ts
```

**Step 4: Write tests**

Follow the patterns in existing test files:
- `packages/branding/__tests__/color-utils.test.ts` (utility functions)
- `packages/next/__tests__/enhance-action.test.ts` (server actions)
- `packages/cache/src/__tests__/factory.test.ts` (factory pattern)

**Step 5: Run tests**

```bash
pnpm install --filter @my/package
pnpm --filter @my/package test
```

## CI/CD Integration

Tests run automatically in GitHub Actions on:
- **Pull requests** to main branch
- **Pushes** to main branch

**Workflow**: `.github/workflows/workflow.yml`

```yaml
unit-test:
  name: 🧪 Unit Tests
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
    - run: pnpm install
    - run: pnpm --filter web test
    - run: pnpm --filter web test:coverage
    - uses: actions/upload-artifact@v4
      with:
        name: coverage-report
        path: apps/web/coverage/
```

## Coverage Targets

**Goals**:
- **Core utilities**: 90%+ (branding, cache, shared)
- **Business logic**: 85%+ (billing, auth, teams, projects)
- **API routes**: 80%+
- **Server actions**: 80%+
- **Overall target**: 75%+

## Best Practices

**DO**:
- ✅ Test pure functions thoroughly
- ✅ Test edge cases and error conditions
- ✅ Mock external services (Supabase, Redis, APIs)
- ✅ Use descriptive test names
- ✅ Test real-world scenarios
- ✅ Run tests before committing
- ✅ Add tests for new features

**DON'T**:
- ❌ Test implementation details
- ❌ Hit real APIs in tests
- ❌ Write tests that depend on external state
- ❌ Skip tests with `.skip()` without good reason
- ❌ Commit failing tests
- ❌ Mock everything (test real code when possible)

## Troubleshooting

**Problem**: `Cannot find module 'server-only'`
**Solution**: Add alias in vitest.config.ts (see "Server-Only Module" above)

**Problem**: Tests timeout
**Solution**: Increase timeout in vitest.config.ts or individual tests:
```typescript
it('slow test', async () => {
  // Test code
}, { timeout: 10000 }); // 10 seconds
```

**Problem**: Mock not working
**Solution**: Ensure mock is defined before importing the module:
```typescript
vi.mock('./module'); // Must be at top of file
import { function } from './module';
```

## Next Session Roadmap

**Priority order**:
1. @kit/llm (factory, pricing, providers) - 5 files
2. @kit/billing (webhook verification) - 4 files
3. @kit/prompt-engine (validation, loader, executor) - 3 files
4. @kit/projects (permissions, mutations) - 4 files
5. @kit/team-accounts (invitations, billing) - 6 files
6. Remaining packages - 56 files

**Estimated effort**: 30-40 hours for complete coverage

**Reference implementations**:
- ✅ `packages/branding/__tests__/color-utils.test.ts` (41 tests)
- ✅ `packages/next/__tests__/enhance-action.test.ts` (21 tests)
