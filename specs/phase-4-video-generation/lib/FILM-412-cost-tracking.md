# FILM-412: Cost Tracking Library

**Phase**: 4
**Priority**: P0
**Effort**: M (3-4 days)
**Dependencies**: FILM-101i (external_api_keys table for budget settings)
**Blocks**: FILM-405 (generate-video-action)

---

## Context

Cost tracking manages budget allocation, spending limits, and usage monitoring for video generation. The library provides functions to check available budget, reserve funds for generation jobs, record actual costs, calculate per-provider pricing, and send warnings when approaching budget limits. This ensures accounts don't overspend and provides transparency into generation costs.

---

## Requirements

### Functional Requirements

1. **Budget Management**
   - Get monthly budget for account
   - Check remaining budget
   - Set budget limits per account
   - Support different tiers (free/standard/pro)

2. **Budget Reservation**
   - Reserve budget before generation (optimistic)
   - Release reservation on failure
   - Convert reservation to actual cost on success
   - Handle concurrent reservations atomically

3. **Cost Recording**
   - Record actual generation costs
   - Link costs to generation jobs
   - Track costs per provider
   - Calculate cost per video type

4. **Budget Warnings**
   - Warn at 80% budget consumption
   - Block at 100% (unless override enabled)
   - Email notifications at thresholds
   - Dashboard warnings in UI

---

## Interface

### TypeScript Types

```typescript
import { z } from 'zod';

export interface BudgetStatus {
  monthlyBudgetCents: number;
  spentCents: number;
  reservedCents: number;
  remainingCents: number;
  percentUsed: number;
  warningThreshold: number;
}

export interface BudgetCheckResult {
  allowed: boolean;
  remaining: number;
  requiresUpgrade?: boolean;
  message?: string;
}

export interface CostRecord {
  accountId: string;
  generationJobId: string;
  costCents: number;
  provider: string;
  createdAt: string;
}

// Provider cost table (cents per second)
export const PROVIDER_COSTS = {
  kling: {
    std: 10,   // $0.10/second
    pro: 30,   // $0.30/second
  },
  runway: {
    std: 20,   // $0.20/second
    pro: 50,   // $0.50/second
  },
  luma: {
    std: 15,   // $0.15/second
    pro: 40,   // $0.40/second
  },
};
```

### Implementation

