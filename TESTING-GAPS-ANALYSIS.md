# Testing Gaps Analysis

**Generated**: 2025-10-21
**Status**: GitHub Actions ✅ All tests passing (474 tests)
**Coverage**: ~23% of files tested (77/338 files)

## Executive Summary

This document identifies critical gaps in test coverage across the base-saas monorepo. The analysis found **450-600 missing tests** across **40+ untested files**, with the highest priority areas being billing systems, admin operations, and team access control.

## Statistics

- **Total TypeScript files**: 338 (packages/features + apps/web/app)
- **Total test files**: 77
- **File coverage**: 23%
- **Current passing tests**: 474
- **Estimated missing tests**: 450-600

## Priority Breakdown

| Priority | Area | Files | Est. Tests | Impact |
|----------|------|-------|------------|--------|
| CRITICAL | Billing Gateway | 8 | 160 | Revenue loss, payment failures |
| CRITICAL | Admin Actions | 1 | 70 | Security breaches, data loss |
| HIGH | Team Access Control | 6 | 90 | Unauthorized access |
| HIGH | Team Operations | 6 | 50 | Data integrity issues |
| MEDIUM | Email System | 4 | 40 | Communication failures |
| MEDIUM | Webhooks | 5 | 50 | Event processing errors |

## Critical Priority (250-300 tests)

### 1. Admin Server Actions (70 tests) ⚠️ SECURITY CRITICAL

**File**: `packages/features/admin/src/lib/server/admin-server-actions.ts`

**Untested Actions**:
- `banUserAction` - Bans user accounts
- `reactivateUserAction` - Reactivates banned users
- `impersonateUserAction` - **SECURITY CRITICAL** - Admin impersonation
- `deleteUserAction` - Permanently deletes users
- `deleteAccountAction` - Permanently deletes accounts
- `createUserAction` - Creates new users
- `resetPasswordAction` - Resets user passwords

**Risk**: Unauthorized access, privilege escalation, data loss

**Test Plan**:
```typescript
// packages/features/admin/__tests__/admin-server-actions.test.ts

describe('Admin Server Actions', () => {
  describe('banUserAction', () => {
    it('should ban user when admin authenticated');
    it('should reject when not admin');
    it('should prevent admin from banning themselves');
    it('should revalidate admin paths after ban');
    // ... 10 tests total
  });

  describe('impersonateUserAction', () => {
    it('should create impersonation session');
    it('should reject non-admin users');
    it('should prevent impersonating other admins');
    it('should log impersonation events');
    it('should redirect to impersonated user workspace');
    // ... 10 tests total
  });

  // ... 70 tests total across 7 actions
});
```

### 2. Billing Gateway Services (160 tests) 💰 REVENUE CRITICAL

**Files**:
- `packages/billing/gateway/src/services/billing-gateway.service.ts` (40 tests)
- `packages/billing/gateway/src/services/billing-event-handler.service.ts` (30 tests)
- `packages/billing/stripe/src/stripe-billing-gateway-provider.ts` (45 tests)
- `packages/billing/lemon-squeezy/src/lemon-squeezy-billing-gateway-provider.ts` (45 tests)

**Untested Operations**:
- Subscription creation/cancellation
- Payment method updates
- Webhook signature verification
- Event processing (payment success/failure)
- Proration handling
- Customer portal session creation
- Invoice generation
- Refund processing

**Risk**: Payment failures, revenue loss, incorrect billing, security vulnerabilities

**Test Plan**:
```typescript
// packages/billing/gateway/__tests__/billing-gateway.service.test.ts

describe('BillingGatewayService', () => {
  describe('createBillingCheckoutSession', () => {
    it('should create checkout session with valid data');
    it('should handle missing price ID');
    it('should pass correct metadata');
    it('should return session URL');
    // ... 8 tests
  });

  describe('cancelSubscription', () => {
    it('should cancel active subscription');
    it('should handle already canceled subscription');
    it('should trigger webhook events');
    // ... 5 tests
  });

  // ... 40 tests total
});

// packages/billing/stripe/__tests__/stripe-provider.test.ts

describe('Stripe Provider', () => {
  describe('webhook verification', () => {
    it('should verify valid webhook signature');
    it('should reject invalid signature');
    it('should handle missing signature');
    it('should validate timestamp');
    // ... 10 tests
  });

  describe('subscription lifecycle', () => {
    it('should handle subscription.created event');
    it('should handle subscription.updated event');
    it('should handle subscription.deleted event');
    it('should handle payment_intent.succeeded');
    it('should handle payment_intent.failed');
    // ... 15 tests
  });

  // ... 45 tests total
});
```

