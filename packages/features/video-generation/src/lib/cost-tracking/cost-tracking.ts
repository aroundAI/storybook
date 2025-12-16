'use server';

import 'server-only';

import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { VideoProvider } from '../types';
import {
  DEFAULT_MONTHLY_BUDGET_CENTS,
  PROVIDER_COSTS,
  WARNING_THRESHOLD_PERCENT,
} from './types';
import type {
  BudgetCheckResult,
  BudgetStatus,
  SpendingSummary,
  VideoMode,
} from './types';

/**
 * Get the start of the current month in UTC
 */
function getStartOfMonth(): Date {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);
  return startOfMonth;
}

/**
 * Get budget status for an account
 *
 * Queries the account's monthly budget setting and calculates current spending
 * and reservations from generation_jobs table.
 */
export async function getBudgetStatus(
  accountId: string,
): Promise<BudgetStatus> {
  const client = getSupabaseServerClient();

  // Get account budget settings from public_data
  const { data: account } = await client
    .from('accounts')
    .select('public_data')
    .eq('id', accountId)
    .single();

  const publicData = account?.public_data as Record<string, unknown> | null;
  const monthlyBudgetCents =
    (publicData?.monthlyVideoBudgetCents as number) ||
    DEFAULT_MONTHLY_BUDGET_CENTS;

  const startOfMonth = getStartOfMonth();

  // Get current month's jobs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: jobs } = await (client as any)
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

  const remainingCents = Math.max(
    0,
    monthlyBudgetCents - spentCents - reservedCents,
  );
  const percentUsed =
    monthlyBudgetCents > 0 ? (spentCents / monthlyBudgetCents) * 100 : 0;

  return {
    monthlyBudgetCents,
    spentCents,
    reservedCents,
    remainingCents,
    percentUsed,
    warningThreshold: WARNING_THRESHOLD_PERCENT,
  };
}

/**
 * Check if budget allows generation and reserve funds
 *
 * Returns whether the generation is allowed based on remaining budget.
 * If the generation would push usage past 80%, a warning is logged.
 */
export async function checkAndReserveBudget(
  accountId: string,
  estimatedCostCents: number,
): Promise<BudgetCheckResult> {
  const logger = await getLogger();
  const budgetStatus = await getBudgetStatus(accountId);

  // Check if sufficient budget
  if (budgetStatus.remainingCents < estimatedCostCents) {
    logger.warn(
      {
        name: 'cost-tracking.check-budget',
        accountId,
        required: estimatedCostCents,
        remaining: budgetStatus.remainingCents,
      },
      'Insufficient budget for video generation',
    );

    return {
      allowed: false,
      remaining: budgetStatus.remainingCents,
      requiresUpgrade: true,
      message: `Insufficient budget. Required: $${(estimatedCostCents / 100).toFixed(2)}, Available: $${(budgetStatus.remainingCents / 100).toFixed(2)}`,
    };
  }

  // Check warning threshold
  const newPercentUsed =
    budgetStatus.monthlyBudgetCents > 0
      ? ((budgetStatus.spentCents +
          budgetStatus.reservedCents +
          estimatedCostCents) /
          budgetStatus.monthlyBudgetCents) *
        100
      : 0;

  if (
    newPercentUsed >= WARNING_THRESHOLD_PERCENT &&
    budgetStatus.percentUsed < WARNING_THRESHOLD_PERCENT
  ) {
    // Log warning when crossing 80% threshold
    logger.warn(
      {
        name: 'cost-tracking.budget-warning',
        accountId,
        percentUsed: newPercentUsed,
        threshold: WARNING_THRESHOLD_PERCENT,
      },
      'Budget warning threshold reached',
    );

    // TODO: Trigger email notification
    // TODO: Create in-app notification
  }

  return {
    allowed: true,
    remaining: budgetStatus.remainingCents - estimatedCostCents,
  };
}

/**
 * Record actual generation cost for a job
 *
 * Updates the generation_jobs table with the actual cost after generation completes.
 */
export async function recordJobCost(
  accountId: string,
  costCents: number,
  generationJobId: string,
): Promise<void> {
  const logger = await getLogger();
  const client = getSupabaseServerClient();

  // Update generation job with actual cost
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any)
    .from('generation_jobs')
    .update({ cost_cents: costCents })
    .eq('id', generationJobId);

  logger.info(
    {
      name: 'cost-tracking.record-cost',
      accountId,
      generationJobId,
      costCents,
    },
    'Generation cost recorded',
  );

  // Check if over budget
  const budgetStatus = await getBudgetStatus(accountId);
  if (budgetStatus.percentUsed >= 100) {
    logger.error(
      {
        name: 'cost-tracking.budget-exceeded',
        accountId,
        percentUsed: budgetStatus.percentUsed,
      },
      'Budget exceeded',
    );

    // TODO: Send email notification
    // TODO: Create in-app notification
    // TODO: Disable auto-generation
  }
}

/**
 * Calculate cost for video generation request
 *
 * Uses provider-specific pricing to calculate the estimated cost in cents.
 */
export async function calculateVideoCost(
  provider: VideoProvider,
  duration: number,
  mode: VideoMode = 'std',
): Promise<number> {
  const providerCosts = PROVIDER_COSTS[provider];
  if (!providerCosts) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const costPerSecond = providerCosts[mode];
  return costPerSecond * duration;
}

/**
 * Get spending summary for an account
 *
 * Returns a breakdown of spending by provider for the current month.
 */
export async function getSpendingSummary(
  accountId: string,
): Promise<SpendingSummary> {
  const client = getSupabaseServerClient();
  const startOfMonth = getStartOfMonth();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: jobs } = await (client as any)
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
 * Set monthly budget for account
 *
 * Updates the account's settings with a new monthly video budget.
 * This should only be called by admin functions or billing workflows.
 */
export async function setMonthlyBudget(
  accountId: string,
  budgetCents: number,
): Promise<void> {
  const logger = await getLogger();
  const client = getSupabaseServerClient();

  // Get current public_data to merge
  const { data: account } = await client
    .from('accounts')
    .select('public_data')
    .eq('id', accountId)
    .single();

  const currentPublicData =
    (account?.public_data as Record<string, unknown>) || {};

  await client
    .from('accounts')
    .update({
      public_data: {
        ...currentPublicData,
        monthlyVideoBudgetCents: budgetCents,
      },
    })
    .eq('id', accountId);

  logger.info(
    {
      name: 'cost-tracking.set-budget',
      accountId,
      budgetCents,
    },
    'Monthly budget updated',
  );
}