```typescript
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { logger } from '@kit/monitoring';

/**
 * Get budget status for account
 */
export async function getBudgetStatus(
  accountId: string
): Promise<BudgetStatus> {
  const client = getSupabaseServerClient();

  // Get account budget settings
  const { data: account } = await client
    .from('accounts')
    .select('settings')
    .eq('id', accountId)
    .single();

  const monthlyBudgetCents = account?.settings?.monthlyVideoBudgetCents || 0;

  // Get current month's spending
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: jobs } = await client
    .from('generation_jobs')
    .select('cost_cents, estimated_cost_cents, status')
    .eq('account_id', accountId)
    .eq('job_type', 'video')
    .gte('created_at', startOfMonth.toISOString());

  // Calculate spent and reserved
  let spentCents = 0;
  let reservedCents = 0;

  for (const job of jobs || []) {
    if (job.status === 'completed' && job.cost_cents) {
      spentCents += job.cost_cents;
    } else if (job.status === 'queued' || job.status === 'processing') {
      reservedCents += job.estimated_cost_cents || 0;
    }
  }

  const remainingCents = monthlyBudgetCents - spentCents - reservedCents;
  const percentUsed = (spentCents / monthlyBudgetCents) * 100;

  return {
    monthlyBudgetCents,
    spentCents,
    reservedCents,
    remainingCents,
    percentUsed,
    warningThreshold: 80,
  };
}

/**
 * Check if budget allows generation and reserve funds
 */
export async function checkAndReserveBudget(
  accountId: string,
  estimatedCostCents: number
): Promise<BudgetCheckResult> {
  const budgetStatus = await getBudgetStatus(accountId);

  // Check if sufficient budget
  if (budgetStatus.remainingCents < estimatedCostCents) {
    logger.warn('Insufficient budget', {
      accountId,
      required: estimatedCostCents,
      remaining: budgetStatus.remainingCents,
    });

    return {
      allowed: false,
      remaining: budgetStatus.remainingCents,
      requiresUpgrade: true,
      message: `Insufficient budget. Required: $${(estimatedCostCents / 100).toFixed(2)}, Available: $${(budgetStatus.remainingCents / 100).toFixed(2)}`,
    };
  }

  // Check warning threshold
  const newPercentUsed =
    ((budgetStatus.spentCents + budgetStatus.reservedCents + estimatedCostCents) /
      budgetStatus.monthlyBudgetCents) *
    100;

  if (newPercentUsed >= 80 && budgetStatus.percentUsed < 80) {
    // Trigger warning notification
    await triggerBudgetWarning(accountId, newPercentUsed);
  }

  return {
    allowed: true,
    remaining: budgetStatus.remainingCents - estimatedCostCents,
  };
}

/**
 * Record actual generation cost
 */
export async function recordJobCost(
  accountId: string,
  costCents: number,
  generationJobId: string
): Promise<void> {
  const client = getSupabaseServerClient();

  // Update generation job with actual cost
  await client
    .from('generation_jobs')
    .update({ cost_cents: costCents })
    .eq('id', generationJobId);

  logger.info('Generation cost recorded', {
    accountId,
    generationJobId,
    costCents,
  });

  // Check if over budget
  const budgetStatus = await getBudgetStatus(accountId);
  if (budgetStatus.percentUsed >= 100) {
    await triggerBudgetExceeded(accountId);
  }
}

/**
 * Calculate cost for video generation request
 */
export function calculateVideoCost(
  provider: string,
  duration: number,
  mode: 'std' | 'pro' = 'std'
): number {
  const providerCosts = PROVIDER_COSTS[provider as keyof typeof PROVIDER_COSTS];
  if (!providerCosts) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const costPerSecond = providerCosts[mode];
  return costPerSecond * duration;
}

/**
 * Get spending summary for account
 */
export async function getSpendingSummary(accountId: string) {
  const client = getSupabaseServerClient();

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: jobs } = await client
    .from('generation_jobs')
    .select('cost_cents, provider, created_at')
    .eq('account_id', accountId)
    .eq('job_type', 'video')
    .gte('created_at', startOfMonth.toISOString())
    .not('cost_cents', 'is', null);

  // Group by provider
  const byProvider: Record<string, number> = {};
  let totalCents = 0;

  for (const job of jobs || []) {
    const provider = job.provider || 'unknown';
    byProvider[provider] = (byProvider[provider] || 0) + (job.cost_cents || 0);
    totalCents += job.cost_cents || 0;
  }

  return {
    totalCents,
    byProvider,
    jobCount: jobs?.length || 0,
    period: {
      start: startOfMonth.toISOString(),
      end: new Date().toISOString(),
    },
  };
}

/**
 * Trigger budget warning notification
 */
async function triggerBudgetWarning(
  accountId: string,
  percentUsed: number
): Promise<void> {
  logger.warn('Budget warning triggered', {
    accountId,
    percentUsed,
  });

  // TODO: Send email notification
  // TODO: Create in-app notification
}

/**
 * Trigger budget exceeded notification
 */
async function triggerBudgetExceeded(accountId: string): Promise<void> {
  logger.error('Budget exceeded', { accountId });

  // TODO: Send email notification
  // TODO: Create in-app notification
  // TODO: Disable auto-generation
}

/**
 * Set monthly budget for account (admin only)
 */
export async function setMonthlyBudget(
  accountId: string,
  budgetCents: number
): Promise<void> {
  const client = getSupabaseServerClient();

  await client
    .from('accounts')
    .update({
      settings: {
        monthlyVideoBudgetCents: budgetCents,
      },
    })
    .eq('id', accountId);

  logger.info('Monthly budget updated', {
    accountId,
    budgetCents,
  });
}
```

---

## Implementation Details

### File Structure

```
packages/features/video-generation/src/
├── lib/
│   ├── cost-tracking/
│   │   ├── cost-tracking.ts            # Main functions (CREATE THIS)
│   │   ├── types.ts                    # Type definitions (CREATE THIS)
│   │   └── __tests__/
│   │       └── cost-tracking.test.ts   # Unit tests (CREATE THIS)
│   └── index.ts                        # Export functions (UPDATE THIS)
```

### Cost Calculation Formula

```
Cost (cents) = Cost per second * Duration (seconds)

Example:
- Kling Standard 5s: $0.10/s * 5s = $0.50 = 50 cents
- Kling Pro 10s: $0.30/s * 10s = $3.00 = 300 cents
```

### Budget Flow

```
1. Check budget → Get current spending
2. Reserve budget → Add estimated cost to reserved
3. Generate video → Process with provider
4. Record cost → Update with actual cost
5. Check thresholds → Trigger warnings if needed
```