### 3. Team Access Control Services (90 tests) 🔐 ACCESS CONTROL

**Files**:
- `packages/features/team-accounts/src/server/services/team-account-invitations.service.ts` (30 tests)
- `packages/features/team-accounts/src/server/services/team-account-members.service.ts` (30 tests)
- `packages/features/team-accounts/src/server/services/team-accounts.service.ts` (30 tests)

**Untested Operations**:
- Invitation creation/acceptance/rejection
- Member role validation
- Permission checking
- Owner transfer validation
- Invitation expiration
- Duplicate invitation prevention

**Risk**: Unauthorized access, privilege escalation, data breaches

**Test Plan**:
```typescript
// packages/features/team-accounts/__tests__/team-account-invitations.service.test.ts

describe('TeamAccountInvitationsService', () => {
  describe('inviteTeamMember', () => {
    it('should create invitation with valid role');
    it('should reject invalid role');
    it('should prevent duplicate invitations');
    it('should require invite permission');
    it('should send invitation email');
    // ... 10 tests
  });

  describe('acceptInvitation', () => {
    it('should add member with correct role');
    it('should reject expired invitation');
    it('should reject already accepted invitation');
    it('should trigger billing seat increase (if per-seat)');
    // ... 8 tests
  });

  // ... 30 tests total
});
```

## High Priority (150-200 tests)

### 4. Team Account Server Actions (90 tests)

**Files**:
- `packages/features/team-accounts/src/server/team-members-server-actions.ts` (15 tests)
- `packages/features/team-accounts/src/server/team-invitations-server-actions.ts` (15 tests)
- `packages/features/team-accounts/src/server/create-team-account-server-actions.ts` (15 tests)
- `packages/features/team-accounts/src/server/delete-team-account-server-actions.ts` (15 tests)
- `packages/features/team-accounts/src/server/leave-team-account-server-actions.ts` (15 tests)
- `packages/features/team-accounts/src/server/team-details-server-actions.ts` (15 tests)

**Untested Actions**:
- Create team account
- Delete team account
- Update team details
- Invite member
- Remove member
- Update member role
- Accept/reject invitation
- Leave team
- Transfer ownership

**Test Plan**:
```typescript
// packages/features/team-accounts/__tests__/team-members-server-actions.test.ts

describe('Team Members Server Actions', () => {
  describe('updateTeamMemberRoleAction', () => {
    it('should update member role when authorized');
    it('should reject when not admin/owner');
    it('should prevent downgrading last owner');
    it('should validate role against schema');
    it('should revalidate paths after update');
    // ... 15 tests total
  });
});
```

### 5. Billing Actions & Webhooks (50 tests)

**Files**:
- `apps/web/app/home/[account]/billing/_lib/server/server-actions.ts` (15 tests)
- `apps/web/app/home/(user)/billing/_lib/server/server-actions.ts` (15 tests)
- `apps/web/app/api/billing/webhook/__tests__/route.test.ts` (20 tests - PARTIAL)

**Untested Operations**:
- Create checkout session
- Create billing portal session
- Update payment method
- Webhook event routing
- Subscription status updates

### 6. Per-Seat Billing Service (30 tests)

**File**: `packages/features/team-accounts/src/server/services/account-per-seat-billing.service.ts`

**Untested Operations**:
- Increase seats on member add
- Decrease seats on member remove
- Validate seat limits
- Calculate prorated charges
- Handle billing errors gracefully

**Test Plan**:
```typescript
// packages/features/team-accounts/__tests__/account-per-seat-billing.service.test.ts

describe('AccountPerSeatBillingService', () => {
  describe('increaseSeats', () => {
    it('should increase subscription quantity');
    it('should handle non-per-seat plans gracefully');
    it('should prorate charges correctly');
    it('should update subscription item');
    // ... 8 tests
  });

  describe('decreaseSeats', () => {
    it('should decrease subscription quantity');
    it('should not go below minimum seats');
    it('should prorate credits correctly');
    // ... 6 tests
  });
});
```

## Medium Priority (50-100 tests)

### 7. Email Provider Implementations (40 tests)

**Files**:
- `packages/mailers/resend/src/resend.mailer.ts` (20 tests)
- `packages/mailers/nodemailer/src/nodemailer.mailer.ts` (20 tests)

