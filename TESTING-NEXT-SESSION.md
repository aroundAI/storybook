# Testing Implementation - Next Session Roadmap

**Resume From**: 2025-10-19
**Completed So Far**: 9/21 TODO items (42.9%)
**Tests Passing**: 62 tests across 2 packages ✅
**Infrastructure**: 100% Complete ✅

---

## 🎯 QUICK START (Next Session)

### Option A: Continue Implementing Critical Tests (Recommended)

Pick up where we left off with the next critical test suite:

```bash
# Start here - implement @kit/llm tests
cd /Users/shaurya/Work/projects/base-saas

# Create test file
mkdir -p packages/llm/__tests__
touch packages/llm/__tests__/factory.test.ts

# Follow the pattern from:
# - packages/branding/__tests__/color-utils.test.ts (41 tests) ✅
# - packages/next/__tests__/enhance-action.test.ts (21 tests) ✅

# Run tests
pnpm --filter @kit/llm test
```

### Option B: Review What's Done

```bash
# See current test coverage
pnpm --filter web test
pnpm --filter @kit/branding test
pnpm --filter @kit/next test

# Review documentation
cat TESTING-PROGRESS.md
cat TESTING-IMPLEMENTATION-SUMMARY.md
cat CLAUDE.md | grep -A 100 "## Testing"
```

---

## 📋 REMAINING WORK (80 Test Files)

### **Priority 1: Critical Infrastructure Tests** (24 files)

These protect the most important functionality:

#### 1. @kit/llm (5 files) - **START HERE** ⭐

**Why**: Core AI functionality, multi-provider abstraction

**Files to create**:
```
packages/llm/__tests__/factory.test.ts
packages/llm/__tests__/pricing.test.ts
packages/llm/__tests__/openai-provider.test.ts
packages/llm/__tests__/anthropic-provider.test.ts
packages/llm/__tests__/gemini-provider.test.ts
```

**What to test**:
- ✅ `createLLMClient` - Factory with singleton pattern
- ✅ `loadConfigFromEnv` - Environment variable parsing
- ✅ `getDefaultModel` - Provider-specific defaults
- ✅ `resetLLMClient` - Singleton reset
- ✅ `calculateTokenCost` - Cost calculations
- ✅ `getModelPricing` - Pricing lookup
- ✅ Provider instantiation (OpenAI, Anthropic, Gemini, Local)

**Reference files**:
- `packages/llm/src/factory.ts` - Main factory
- `packages/llm/src/pricing.ts` - Cost calculations
- `packages/llm/CLAUDE.md` - Complete provider documentation

**Test pattern** (factory.test.ts):
```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createLLMClient, loadConfigFromEnv, resetLLMClient } from '../src/factory';

describe('LLM Factory', () => {
  beforeEach(() => {
    resetLLMClient();
    vi.clearAllMocks();
  });

  describe('loadConfigFromEnv', () => {
    it('should load OpenAI config from env', () => {
      process.env.LLM_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-test';

      const config = loadConfigFromEnv();
      expect(config.provider).toBe('openai');
      expect(config.model).toBe('gpt-4o-mini'); // default
      expect(config.apiKey).toBe('sk-test');
    });

    it('should throw if API key missing', () => {
      process.env.LLM_PROVIDER = 'openai';
      delete process.env.OPENAI_API_KEY;
      delete process.env.LLM_API_KEY;

      expect(() => loadConfigFromEnv()).toThrow('No API key found');
    });
  });

  describe('createLLMClient', () => {
    it('should return singleton instance', () => {
      process.env.LLM_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-test';

      const client1 = createLLMClient();
      const client2 = createLLMClient();

      expect(client1).toBe(client2);
    });

    it('should create new instance with config override', () => {
      const client1 = createLLMClient({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-1'
      });

      const client2 = createLLMClient({
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-2'
      });

      expect(client1).not.toBe(client2);
    });
  });
});
```

**Estimated time**: 2-3 hours for all 5 files
**Estimated tests**: 40-50 tests

---

#### 2. @kit/billing (4 files)

**Why**: Payment processing - critical for revenue

**Files to create**:
```
packages/billing/stripe/__tests__/webhook-verification.test.ts
packages/billing/stripe/__tests__/subscription-payload-builder.test.ts
packages/billing/lemon-squeezy/__tests__/hmac-verification.test.ts
packages/billing/gateway/__tests__/billing-gateway.test.ts
```

**What to test**:
- Webhook signature verification (Stripe, LemonSqueezy)
- Subscription payload construction
- Event handling and routing
- Error handling for invalid signatures

**Reference files**:
- `packages/billing/stripe/src/stripe-webhook-handler.service.ts`
- `packages/billing/lemon-squeezy/src/verify-hmac.ts`
- `packages/billing/gateway/src/billing-gateway.service.ts`

