import { describe, expect, it } from 'vitest';

import {
    createBudgetTracker,
    BudgetExceededError,
} from '../src/budget';

describe('BudgetTracker', () => {
    describe('createBudgetTracker', () => {
        it('should create a tracker with zero initial state', () => {
            const tracker = createBudgetTracker({
                maxTotalTokens: 10000,
                maxCostUSD: 1.0,
                maxLatencyMs: 60000,
            });

            const state = tracker.getState();
            expect(state.totalTokens).toBe(0);
            expect(state.totalCostUSD).toBe(0);
            expect(state.totalLatencyMs).toBe(0);
            expect(state.stepCount).toBe(0);
        });

        it('should not be exceeded when freshly created', () => {
            const tracker = createBudgetTracker({
                maxTotalTokens: 10000,
                maxCostUSD: 1.0,
                maxLatencyMs: 60000,
            });

            const check = tracker.isExceeded();
            expect(check.exceeded).toBe(false);
            expect(check.reason).toBeUndefined();
        });
    });

    describe('record', () => {
        it('should accumulate tokens across multiple records', () => {
            const tracker = createBudgetTracker({
                maxTotalTokens: 10000,
                maxCostUSD: 1.0,
                maxLatencyMs: 60000,
            });

            tracker.record(1500, 0.02, 3000);
            tracker.record(2000, 0.03, 4000);

            const state = tracker.getState();
            expect(state.totalTokens).toBe(3500);
            expect(state.totalCostUSD).toBeCloseTo(0.05);
            expect(state.totalLatencyMs).toBe(7000);
            expect(state.stepCount).toBe(2);
        });

        it('should increment step count per record', () => {
            const tracker = createBudgetTracker({
                maxTotalTokens: 100000,
                maxCostUSD: 10.0,
                maxLatencyMs: 600000,
            });

            tracker.record(100, 0.001, 100);
            tracker.record(100, 0.001, 100);
            tracker.record(100, 0.001, 100);

            expect(tracker.getState().stepCount).toBe(3);
        });
    });

    describe('isExceeded', () => {
        it('should detect token limit exceeded', () => {
            const tracker = createBudgetTracker({
                maxTotalTokens: 5000,
                maxCostUSD: 1.0,
                maxLatencyMs: 60000,
            });

            tracker.record(5000, 0.01, 1000);

            const check = tracker.isExceeded();
            expect(check.exceeded).toBe(true);
            expect(check.reason).toContain('Token limit exceeded');
            expect(check.reason).toContain('5000');
        });

        it('should detect cost limit exceeded', () => {
            const tracker = createBudgetTracker({
                maxTotalTokens: 100000,
                maxCostUSD: 0.50,
                maxLatencyMs: 60000,
            });

            tracker.record(1000, 0.50, 1000);

            const check = tracker.isExceeded();
            expect(check.exceeded).toBe(true);
            expect(check.reason).toContain('Cost limit exceeded');
        });

        it('should detect latency limit exceeded', () => {
            const tracker = createBudgetTracker({
                maxTotalTokens: 100000,
                maxCostUSD: 10.0,
                maxLatencyMs: 30000,
            });

            tracker.record(1000, 0.01, 30000);

            const check = tracker.isExceeded();
            expect(check.exceeded).toBe(true);
            expect(check.reason).toContain('Latency limit exceeded');
        });

        it('should not be exceeded when below all limits', () => {
            const tracker = createBudgetTracker({
                maxTotalTokens: 10000,
                maxCostUSD: 1.0,
                maxLatencyMs: 60000,
            });

            tracker.record(5000, 0.40, 25000);

            const check = tracker.isExceeded();
            expect(check.exceeded).toBe(false);
        });

        it('should detect the first exceeded limit', () => {
            const tracker = createBudgetTracker({
                maxTotalTokens: 100,
                maxCostUSD: 0.01,
                maxLatencyMs: 100,
            });

            // All limits exceeded at once — token is checked first
            tracker.record(200, 0.02, 200);

            const check = tracker.isExceeded();
            expect(check.exceeded).toBe(true);
            expect(check.reason).toContain('Token limit exceeded');
        });
    });

    describe('getState', () => {
        it('should return a snapshot (not a reference)', () => {
            const tracker = createBudgetTracker({
                maxTotalTokens: 10000,
                maxCostUSD: 1.0,
                maxLatencyMs: 60000,
            });

            tracker.record(1000, 0.01, 1000);
            const state1 = tracker.getState();

            tracker.record(2000, 0.02, 2000);
            const state2 = tracker.getState();

            // state1 should not have been mutated
            expect(state1.totalTokens).toBe(1000);
            expect(state2.totalTokens).toBe(3000);
        });
    });
});

describe('BudgetExceededError', () => {
    it('should have the correct name', () => {
        const error = new BudgetExceededError('test reason');
        expect(error.name).toBe('BudgetExceededError');
    });

    it('should include the reason in the message', () => {
        const error = new BudgetExceededError('Token limit');
        expect(error.message).toContain('Token limit');
        expect(error.message).toContain('budget exceeded');
    });

    it('should be an instance of Error', () => {
        const error = new BudgetExceededError('test');
        expect(error).toBeInstanceOf(Error);
    });
});
