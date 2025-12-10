/**
 * Cost Tracking Types
 *
 * Type definitions for budget management and cost tracking in video generation.
 */
import type { VideoProvider } from '../types';

/**
 * Budget status for an account
 */
export interface BudgetStatus {
  monthlyBudgetCents: number;
  spentCents: number;
  reservedCents: number;
  remainingCents: number;
  percentUsed: number;
  warningThreshold: number;
}

/**
 * Result of checking and potentially reserving budget
 */
export interface BudgetCheckResult {
  allowed: boolean;
  remaining: number;
  requiresUpgrade?: boolean;
  message?: string;
}

/**
 * Cost record for a generation job
 */
export interface CostRecord {
  accountId: string;
  generationJobId: string;
  costCents: number;
  provider: string;
  createdAt: string;
}

/**
 * Spending summary for an account
 */
export interface SpendingSummary {
  totalCents: number;
  byProvider: Record<string, number>;
  jobCount: number;
  period: {
    start: string;
    end: string;
  };
}

/**
 * Video generation mode
 */
export type VideoMode = 'std' | 'pro';

/**
 * Provider cost structure (cents per second)
 */
export interface ProviderCostStructure {
  std: number;
  pro: number;
}

/**
 * Provider costs table (cents per second)
 *
 * Kling: std=$0.10/s, pro=$0.30/s
 * Runway: std=$0.20/s, pro=$0.50/s
 * Luma: std=$0.15/s, pro=$0.40/s
 * Hailuo: std=$0.12/s, pro=$0.35/s
 */
export const PROVIDER_COSTS: Record<VideoProvider, ProviderCostStructure> = {
  kling: {
    std: 10,
    pro: 30,
  },
  runway: {
    std: 20,
    pro: 50,
  },
  luma: {
    std: 15,
    pro: 40,
  },
  hailuo: {
    std: 12,
    pro: 35,
  },
};

/**
 * Default monthly budget in cents ($100)
 */
export const DEFAULT_MONTHLY_BUDGET_CENTS = 10000;

/**
 * Warning threshold percentage (80%)
 */
export const WARNING_THRESHOLD_PERCENT = 80;