**Estimated time**: 2-3 hours
**Estimated tests**: 30-40 tests

---

#### 3. @kit/prompt-engine (1 file) ✅ COMPLETE

**Note**: The database-based `@kit/prompt-templates` package was refactored to the simpler JSON file-based `@kit/prompt-engine`. This significantly reduced complexity.

**Files created**:
```
packages/features/prompt-engine/__tests__/validation.test.ts (9 tests)
```

**What's tested**:
- JSON schema validation with Zod
- Variable placeholder validation
- Zod schema compilation
- Example output validation

**Reference files**:
- `packages/features/prompt-engine/src/lib/validation/prompt-template.schema.ts`
- `packages/features/prompt-engine/CLAUDE.md`
- `packages/features/prompt-engine/PRD.md`

**Status**: ✅ Complete (9 tests passing)

---

#### 4. @kit/projects (4 files)

**Why**: Role-based access control, multi-user collaboration

**Files to create**:
```
packages/features/projects/__tests__/permission-checks.test.ts
packages/features/projects/__tests__/project-mutations.test.ts
packages/features/projects/__tests__/member-mutations.test.ts
packages/features/projects/__tests__/project-queries.test.ts
```

**What to test**:
- `hasProjectRole` - Role verification
- `canPerformProjectAction` - Permission checking
- Project CRUD operations
- Member management (add, remove, update role)
- Audit log creation

**Reference files**:
- `packages/features/projects/lib/server/project.queries.ts`
- `packages/features/projects/lib/server/project.mutations.ts`
- `packages/features/projects/lib/schemas/project.schema.ts`

**Estimated time**: 2-3 hours
**Estimated tests**: 35-45 tests

---

#### 5. @kit/team-accounts (6 files)

**Why**: Multi-tenancy core, invitation logic, per-seat billing

**Files to create**:
```
packages/features/team-accounts/__tests__/invitation-validation.test.ts
packages/features/team-accounts/__tests__/per-seat-billing.test.ts
packages/features/team-accounts/__tests__/team-mutations.test.ts
packages/features/team-accounts/__tests__/member-mutations.test.ts
packages/features/team-accounts/__tests__/invitation-mutations.test.ts
packages/features/team-accounts/__tests__/webhooks.test.ts
```

**What to test**:
- Invitation validation (email, expiration, duplicates)
- Per-seat billing calculations (increaseSeats, decreaseSeats)
- Team CRUD operations
- Member role updates
- Invitation flow (send, accept, renew, delete)
- Webhook processing

**Reference files**:
- `packages/features/team-accounts/src/services/account-invitations.service.ts`
- `packages/features/team-accounts/src/services/account-per-seat-billing.service.ts`

**Estimated time**: 3-4 hours
**Estimated tests**: 45-55 tests

---

#### 6. @kit/admin (4 files)

**Why**: Security-critical admin operations

**Files to create**:
```
packages/features/admin/__tests__/is-super-admin.test.ts
packages/features/admin/__tests__/ban-user.test.ts
packages/features/admin/__tests__/admin-action-wrapper.test.ts
packages/features/admin/__tests__/impersonate-user.test.ts
```

**Estimated time**: 1-2 hours
**Estimated tests**: 25-30 tests

---

### **Priority 2: High-Value Tests** (33 files)

#### Remaining @kit/branding (3 files)
- Config parsing tests
- Font utilities tests
- Gradient utilities tests

#### @kit/audit-logs (3 files)
- Change calculation algorithms
- Network context extraction
- Domain transformers

#### @kit/otp, @kit/supabase, @kit/shared, @kit/monitoring (8 files)

#### @kit/accounts, @kit/auth, @kit/notifications (7 files)

#### Apps/web tests (12 files)
- API routes (webhooks, callbacks)
- Server actions (billing, workspace loaders)
- Utility functions

**Estimated time**: 12-15 hours
**Estimated tests**: 250-300 tests

---

## 🚀 EXECUTION STRATEGY

### Session 1 (2-3 hours) - Critical Tests
- ✅ Implement @kit/llm tests (5 files)
- ✅ Implement @kit/billing webhook verification (1-2 files)

### Session 2 (2-3 hours) - Feature Tests
- ✅ Implement @kit/prompt-engine validation tests (1 file - refactored from prompt-templates)
- ✅ Implement @kit/projects permission tests (1-2 files)

### Session 3 (3-4 hours) - Multi-Tenancy
- ✅ Implement @kit/team-accounts tests (6 files)
- ✅ Implement @kit/admin tests (4 files)