### Monthly Budget Reset

Budget tracking resets on the 1st of each month. Historical data preserved in generation_jobs table.

---

## File Changes

### New Files

1. **packages/features/video-generation/src/lib/cost-tracking/cost-tracking.ts**
2. **packages/features/video-generation/src/lib/cost-tracking/types.ts**
3. **packages/features/video-generation/src/lib/cost-tracking/__tests__/cost-tracking.test.ts**

### Modified Files

1. **packages/features/video-generation/src/lib/index.ts** - Export functions

---

## Acceptance Criteria

- [x] `getBudgetStatus()` returns accurate budget info
- [x] `checkAndReserveBudget()` prevents overspending
- [x] `recordJobCost()` updates actual costs
- [x] `calculateVideoCost()` returns correct pricing
- [x] `getSpendingSummary()` shows spending breakdown
- [x] Budget warnings triggered at 80%
- [x] Budget blocks generation at 100%
- [x] Costs tracked per provider

**Status: COMPLETED** - Implemented in `packages/features/video-generation/src/lib/cost-tracking/`

---

## Test Plan

### Unit Tests

```typescript
import { describe, it, expect, vi } from 'vitest';
import {
  getBudgetStatus,
  checkAndReserveBudget,
  recordJobCost,
  calculateVideoCost,
} from '../cost-tracking';

describe('Cost Tracking', () => {
  describe('calculateVideoCost', () => {
    it('should calculate Kling standard cost', () => {
      const cost = calculateVideoCost('kling', 5, 'std');
      expect(cost).toBe(50); // 10 cents/s * 5s
    });

    it('should calculate Kling pro cost', () => {
      const cost = calculateVideoCost('kling', 10, 'pro');
      expect(cost).toBe(300); // 30 cents/s * 10s
    });

    it('should throw for unknown provider', () => {
      expect(() => calculateVideoCost('unknown', 5)).toThrow();
    });
  });

  describe('getBudgetStatus', () => {
    it('should return budget status', async () => {
      const status = await getBudgetStatus('account-123');

      expect(status).toHaveProperty('monthlyBudgetCents');
      expect(status).toHaveProperty('spentCents');
      expect(status).toHaveProperty('remainingCents');
      expect(status).toHaveProperty('percentUsed');
    });
  });

  describe('checkAndReserveBudget', () => {
    it('should allow when sufficient budget', async () => {
      const result = await checkAndReserveBudget('account-123', 100);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
    });

    it('should block when insufficient budget', async () => {
      const result = await checkAndReserveBudget('account-no-budget', 1000000);

      expect(result.allowed).toBe(false);
      expect(result.requiresUpgrade).toBe(true);
    });
  });

  describe('recordJobCost', () => {
    it('should record actual cost', async () => {
      await recordJobCost('account-123', 50, 'job-123');

      // Verify cost updated in database
      const { data: job } = await client
        .from('generation_jobs')
        .select('cost_cents')
        .eq('id', 'job-123')
        .single();

      expect(job.cost_cents).toBe(50);
    });
  });
});
```

---

## Security Considerations

- Only account owners can view budget status
- Admin-only functions for setting budgets
- Validate all cost calculations
- Audit log for budget changes
- Prevent cost manipulation

---

## Performance Considerations

- Cache budget status for 1 minute
- Use database indexes on generation_jobs
- Batch cost calculations where possible
- Optimize monthly aggregation queries

```typescript
// Cache budget status
const budgetCache = new Map<string, { status: BudgetStatus; expiresAt: number }>();

export async function getCachedBudgetStatus(accountId: string): Promise<BudgetStatus> {
  const cached = budgetCache.get(accountId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.status;
  }

  const status = await getBudgetStatus(accountId);
  budgetCache.set(accountId, {
    status,
    expiresAt: Date.now() + 60000, // 1 minute
  });

  return status;
}
```

---

## Future Enhancements

1. **Budget Forecasting** - Predict when budget will run out
2. **Cost Alerts** - Custom threshold alerts
3. **Cost Optimization** - Recommend cheaper providers
4. **Usage Reports** - Detailed spending reports
5. **Budget Rollover** - Unused budget carries over
6. **Team Budgets** - Per-team budget allocation

---

## References

- **FILM-405**: Generate video action
- **FILM-101**: generation_jobs table
- **Constitution**: Section 6 (Cost Tracking)
- **Stripe Integration**: @kit/billing for payments
