import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_PRICING,
  calculateTokenCost,
  GEMINI_PRICING,
  getModelPricing,
  LOCAL_PRICING,
  type ModelPricing,
  OPENAI_PRICING,
} from '../src/pricing';

describe('LLM Pricing', () => {
  describe('Pricing Data Constants', () => {
    describe('OPENAI_PRICING', () => {
      it('should have pricing for gpt-4o models', () => {
        expect(OPENAI_PRICING['gpt-4o']).toEqual({
          prompt: 2.5,
          completion: 10,
        });
        expect(OPENAI_PRICING['gpt-4o-mini']).toEqual({
          prompt: 0.15,
          completion: 0.6,
        });
      });

      it('should have pricing for gpt-4 turbo models', () => {
        expect(OPENAI_PRICING['gpt-4-turbo']).toEqual({
          prompt: 10,
          completion: 30,
        });
      });

      it('should have pricing for legacy gpt-4 models', () => {
        expect(OPENAI_PRICING['gpt-4']).toEqual({
          prompt: 30,
          completion: 60,
        });
        expect(OPENAI_PRICING['gpt-4-32k']).toEqual({
          prompt: 60,
          completion: 120,
        });
      });

      it('should have pricing for gpt-3.5-turbo models', () => {
        expect(OPENAI_PRICING['gpt-3.5-turbo']).toEqual({
          prompt: 0.5,
          completion: 1.5,
        });
      });

      it('should have all prices as numbers greater than 0', () => {
        Object.values(OPENAI_PRICING).forEach((pricing) => {
          expect(typeof pricing.prompt).toBe('number');
          expect(typeof pricing.completion).toBe('number');
          expect(pricing.prompt).toBeGreaterThanOrEqual(0);
          expect(pricing.completion).toBeGreaterThan(0);
        });
      });

      it('should have completion price higher than prompt price', () => {
        Object.values(OPENAI_PRICING).forEach((pricing) => {
          expect(pricing.completion).toBeGreaterThanOrEqual(pricing.prompt);
        });
      });
    });

    describe('ANTHROPIC_PRICING', () => {
      it('should have pricing for claude-3.5-sonnet models', () => {
        expect(ANTHROPIC_PRICING['claude-3-5-sonnet-20241022']).toEqual({
          prompt: 3,
          completion: 15,
        });
      });

      it('should have pricing for claude-3 opus', () => {
        expect(ANTHROPIC_PRICING['claude-3-opus-20240229']).toEqual({
          prompt: 15,
          completion: 75,
        });
      });

      it('should have pricing for claude-3 sonnet', () => {
        expect(ANTHROPIC_PRICING['claude-3-sonnet-20240229']).toEqual({
          prompt: 3,
          completion: 15,
        });
      });

      it('should have pricing for claude-3 haiku', () => {
        expect(ANTHROPIC_PRICING['claude-3-haiku-20240307']).toEqual({
          prompt: 0.25,
          completion: 1.25,
        });
      });

      it('should have pricing for legacy claude models', () => {
        expect(ANTHROPIC_PRICING['claude-2.1']).toBeDefined();
        expect(ANTHROPIC_PRICING['claude-instant-1.2']).toBeDefined();
      });

      it('should have all prices as numbers greater than 0', () => {
        Object.values(ANTHROPIC_PRICING).forEach((pricing) => {
          expect(typeof pricing.prompt).toBe('number');
          expect(typeof pricing.completion).toBe('number');
          expect(pricing.prompt).toBeGreaterThan(0);
          expect(pricing.completion).toBeGreaterThan(0);
        });
      });
    });

    describe('GEMINI_PRICING', () => {
      it('should have pricing for gemini-1.5-pro models', () => {
        expect(GEMINI_PRICING['gemini-1.5-pro']).toEqual({
          prompt: 1.25,
          completion: 5,
        });
      });

      it('should have pricing for gemini-1.5-flash models', () => {
        expect(GEMINI_PRICING['gemini-1.5-flash']).toEqual({
          prompt: 0.075,
          completion: 0.3,
        });
        expect(GEMINI_PRICING['gemini-1.5-flash-8b']).toEqual({
          prompt: 0.0375,
          completion: 0.15,
        });
      });

      it('should have pricing for legacy gemini models', () => {
        expect(GEMINI_PRICING['gemini-pro']).toEqual({
          prompt: 0.5,
          completion: 1.5,
        });
      });

      it('should have all prices as numbers greater than 0', () => {
        Object.values(GEMINI_PRICING).forEach((pricing) => {
          expect(typeof pricing.prompt).toBe('number');
          expect(typeof pricing.completion).toBe('number');
          expect(pricing.prompt).toBeGreaterThan(0);
          expect(pricing.completion).toBeGreaterThan(0);
        });
      });
    });

    describe('LOCAL_PRICING', () => {
      it('should have zero pricing for local models', () => {
        expect(LOCAL_PRICING['claude-sonnet-4-5']).toEqual({
          prompt: 0,
          completion: 0,
        });
        expect(LOCAL_PRICING['claude-opus-4']).toEqual({
          prompt: 0,
          completion: 0,
        });
      });

      it('should have all prices as zero', () => {
        Object.values(LOCAL_PRICING).forEach((pricing) => {
          expect(pricing.prompt).toBe(0);
          expect(pricing.completion).toBe(0);
        });
      });
    });
  });

  describe('getModelPricing', () => {
    describe('OpenAI provider', () => {
      it('should return pricing for known openai model', () => {
        const pricing = getModelPricing('openai', 'gpt-4o');
        expect(pricing).toEqual({ prompt: 2.5, completion: 10 });
      });

      it('should return pricing for gpt-4o-mini', () => {
        const pricing = getModelPricing('openai', 'gpt-4o-mini');
        expect(pricing).toEqual({ prompt: 0.15, completion: 0.6 });
      });

      it('should fallback to gpt-4o-mini for unknown openai model', () => {
        const pricing = getModelPricing('openai', 'unknown-model');
        expect(pricing).toEqual(OPENAI_PRICING['gpt-4o-mini']);
      });

      it('should handle all openai models', () => {
        Object.keys(OPENAI_PRICING).forEach((model) => {
          const pricing = getModelPricing('openai', model);
          expect(pricing).toEqual(OPENAI_PRICING[model]);
        });
      });
    });

    describe('Anthropic provider', () => {
      it('should return pricing for known anthropic model', () => {
        const pricing = getModelPricing(
          'anthropic',
          'claude-3-5-sonnet-20241022',
        );
        expect(pricing).toEqual({ prompt: 3, completion: 15 });
      });

      it('should return pricing for claude-3-haiku', () => {
        const pricing = getModelPricing(
          'anthropic',
          'claude-3-haiku-20240307',
        );
        expect(pricing).toEqual({ prompt: 0.25, completion: 1.25 });
      });

      it('should fallback to claude-3-haiku for unknown anthropic model', () => {
        const pricing = getModelPricing('anthropic', 'unknown-model');
        expect(pricing).toEqual(ANTHROPIC_PRICING['claude-3-haiku-20240307']);
      });

      it('should handle all anthropic models', () => {
        Object.keys(ANTHROPIC_PRICING).forEach((model) => {
          const pricing = getModelPricing('anthropic', model);
          expect(pricing).toEqual(ANTHROPIC_PRICING[model]);
        });
      });
    });

    describe('Gemini provider', () => {
      it('should return pricing for known gemini model', () => {
        const pricing = getModelPricing('gemini', 'gemini-1.5-pro');
        expect(pricing).toEqual({ prompt: 1.25, completion: 5 });
      });

      it('should return pricing for gemini-1.5-flash', () => {
        const pricing = getModelPricing('gemini', 'gemini-1.5-flash');
        expect(pricing).toEqual({ prompt: 0.075, completion: 0.3 });
      });

      it('should fallback to gemini-1.5-flash for unknown gemini model', () => {
        const pricing = getModelPricing('gemini', 'unknown-model');
        expect(pricing).toEqual(GEMINI_PRICING['gemini-1.5-flash']);
      });

      it('should handle all gemini models', () => {
        Object.keys(GEMINI_PRICING).forEach((model) => {
          const pricing = getModelPricing('gemini', model);
          expect(pricing).toEqual(GEMINI_PRICING[model]);
        });
      });
    });

    describe('Local provider', () => {
      it('should return zero pricing for known local model', () => {
        const pricing = getModelPricing('local', 'claude-sonnet-4-5');
        expect(pricing).toEqual({ prompt: 0, completion: 0 });
      });

      it('should fallback to claude-sonnet-4-5 for unknown local model', () => {
        const pricing = getModelPricing('local', 'unknown-model');
        expect(pricing).toEqual(LOCAL_PRICING['claude-sonnet-4-5']);
      });

      it('should handle all local models', () => {
        Object.keys(LOCAL_PRICING).forEach((model) => {
          const pricing = getModelPricing('local', model);
          expect(pricing).toEqual(LOCAL_PRICING[model]);
        });
      });
    });

    describe('Fallback behavior', () => {
      it('should return default fallback for unknown provider', () => {
        const pricing = getModelPricing('unknown' as any, 'any-model');
        expect(pricing).toEqual({ prompt: 0.15, completion: 0.6 });
      });
    });
  });

  describe('calculateTokenCost', () => {
    describe('Basic calculations', () => {
      it('should calculate cost for 1 million prompt tokens', () => {
        const pricing: ModelPricing = { prompt: 2.5, completion: 10 };
        const cost = calculateTokenCost(1_000_000, 0, pricing);

        expect(cost.prompt).toBe(2.5);
        expect(cost.completion).toBe(0);
        expect(cost.total).toBe(2.5);
      });

      it('should calculate cost for 1 million completion tokens', () => {
        const pricing: ModelPricing = { prompt: 2.5, completion: 10 };
        const cost = calculateTokenCost(0, 1_000_000, pricing);

        expect(cost.prompt).toBe(0);
        expect(cost.completion).toBe(10);
        expect(cost.total).toBe(10);
      });

      it('should calculate cost for both prompt and completion tokens', () => {
        const pricing: ModelPricing = { prompt: 2.5, completion: 10 };
        const cost = calculateTokenCost(1_000_000, 1_000_000, pricing);

        expect(cost.prompt).toBe(2.5);
        expect(cost.completion).toBe(10);
        expect(cost.total).toBe(12.5);
      });
    });

    describe('Small token counts', () => {
      it('should calculate cost for 1000 tokens (typical request)', () => {
        const pricing: ModelPricing = { prompt: 2.5, completion: 10 };
        const cost = calculateTokenCost(500, 500, pricing);

        expect(cost.prompt).toBeCloseTo(0.00125, 5);
        expect(cost.completion).toBeCloseTo(0.005, 5);
        expect(cost.total).toBeCloseTo(0.00625, 5);
      });

      it('should calculate cost for 10,000 tokens', () => {
        const pricing: ModelPricing = { prompt: 3, completion: 15 };
        const cost = calculateTokenCost(5000, 5000, pricing);

        expect(cost.prompt).toBeCloseTo(0.015, 5);
        expect(cost.completion).toBeCloseTo(0.075, 5);
        expect(cost.total).toBeCloseTo(0.09, 5);
      });

      it('should calculate cost for 100 tokens', () => {
        const pricing: ModelPricing = { prompt: 0.15, completion: 0.6 };
        const cost = calculateTokenCost(50, 50, pricing);

        expect(cost.prompt).toBeCloseTo(0.0000075, 7);
        expect(cost.completion).toBeCloseTo(0.00003, 7);
        expect(cost.total).toBeCloseTo(0.0000375, 7);
      });
    });

    describe('Zero tokens', () => {
      it('should return zero cost for zero tokens', () => {
        const pricing: ModelPricing = { prompt: 2.5, completion: 10 };
        const cost = calculateTokenCost(0, 0, pricing);

        expect(cost.prompt).toBe(0);
        expect(cost.completion).toBe(0);
        expect(cost.total).toBe(0);
      });

      it('should handle zero completion tokens', () => {
        const pricing: ModelPricing = { prompt: 2.5, completion: 10 };
        const cost = calculateTokenCost(1000, 0, pricing);

        expect(cost.prompt).toBeCloseTo(0.0025, 5);
        expect(cost.completion).toBe(0);
        expect(cost.total).toBeCloseTo(0.0025, 5);
      });

      it('should handle zero prompt tokens', () => {
        const pricing: ModelPricing = { prompt: 2.5, completion: 10 };
        const cost = calculateTokenCost(0, 1000, pricing);

        expect(cost.prompt).toBe(0);
        expect(cost.completion).toBeCloseTo(0.01, 5);
        expect(cost.total).toBeCloseTo(0.01, 5);
      });
    });

    describe('Real-world scenarios', () => {
      it('should calculate cost for GPT-4o typical chat', () => {
        // 500 prompt tokens, 300 completion tokens
        const pricing = OPENAI_PRICING['gpt-4o']!;
        const cost = calculateTokenCost(500, 300, pricing);

        expect(cost.prompt).toBeCloseTo(0.00125, 5);
        expect(cost.completion).toBeCloseTo(0.003, 5);
        expect(cost.total).toBeCloseTo(0.00425, 5);
      });

      it('should calculate cost for Claude 3.5 Sonnet conversation', () => {
        // 1000 prompt tokens, 500 completion tokens
        const pricing = ANTHROPIC_PRICING['claude-3-5-sonnet-20241022']!;
        const cost = calculateTokenCost(1000, 500, pricing);

        expect(cost.prompt).toBeCloseTo(0.003, 5);
        expect(cost.completion).toBeCloseTo(0.0075, 5);
        expect(cost.total).toBeCloseTo(0.0105, 5);
      });

      it('should calculate cost for Gemini Flash request', () => {
        // 2000 prompt tokens, 1000 completion tokens
        const pricing = GEMINI_PRICING['gemini-1.5-flash']!;
        const cost = calculateTokenCost(2000, 1000, pricing);

        expect(cost.prompt).toBeCloseTo(0.00015, 5);
        expect(cost.completion).toBeCloseTo(0.0003, 5);
        expect(cost.total).toBeCloseTo(0.00045, 5);
      });

      it('should calculate zero cost for local model', () => {
        const pricing = LOCAL_PRICING['claude-sonnet-4-5']!;
        const cost = calculateTokenCost(10000, 10000, pricing);

        expect(cost.prompt).toBe(0);
        expect(cost.completion).toBe(0);
        expect(cost.total).toBe(0);
      });
    });

    describe('Large token counts', () => {
      it('should calculate cost for 100 million tokens', () => {
        const pricing: ModelPricing = { prompt: 2.5, completion: 10 };
        const cost = calculateTokenCost(50_000_000, 50_000_000, pricing);

        expect(cost.prompt).toBe(125);
        expect(cost.completion).toBe(500);
        expect(cost.total).toBe(625);
      });

      it('should handle very large numbers accurately', () => {
        const pricing: ModelPricing = { prompt: 30, completion: 60 };
        const cost = calculateTokenCost(10_000_000, 10_000_000, pricing);

        expect(cost.prompt).toBe(300);
        expect(cost.completion).toBe(600);
        expect(cost.total).toBe(900);
      });
    });

    describe('Edge cases', () => {
      it('should handle fractional token counts', () => {
        const pricing: ModelPricing = { prompt: 2.5, completion: 10 };
        const cost = calculateTokenCost(500.5, 300.3, pricing);

        expect(cost.prompt).toBeCloseTo(0.001251, 6);
        expect(cost.completion).toBeCloseTo(0.003003, 6);
        expect(cost.total).toBeCloseTo(0.004254, 6);
      });

      it('should handle very small pricing values', () => {
        const pricing: ModelPricing = { prompt: 0.001, completion: 0.002 };
        const cost = calculateTokenCost(1000, 1000, pricing);

        expect(cost.prompt).toBeCloseTo(0.000001, 9);
        expect(cost.completion).toBeCloseTo(0.000002, 9);
        expect(cost.total).toBeCloseTo(0.000003, 9);
      });

      it('should handle very large pricing values', () => {
        const pricing: ModelPricing = { prompt: 1000, completion: 2000 };
        const cost = calculateTokenCost(1_000_000, 1_000_000, pricing);

        expect(cost.prompt).toBe(1000);
        expect(cost.completion).toBe(2000);
        expect(cost.total).toBe(3000);
      });
    });

    describe('Cost structure validation', () => {
      it('should return object with correct structure', () => {
        const pricing: ModelPricing = { prompt: 2.5, completion: 10 };
        const cost = calculateTokenCost(1000, 1000, pricing);

        expect(cost).toHaveProperty('prompt');
        expect(cost).toHaveProperty('completion');
        expect(cost).toHaveProperty('total');
        expect(typeof cost.prompt).toBe('number');
        expect(typeof cost.completion).toBe('number');
        expect(typeof cost.total).toBe('number');
      });

      it('should have total equal to sum of prompt and completion', () => {
        const pricing: ModelPricing = { prompt: 2.5, completion: 10 };
        const cost = calculateTokenCost(1234, 5678, pricing);

        expect(cost.total).toBeCloseTo(cost.prompt + cost.completion, 10);
      });

      it('should never return negative costs', () => {
        const pricing: ModelPricing = { prompt: 2.5, completion: 10 };
        const cost = calculateTokenCost(1000, 1000, pricing);

        expect(cost.prompt).toBeGreaterThanOrEqual(0);
        expect(cost.completion).toBeGreaterThanOrEqual(0);
        expect(cost.total).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Price comparison', () => {
    it('should show gpt-4o-mini is cheapest openai model', () => {
      const miniPricing = OPENAI_PRICING['gpt-4o-mini']!;
      const gpt4Pricing = OPENAI_PRICING['gpt-4']!;

      expect(miniPricing.prompt).toBeLessThan(gpt4Pricing.prompt);
      expect(miniPricing.completion).toBeLessThan(gpt4Pricing.completion);
    });

    it('should show claude-3-haiku is cheapest anthropic model', () => {
      const haikuPricing = ANTHROPIC_PRICING['claude-3-haiku-20240307']!;
      const opusPricing = ANTHROPIC_PRICING['claude-3-opus-20240229']!;

      expect(haikuPricing.prompt).toBeLessThan(opusPricing.prompt);
      expect(haikuPricing.completion).toBeLessThan(opusPricing.completion);
    });

    it('should show gemini-1.5-flash-8b is cheapest gemini model', () => {
      const flash8bPricing = GEMINI_PRICING['gemini-1.5-flash-8b']!;
      const proPricing = GEMINI_PRICING['gemini-1.5-pro']!;

      expect(flash8bPricing.prompt).toBeLessThan(proPricing.prompt);
      expect(flash8bPricing.completion).toBeLessThan(proPricing.completion);
    });

    it('should show local models have zero cost', () => {
      Object.values(LOCAL_PRICING).forEach((pricing) => {
        expect(pricing.prompt).toBe(0);
        expect(pricing.completion).toBe(0);
      });
    });
  });
});
