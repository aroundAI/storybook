/**
 * Budget Tracker
 *
 * Tracks token usage, cost, and latency across agent steps.
 * Enforces hard limits to prevent runaway costs.
 */
import type { BudgetCheckResult, BudgetLimits, BudgetState } from './types';

export interface BudgetTracker {
  /** Record usage from a completed step */
  record(tokens: number, costUSD: number, latencyMs: number): void;
  /** Check if any budget limit has been exceeded */
  isExceeded(): BudgetCheckResult;
  /** Get current budget consumption state */
  getState(): BudgetState;
}

/**
 * Creates a budget tracker with the given limits.
 *
 * @example
 * ```typescript
 * const tracker = createBudgetTracker({
 *   maxTotalTokens: 50000,
 *   maxCostUSD: 0.50,
 *   maxLatencyMs: 120000,
 * });
 *
 * tracker.record(1500, 0.02, 3000);
 * const check = tracker.isExceeded();
 * // { exceeded: false }
 * ```
 */
export function createBudgetTracker(limits: BudgetLimits): BudgetTracker {
  const state: BudgetState = {
    totalTokens: 0,
    totalCostUSD: 0,
    totalLatencyMs: 0,
    stepCount: 0,
  };

  return {
    record(tokens: number, costUSD: number, latencyMs: number): void {
      state.totalTokens += tokens;
      state.totalCostUSD += costUSD;
      state.totalLatencyMs += latencyMs;
      state.stepCount += 1;
    },

    isExceeded(): BudgetCheckResult {
      if (state.totalTokens >= limits.maxTotalTokens) {
        return {
          exceeded: true,
          reason: `Token limit exceeded: ${state.totalTokens}/${limits.maxTotalTokens}`,
        };
      }

      if (state.totalCostUSD >= limits.maxCostUSD) {
        return {
          exceeded: true,
          reason: `Cost limit exceeded: $${state.totalCostUSD.toFixed(4)}/$${limits.maxCostUSD.toFixed(4)}`,
        };
      }

      if (state.totalLatencyMs >= limits.maxLatencyMs) {
        return {
          exceeded: true,
          reason: `Latency limit exceeded: ${state.totalLatencyMs}ms/${limits.maxLatencyMs}ms`,
        };
      }

      return { exceeded: false };
    },

    getState(): BudgetState {
      return { ...state };
    },
  };
}

/**
 * Error thrown when an agent run exceeds its budget.
 */
export class BudgetExceededError extends Error {
  constructor(reason: string) {
    super(`Agent budget exceeded: ${reason}`);
    this.name = 'BudgetExceededError';
  }
}
