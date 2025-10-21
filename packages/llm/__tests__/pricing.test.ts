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
  describe('OPENAI_PRICING', () => {
    it('should have pricing for GPT-4o models', () => {
      expect(OPENAI_PRICING['gpt-4o']).toBeDefined();
      expect(OPENAI_PRICING['gpt-4o-mini']).toBeDefined();
      expect(OPENAI_PRICING['gpt-4o-2024-08-06']).toBeDefined();
    });

    it('should have pricing for GPT-4 Turbo models', () => {
      expect(OPENAI_PRICING['gpt-4-turbo']).toBeDefined();
      expect(OPENAI_PRICING['gpt-4-turbo-preview']).toBeDefined();
    });

    it('should have pricing for GPT-4 models', () => {
      expect(OPENAI_PRICING['gpt-4']).toBeDefined();
      expect(OPENAI_PRICING['gpt-4-32k']).toBeDefined();
    });

    it('should have pricing for GPT-3.5 Turbo models', () => {
      expect(OPENAI_PRICING['gpt-3.5-turbo']).toBeDefined();
      expect(OPENAI_PRICING['gpt-3.5-turbo-0125']).toBeDefined();
    });

    it('should have correct structure for all models', () => {
      Object.values(OPENAI_PRICING).forEach((pricing) => {
        expect(pricing).toHaveProperty('prompt');
        expect(pricing).toHaveProperty('completion');
        expect(typeof pricing.prompt).toBe('number');
        expect(typeof pricing.completion).toBe('number');
        expect(pricing.prompt).toBeGreaterThan(0);
        expect(pricing.completion).toBeGreaterThan(0);
      });
    });

    it('should have gpt-4o-mini as cheapest option', () => {
      const miniPricing = OPENAI_PRICING['gpt-4o-mini']!;
      expect(miniPricing.prompt).toBe(0.15);
      expect(miniPricing.completion).toBe(0.6);
    });

    it('should have completion cost higher than prompt cost', () => {
      Object.values(OPENAI_PRICING).forEach((pricing) => {
        expect(pricing.completion).toBeGreaterThan(pricing.prompt);
      });
    });
  });

  describe('ANTHROPIC_PRICING', () => {
    it('should have pricing for Claude 3.5 models', () => {
      expect(ANTHROPIC_PRICING['claude-3-5-sonnet-20241022']).toBeDefined();
      expect(ANTHROPIC_PRICING['claude-3-5-sonnet-20240620']).toBeDefined();
    });

    it('should have pricing for Claude 3 models', () => {
      expect(ANTHROPIC_PRICING['claude-3-opus-20240229']).toBeDefined();
      expect(ANTHROPIC_PRICING['claude-3-sonnet-20240229']).toBeDefined();
      expect(ANTHROPIC_PRICING['claude-3-haiku-20240307']).toBeDefined();
    });

    it('should have pricing for legacy Claude models', () => {
      expect(ANTHROPIC_PRICING['claude-2.1']).toBeDefined();
      expect(ANTHROPIC_PRICING['claude-2.0']).toBeDefined();
      expect(ANTHROPIC_PRICING['claude-instant-1.2']).toBeDefined();
    });

    it('should have correct structure for all models', () => {
      Object.values(ANTHROPIC_PRICING).forEach((pricing) => {
        expect(pricing).toHaveProperty('prompt');
        expect(pricing).toHaveProperty('completion');
        expect(typeof pricing.prompt).toBe('number');
        expect(typeof pricing.completion).toBe('number');
        expect(pricing.prompt).toBeGreaterThan(0);
        expect(pricing.completion).toBeGreaterThan(0);
      });
    });

    it('should have haiku as cheapest option', () => {
      const haikuPricing = ANTHROPIC_PRICING['claude-3-haiku-20240307']!;
      expect(haikuPricing.prompt).toBe(0.25);
      expect(haikuPricing.completion).toBe(1.25);
    });

    it('should have opus as most expensive option', () => {
      const opusPricing = ANTHROPIC_PRICING['claude-3-opus-20240229']!;
      const allPricing = Object.values(ANTHROPIC_PRICING);
      const maxPromptCost = Math.max(...allPricing.map((p) => p.prompt));
      const maxCompletionCost = Math.max(
        ...allPricing.map((p) => p.completion),
      );
      expect(opusPricing.prompt).toBe(maxPromptCost);
      expect(opusPricing.completion).toBe(maxCompletionCost);
    });
  });

  describe('GEMINI_PRICING', () => {
    it('should have pricing for Gemini 1.5 Pro models', () => {
      expect(GEMINI_PRICING['gemini-1.5-pro']).toBeDefined();
      expect(GEMINI_PRICING['gemini-1.5-pro-001']).toBeDefined();
      expect(GEMINI_PRICING['gemini-1.5-pro-002']).toBeDefined();
    });

    it('should have pricing for Gemini 1.5 Flash models', () => {
      expect(GEMINI_PRICING['gemini-1.5-flash']).toBeDefined();
      expect(GEMINI_PRICING['gemini-1.5-flash-001']).toBeDefined();
      expect(GEMINI_PRICING['gemini-1.5-flash-8b']).toBeDefined();
    });

    it('should have pricing for legacy Gemini models', () => {
      expect(GEMINI_PRICING['gemini-pro']).toBeDefined();
      expect(GEMINI_PRICING['gemini-1.0-pro']).toBeDefined();
    });

    it('should have correct structure for all models', () => {
      Object.values(GEMINI_PRICING).forEach((pricing) => {
        expect(pricing).toHaveProperty('prompt');
        expect(pricing).toHaveProperty('completion');
        expect(typeof pricing.prompt).toBe('number');
        expect(typeof pricing.completion).toBe('number');
        expect(pricing.prompt).toBeGreaterThanOrEqual(0);
        expect(pricing.completion).toBeGreaterThan(0);
      });
    });

    it('should have flash-8b as cheapest option', () => {
      const flash8bPricing = GEMINI_PRICING['gemini-1.5-flash-8b']!;
      expect(flash8bPricing.prompt).toBe(0.0375);
      expect(flash8bPricing.completion).toBe(0.15);
    });
  });

  describe('LOCAL_PRICING', () => {
    it('should have pricing for local Claude models', () => {
      expect(LOCAL_PRICING['claude-sonnet-4-5']).toBeDefined();
      expect(LOCAL_PRICING['claude-sonnet-4']).toBeDefined();
      expect(LOCAL_PRICING['claude-opus-4']).toBeDefined();
      expect(LOCAL_PRICING['claude-haiku-4']).toBeDefined();
    });

    it('should have zero cost for all local models', () => {
      Object.values(LOCAL_PRICING).forEach((pricing) => {
        expect(pricing.prompt).toBe(0);
        expect(pricing.completion).toBe(0);
      });
    });

    it('should have correct structure for all models', () => {
      Object.values(LOCAL_PRICING).forEach((pricing) => {
        expect(pricing).toHaveProperty('prompt');
        expect(pricing).toHaveProperty('completion');
        expect(typeof pricing.prompt).toBe('number');
        expect(typeof pricing.completion).toBe('number');
      });
    });
  });

  describe('getModelPricing', () => {
    describe('OpenAI provider', () => {
      it('should return correct pricing for known model', () => {
        const pricing = getModelPricing('openai', 'gpt-4o');
        expect(pricing).toEqual({ prompt: 2.5, completion: 10 });
      });

      it('should return gpt-4o-mini pricing for unknown model', () => {
        const pricing = getModelPricing('openai', 'unknown-model');
        expect(pricing).toEqual({ prompt: 0.15, completion: 0.6 });
      });

      it('should handle all documented OpenAI models', () => {
        const models = Object.keys(OPENAI_PRICING);
        models.forEach((model) => {
          const pricing = getModelPricing('openai', model);
          expect(pricing).toEqual(OPENAI_PRICING[model]);
        });
      });
    });

    describe('Anthropic provider', () => {
      it('should return correct pricing for known model', () => {
        const pricing = getModelPricing(
          'anthropic',
          'claude-3-5-sonnet-20241022',
        );
        expect(pricing).toEqual({ prompt: 3, completion: 15 });
      });

      it('should return haiku pricing for unknown model', () => {
        const pricing = getModelPricing('anthropic', 'unknown-model');
        expect(pricing).toEqual({ prompt: 0.25, completion: 1.25 });
      });

      it('should handle all documented Anthropic models', () => {
        const models = Object.keys(ANTHROPIC_PRICING);
        models.forEach((model) => {
          const pricing = getModelPricing('anthropic', model);
          expect(pricing).toEqual(ANTHROPIC_PRICING[model]);
        });
      });
    });

    describe('Gemini provider', () => {
      it('should return correct pricing for known model', () => {
        const pricing = getModelPricing('gemini', 'gemini-1.5-pro');
        expect(pricing).toEqual({ prompt: 1.25, completion: 5 });
      });

      it('should return flash pricing for unknown model', () => {
        const pricing = getModelPricing('gemini', 'unknown-model');
        expect(pricing).toEqual({ prompt: 0.075, completion: 0.3 });
      });

      it('should handle all documented Gemini models', () => {
        const models = Object.keys(GEMINI_PRICING);
        models.forEach((model) => {
          const pricing = getModelPricing('gemini', model);
          expect(pricing).toEqual(GEMINI_PRICING[model]);
        });
      });
    });

    describe('Local provider', () => {
      it('should return zero pricing for known model', () => {
        const pricing = getModelPricing('local', 'claude-sonnet-4-5');
        expect(pricing).toEqual({ prompt: 0, completion: 0 });
      });

      it('should return zero pricing for unknown model', () => {
        const pricing = getModelPricing('local', 'unknown-model');
        expect(pricing).toEqual({ prompt: 0, completion: 0 });
      });

      it('should handle all documented local models', () => {
        const models = Object.keys(LOCAL_PRICING);
        models.forEach((model) => {
          const pricing = getModelPricing('local', model);
          expect(pricing).toEqual(LOCAL_PRICING[model]);
        });
      });
    });

    describe('Unknown provider', () => {
      it('should return fallback pricing for unknown provider', () => {
        const pricing = getModelPricing('unknown' as any, 'any-model');
        expect(pricing).toEqual({ prompt: 0.15, completion: 0.6 });
      });
    });
  });

  describe('calculateTokenCost', () => {
    const testPricing: ModelPricing = {
      prompt: 2.5, // $2.50 per 1M tokens
      completion: 10, // $10.00 per 1M tokens
    };

    describe('Basic calculations', () => {
      it('should calculate cost for 1 million prompt tokens', () => {
        const cost = calculateTokenCost(1_000_000, 0, testPricing);
        expect(cost.prompt).toBe(2.5);
        expect(cost.completion).toBe(0);
        expect(cost.total).toBe(2.5);
      });

      it('should calculate cost for 1 million completion tokens', () => {
        const cost = calculateTokenCost(0, 1_000_000, testPricing);
        expect(cost.prompt).toBe(0);
        expect(cost.completion).toBe(10);
        expect(cost.total).toBe(10);
      });

      it('should calculate cost for both prompt and completion tokens', () => {
        const cost = calculateTokenCost(1_000_000, 1_000_000, testPricing);
        expect(cost.prompt).toBe(2.5);
        expect(cost.completion).toBe(10);
        expect(cost.total).toBe(12.5);
      });
    });

    describe('Small token counts', () => {
      it('should calculate cost for 1000 tokens', () => {
        const cost = calculateTokenCost(1000, 1000, testPricing);
        expect(cost.prompt).toBeCloseTo(0.0025, 6);
        expect(cost.completion).toBeCloseTo(0.01, 6);
        expect(cost.total).toBeCloseTo(0.0125, 6);
      });

      it('should calculate cost for 100 tokens', () => {
        const cost = calculateTokenCost(100, 100, testPricing);
        expect(cost.prompt).toBeCloseTo(0.00025, 6);
        expect(cost.completion).toBeCloseTo(0.001, 6);
        expect(cost.total).toBeCloseTo(0.00125, 6);
      });

      it('should calculate cost for 10 tokens', () => {
        const cost = calculateTokenCost(10, 10, testPricing);
        expect(cost.prompt).toBeCloseTo(0.000025, 8);
        expect(cost.completion).toBeCloseTo(0.0001, 8);
        expect(cost.total).toBeCloseTo(0.000125, 8);
      });
    });

    describe('Realistic usage scenarios', () => {
      it('should calculate cost for typical chat completion (500 prompt, 200 completion)', () => {
        const cost = calculateTokenCost(500, 200, testPricing);
        expect(cost.prompt).toBeCloseTo(0.00125, 6);
        expect(cost.completion).toBeCloseTo(0.002, 6);
        expect(cost.total).toBeCloseTo(0.00325, 6);
      });

      it('should calculate cost for long document processing (10k prompt, 2k completion)', () => {
        const cost = calculateTokenCost(10_000, 2_000, testPricing);
        expect(cost.prompt).toBeCloseTo(0.025, 6);
        expect(cost.completion).toBeCloseTo(0.02, 6);
        expect(cost.total).toBeCloseTo(0.045, 6);
      });

      it('should calculate cost for batch processing (100k prompt, 50k completion)', () => {
        const cost = calculateTokenCost(100_000, 50_000, testPricing);
        expect(cost.prompt).toBeCloseTo(0.25, 6);
        expect(cost.completion).toBeCloseTo(0.5, 6);
        expect(cost.total).toBeCloseTo(0.75, 6);
      });
    });

    describe('Edge cases', () => {
      it('should handle zero tokens', () => {
        const cost = calculateTokenCost(0, 0, testPricing);
        expect(cost.prompt).toBe(0);
        expect(cost.completion).toBe(0);
        expect(cost.total).toBe(0);
      });

      it('should handle only prompt tokens', () => {
        const cost = calculateTokenCost(5000, 0, testPricing);
        expect(cost.prompt).toBeGreaterThan(0);
        expect(cost.completion).toBe(0);
        expect(cost.total).toBe(cost.prompt);
      });

      it('should handle only completion tokens', () => {
        const cost = calculateTokenCost(0, 5000, testPricing);
        expect(cost.prompt).toBe(0);
        expect(cost.completion).toBeGreaterThan(0);
        expect(cost.total).toBe(cost.completion);
      });

      it('should handle very large token counts', () => {
        const cost = calculateTokenCost(10_000_000, 5_000_000, testPricing);
        expect(cost.prompt).toBe(25);
        expect(cost.completion).toBe(50);
        expect(cost.total).toBe(75);
      });

      it('should handle fractional token counts', () => {
        const cost = calculateTokenCost(1500.5, 750.75, testPricing);
        expect(cost.prompt).toBeCloseTo(0.00375125, 8);
        expect(cost.completion).toBeCloseTo(0.0075075, 8);
        expect(cost.total).toBeCloseTo(0.01125875, 8);
      });
    });

    describe('Different pricing models', () => {
      it('should calculate cost for cheap model (GPT-4o-mini)', () => {
        const cheapPricing = OPENAI_PRICING['gpt-4o-mini']!;
        const cost = calculateTokenCost(10_000, 5_000, cheapPricing);
        expect(cost.prompt).toBeCloseTo(0.0015, 6);
        expect(cost.completion).toBeCloseTo(0.003, 6);
        expect(cost.total).toBeCloseTo(0.0045, 6);
      });

      it('should calculate cost for expensive model (GPT-4)', () => {
        const expensivePricing = OPENAI_PRICING['gpt-4']!;
        const cost = calculateTokenCost(10_000, 5_000, expensivePricing);
        expect(cost.prompt).toBeCloseTo(0.3, 6);
        expect(cost.completion).toBeCloseTo(0.3, 6);
        expect(cost.total).toBeCloseTo(0.6, 6);
      });

      it('should calculate zero cost for local models', () => {
        const localPricing = LOCAL_PRICING['claude-sonnet-4-5']!;
        const cost = calculateTokenCost(10_000, 5_000, localPricing);
        expect(cost.prompt).toBe(0);
        expect(cost.completion).toBe(0);
        expect(cost.total).toBe(0);
      });
    });

    describe('Cost comparison', () => {
      const tokens = { prompt: 10_000, completion: 5_000 };

      it('should show GPT-4 is more expensive than GPT-4o-mini', () => {
        const gpt4Cost = calculateTokenCost(
          tokens.prompt,
          tokens.completion,
          OPENAI_PRICING['gpt-4']!,
        );
        const miniCost = calculateTokenCost(
          tokens.prompt,
          tokens.completion,
          OPENAI_PRICING['gpt-4o-mini']!,
        );
        expect(gpt4Cost.total).toBeGreaterThan(miniCost.total);
      });

      it('should show Claude Opus is more expensive than Claude Haiku', () => {
        const opusCost = calculateTokenCost(
          tokens.prompt,
          tokens.completion,
          ANTHROPIC_PRICING['claude-3-opus-20240229']!,
        );
        const haikuCost = calculateTokenCost(
          tokens.prompt,
          tokens.completion,
          ANTHROPIC_PRICING['claude-3-haiku-20240307']!,
        );
        expect(opusCost.total).toBeGreaterThan(haikuCost.total);
      });

      it('should show Gemini Pro is more expensive than Gemini Flash', () => {
        const proCost = calculateTokenCost(
          tokens.prompt,
          tokens.completion,
          GEMINI_PRICING['gemini-1.5-pro']!,
        );
        const flashCost = calculateTokenCost(
          tokens.prompt,
          tokens.completion,
          GEMINI_PRICING['gemini-1.5-flash']!,
        );
        expect(proCost.total).toBeGreaterThan(flashCost.total);
      });
    });

    describe('Return value structure', () => {
      it('should return object with prompt, completion, and total properties', () => {
        const cost = calculateTokenCost(1000, 500, testPricing);
        expect(cost).toHaveProperty('prompt');
        expect(cost).toHaveProperty('completion');
        expect(cost).toHaveProperty('total');
        expect(typeof cost.prompt).toBe('number');
        expect(typeof cost.completion).toBe('number');
        expect(typeof cost.total).toBe('number');
      });

      it('should have total equal to sum of prompt and completion', () => {
        const cost = calculateTokenCost(7500, 3200, testPricing);
        expect(cost.total).toBeCloseTo(cost.prompt + cost.completion, 10);
      });

      it('should have non-negative values', () => {
        const cost = calculateTokenCost(5000, 2500, testPricing);
        expect(cost.prompt).toBeGreaterThanOrEqual(0);
        expect(cost.completion).toBeGreaterThanOrEqual(0);
        expect(cost.total).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