### Session 4 (3-4 hours) - High-Value Packages
- ✅ Implement @kit/auth tests
- ✅ Implement @kit/audit-logs tests
- ✅ Implement @kit/shared utilities tests

### Session 5+ (20-25 hours) - Complete Coverage
- Implement remaining 40+ test files
- Achieve 75%+ overall coverage
- Document all patterns

---

## 📚 ESTABLISHED PATTERNS

### Mock Patterns

**1. Next.js Navigation** (already configured in apps/web/vitest.setup.ts):
```typescript
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), ... }),
}));
```

**2. Server-Only Module** (pattern established in @kit/next):
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

**3. Supabase Client** (to be implemented):
```typescript
vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: {}, error: null }),
    })),
  })),
}));
```

**4. External Services** (to be created as needed):
- Redis client mock
- LLM provider mocks
- Payment provider mocks (Stripe, LemonSqueezy)
- AWS SDK mocks

### Test Structure Pattern

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

describe('Feature Name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variables if needed
  });

  describe('functionName', () => {
    it('should handle valid inputs', () => {
      // Arrange
      const input = createValidInput();

      // Act
      const result = functionName(input);

      // Assert
      expect(result).toBe(expectedOutput);
    });

    it('should handle invalid inputs', () => {
      expect(() => functionName(invalid)).toThrow('Error message');
    });

    it('should handle edge cases', () => {
      expect(functionName(null)).toBeNull();
      expect(functionName(undefined)).toBeUndefined();
      expect(functionName('')).toBe('');
    });
  });
});
```

---

## 🛠️ USEFUL COMMANDS

```bash
# Install dependencies for new package
pnpm install --filter @kit/package-name

# Run tests for specific package
pnpm --filter @kit/package-name test

# Run tests in watch mode
pnpm --filter @kit/package-name test

# Run with coverage
pnpm --filter @kit/package-name test:coverage

# Run all web tests
pnpm --filter web test

# Check current test status
pnpm --filter @kit/branding test  # ✅ 41 tests passing
pnpm --filter @kit/next test      # ✅ 21 tests passing
pnpm --filter @kit/cache test     # ✅ Tests passing (pre-existing)
```

---

## 📝 DOCUMENTATION TO REFERENCE

1. **TESTING-PROGRESS.md** - Detailed progress tracking with all 82 test files listed
2. **TESTING-IMPLEMENTATION-SUMMARY.md** - Complete overview, recommendations, file listing
3. **CLAUDE.md** - Testing section (lines 191-575) - patterns, mocking, best practices
4. **apps/web/CLAUDE.md** - Web-specific patterns (to be added in next session)

**Existing test files** (reference implementations):
- ✅ `packages/branding/__tests__/color-utils.test.ts` (41 tests)
- ✅ `packages/next/__tests__/enhance-action.test.ts` (21 tests)
- ✅ `packages/cache/src/__tests__/factory.test.ts` (existing)
- ✅ `packages/cache/src/__tests__/memory.test.ts` (existing)
- ✅ `packages/cache/src/__tests__/redis.test.ts` (existing)

---

## ✅ CHECKLIST FOR NEXT SESSION

Before starting:
- [ ] Review `TESTING-PROGRESS.md` for current status
- [ ] Verify test infrastructure still works: `pnpm --filter web test`
- [ ] Check that existing tests still pass (62 tests)

For each new test file:
- [ ] Create `__tests__` directory if needed
- [ ] Create test file following naming convention
- [ ] Add vitest to package.json devDependencies if not present
- [ ] Add test scripts to package.json if not present
- [ ] Create vitest.config.ts if not present
- [ ] Write tests following established patterns
- [ ] Run tests to verify they pass
- [ ] Update TESTING-PROGRESS.md with new test count

After completing tests:
- [ ] Run `pnpm typecheck` to ensure no type errors
- [ ] Run `pnpm lint:fix` to fix linting issues
- [ ] Update TESTING-PROGRESS.md with new statistics
- [ ] Commit changes with descriptive message

---

## 🎯 SUCCESS METRICS

**By End of Next Session** (assuming 3-4 hours):
- ✅ 5-10 more test files implemented
- ✅ 100-150 more tests passing (total: 160-210 tests)
- ✅ Critical infrastructure covered (@kit/llm, @kit/billing)
- ✅ Updated documentation

**By End of All Sessions** (assuming 30-40 hours):
- ✅ All 82 test files implemented
- ✅ 1000-1500 tests passing
- ✅ 75%+ code coverage
- ✅ Complete documentation
- ✅ CI/CD running all tests

---

**Current Progress**: 62 tests passing ✅
**Next Milestone**: 150+ tests passing
**Final Goal**: 1000+ tests passing, 75%+ coverage

**Ready to resume!** 🚀