**Untested Operations**:
- Send email with attachments
- Send bulk emails
- Template rendering
- Error handling (rate limits, invalid emails)
- SMTP configuration validation

### 8. Database Webhook Handlers (30 tests)

**Files**:
- `packages/database-webhooks/src/handlers/user-created.handler.ts` (10 tests)
- `packages/database-webhooks/src/handlers/account-created.handler.ts` (10 tests)
- `packages/database-webhooks/src/handlers/subscription-updated.handler.ts` (10 tests)

**Untested Operations**:
- User created event processing
- Account created event processing
- Subscription status change handling
- Event validation and error handling

### 9. Personal Account Operations (25 tests)

**Files**:
- `apps/web/app/home/(user)/settings/_lib/server/server-actions.ts` (15 tests)
- `packages/features/accounts/src/server/services/accounts.service.ts` (10 tests)

**Untested Actions**:
- Update profile
- Delete account
- Update email
- Update password
- Enable/disable MFA

## Implementation Roadmap

### Phase 1: Critical Security & Revenue (2-3 weeks)
**Target**: 250 tests

1. **Week 1**: Admin actions (70 tests)
   - Security validation
   - Permission checks
   - Audit logging

2. **Week 2**: Billing gateway core (80 tests)
   - Subscription lifecycle
   - Payment processing
   - Webhook verification

3. **Week 3**: Team access control (90 tests)
   - Invitation flows
   - Member management
   - Permission validation

### Phase 2: Team Operations (1-2 weeks)
**Target**: 150 tests

4. **Week 4**: Team account actions (90 tests)
5. **Week 5**: Billing integrations (60 tests)
   - Per-seat billing
   - Provider implementations (Stripe/LS)

### Phase 3: Supporting Systems (1 week)
**Target**: 105 tests

6. **Week 6**: Email & webhooks (70 tests)
7. **Week 7**: Personal accounts (35 tests)

## Testing Patterns to Follow

### Server Action Pattern
```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

describe('myServerAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authentication', () => {
    it('should require authentication when auth: true');
    it('should reject unauthenticated requests');
  });

  describe('validation', () => {
    it('should validate input against schema');
    it('should reject invalid input');
  });

  describe('authorization', () => {
    it('should check user permissions');
    it('should reject unauthorized users');
  });

  describe('success cases', () => {
    it('should perform action when valid');
    it('should revalidate paths after action');
  });

  describe('error handling', () => {
    it('should handle database errors gracefully');
    it('should log errors with context');
  });
});
```

### Service Pattern
```typescript
describe('MyService', () => {
  let service: MyService;
  let mockClient: SupabaseClient;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
    service = new MyService(mockClient);
  });

  describe('method', () => {
    it('should call database with correct params');
    it('should handle RLS errors');
    it('should return transformed data');
  });
});
```

## Coverage Targets

| Category | Current | Target | Priority |
|----------|---------|--------|----------|
| Admin actions | 0% | 90%+ | CRITICAL |
| Billing core | 0% | 85%+ | CRITICAL |
| Team access | 0% | 85%+ | CRITICAL |
| Team operations | 0% | 80%+ | HIGH |
| Email system | 0% | 75%+ | MEDIUM |
| Webhooks | 40% | 80%+ | MEDIUM |
| Overall | 23% | 75%+ | - |

## Next Steps

1. ✅ **COMPLETED**: Fix GitHub Actions test failures
2. ✅ **COMPLETED**: Document testing gaps
3. **PENDING**: Implement Phase 1 tests (admin + billing core)
4. **PENDING**: Implement Phase 2 tests (team operations)
5. **PENDING**: Implement Phase 3 tests (supporting systems)

## Monitoring Progress

Track progress in `TESTING-PROGRESS.md` with updates after each phase:

```markdown
### Phase 1 Progress (Target: 250 tests)
- [ ] Admin actions: 0/70 tests
- [ ] Billing gateway: 0/80 tests
- [ ] Team access control: 0/90 tests
```

## References

- **Current progress**: `TESTING-PROGRESS.md`
- **Implementation guide**: `TESTING-IMPLEMENTATION-SUMMARY.md`
- **Test setup**: `apps/web/vitest.setup.ts`
- **Example tests**:
  - `packages/branding/__tests__/color-utils.test.ts`
  - `packages/next/__tests__/enhance-action.test.ts`
  - `apps/web/app/api/db/webhook/__tests__/route.test.ts`
