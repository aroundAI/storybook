/**
 * Prompt Template Queries Tests
 *
 * Tests for all server queries that fetch prompt data:
 * - Template queries
 * - System prompt queries
 * - Variant queries
 * - Variant assignment queries
 * - Experiment queries
 * - Performance queries
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Import queries after mocks are set up
import {
  calculateAttributionScores,
  composeSystemPromptsForTemplate,
  getAccountAssignedVariant,
  getAccountVariantAssignments,
  getActiveExperiments,
  getAllTemplates,
  getBestComposition,
  getCompositionPerformance,
  getExecutionLogs,
  getExperimentResults,
  getSystemPromptsByScope,
  getSystemPromptsForTemplate,
  getTemplate,
  getTemplateVariants,
  getTemplateWithSystemPrompts,
  getVariantAssignments,
  resolveTemplate,
  resolveVariantForAccount,
  selectVariant,
} from '../src/lib/server/prompt.queries';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Mock React cache
vi.mock('react', () => ({
  cache: (fn: unknown) => fn,
}));

const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockOr = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockGte = vi.fn();
const mockSingle = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

const mockSupabaseClient = {
  from: mockFrom,
  rpc: mockRpc,
} as unknown as SupabaseClient;

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => mockSupabaseClient),
}));

// Mock the composer
vi.mock('../src/lib/engine/composer', () => ({
  composeSystemPrompts: vi.fn((prompts: unknown[]) => ({
    system_prompts: prompts,
    composition_hash: 'mock-hash-123',
    layers_used: ['compliance', 'role'],
    total_prompts: prompts.length,
  })),
}));

// Valid UUIDs for testing
const TEMPLATE_ID = '550e8400-e29b-41d4-a716-446655440000';
const SYSTEM_PROMPT_ID = '550e8400-e29b-41d4-a716-446655440001';
const VARIANT_ID = '550e8400-e29b-41d4-a716-446655440002';
const ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440003';
const EXPERIMENT_ID = '550e8400-e29b-41d4-a716-446655440004';

describe('Prompt Template Queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default chain behavior
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect.mockReturnValue({ eq: mockEq, or: mockOr, order: mockOrder });
    mockEq.mockReturnValue({
      eq: mockEq,
      or: mockOr,
      order: mockOrder,
      single: mockSingle,
      limit: mockLimit,
      gte: mockGte,
    });
    mockOr.mockReturnValue({ order: mockOrder });
    mockOrder.mockReturnValue({
      order: mockOrder,
      limit: mockLimit,
      then: (resolve: (value: { data: unknown; error: null }) => void) => {
        resolve({ data: [], error: null });
        return Promise.resolve({ data: [], error: null });
      },
    });
    mockLimit.mockReturnValue({ single: mockSingle });
    mockGte.mockReturnValue({ order: mockOrder });
    mockSingle.mockResolvedValue({ data: null, error: null });
  });

  describe('Template Queries', () => {
    describe('getAllTemplates', () => {
      it('should fetch all active templates', async () => {
        const mockTemplates = [
          {
            id: TEMPLATE_ID,
            slug: 'customer-support',
            name: 'Customer Support',
            category: 'conversation',
            is_active: true,
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440010',
            slug: 'content-generation',
            name: 'Content Generation',
            category: 'generation',
            is_active: true,
          },
        ];

        mockOrder.mockResolvedValue({ data: mockTemplates, error: null });

        const result = await getAllTemplates();

        expect(result).toEqual(mockTemplates);
        expect(mockFrom).toHaveBeenCalledWith('prompt_templates');
        expect(mockSelect).toHaveBeenCalledWith('*');
        expect(mockEq).toHaveBeenCalledWith('is_active', true);
        expect(mockOrder).toHaveBeenCalledWith('created_at', {
          ascending: false,
        });
      });

      it('should throw error when query fails', async () => {
        const mockError = new Error('Database error');
        mockOrder.mockResolvedValue({ data: null, error: mockError });

        await expect(getAllTemplates()).rejects.toThrow('Database error');
      });
    });

    describe('getTemplate', () => {
      it('should fetch template by ID', async () => {
        const mockTemplate = {
          id: TEMPLATE_ID,
          slug: 'customer-support',
          name: 'Customer Support',
          template_content: 'Hello {{name}}',
          category: 'conversation',
        };

        mockSingle.mockResolvedValue({ data: mockTemplate, error: null });

        const result = await getTemplate(TEMPLATE_ID);

        expect(result).toEqual(mockTemplate);
        expect(mockFrom).toHaveBeenCalledWith('prompt_templates');
        expect(mockEq).toHaveBeenCalledWith('id', TEMPLATE_ID);
        expect(mockSingle).toHaveBeenCalled();
      });

      it('should throw error when template not found', async () => {
        const mockError = new Error('Not found');
        mockSingle.mockResolvedValue({ data: null, error: mockError });

        await expect(getTemplate(TEMPLATE_ID)).rejects.toThrow('Not found');
      });
    });

    describe('resolveTemplate', () => {
      it('should resolve template by slug and environment', async () => {
        const mockTemplateId = TEMPLATE_ID;

        mockRpc.mockResolvedValue({ data: mockTemplateId, error: null });

        const result = await resolveTemplate('customer-support', 'production');

        expect(result).toBe(mockTemplateId);
        expect(mockRpc).toHaveBeenCalledWith('resolve_template', {
          p_slug: 'customer-support',
          p_environment: 'production',
        });
      });

      it('should default to production environment', async () => {
        mockRpc.mockResolvedValue({ data: TEMPLATE_ID, error: null });

        await resolveTemplate('customer-support');

        expect(mockRpc).toHaveBeenCalledWith('resolve_template', {
          p_slug: 'customer-support',
          p_environment: 'production',
        });
      });
    });

    describe('getTemplateWithSystemPrompts', () => {
      it('should fetch template with linked system prompts', async () => {
        const mockData = {
          id: TEMPLATE_ID,
          name: 'Customer Support',
          template_system_prompt_links: [
            {
              order_index: 0,
              condition_rules: null,
              system_prompt: {
                id: SYSTEM_PROMPT_ID,
                slug: 'compliance',
                content: 'Follow GDPR',
              },
            },
          ],
        };

        mockSingle.mockResolvedValue({ data: mockData, error: null });

        const result = await getTemplateWithSystemPrompts(TEMPLATE_ID);

        expect(result).toEqual(mockData);
        expect(mockSelect).toHaveBeenCalledWith(
          expect.stringContaining('template_system_prompt_links'),
        );
      });
    });
  });

  describe('System Prompt Queries', () => {
    describe('getSystemPromptsForTemplate', () => {
      it('should fetch system prompts for template', async () => {
        const mockTemplate = {
          id: TEMPLATE_ID,
          category: 'conversation',
        };

        const mockSystemPrompts = [
          {
            id: SYSTEM_PROMPT_ID,
            slug: 'compliance',
            layer_type: 'compliance',
            scope: 'global',
            is_active: true,
          },
        ];

        mockSingle.mockResolvedValueOnce({
          data: mockTemplate,
          error: null,
        });
        mockOrder.mockResolvedValue({
          data: mockSystemPrompts,
          error: null,
        });

        const result = await getSystemPromptsForTemplate(TEMPLATE_ID);

        expect(result).toEqual(mockSystemPrompts);
        expect(mockFrom).toHaveBeenCalledWith('prompt_system_prompts');
      });

      it('should throw error when template not found', async () => {
        const mockError = new Error('Not found');
        mockSingle.mockResolvedValue({ data: null, error: mockError });

        await expect(getSystemPromptsForTemplate(TEMPLATE_ID)).rejects.toThrow(
          'Not found',
        );
      });
    });

    describe('getSystemPromptsByScope', () => {
      it('should fetch global system prompts', async () => {
        const mockPrompts = [
          {
            id: SYSTEM_PROMPT_ID,
            slug: 'compliance-gdpr',
            scope: 'global',
            layer_type: 'compliance',
          },
        ];

        mockOrder.mockReturnValue({
          order: mockOrder,
          then: (resolve: (value: { data: unknown; error: null }) => void) => {
            resolve({ data: mockPrompts, error: null });
            return Promise.resolve({ data: mockPrompts, error: null });
          },
        });

        const result = await getSystemPromptsByScope('global');

        expect(result).toEqual(mockPrompts);
        expect(mockEq).toHaveBeenCalledWith('scope', 'global');
        expect(mockEq).toHaveBeenCalledWith('is_active', true);
      });
    });

    describe('composeSystemPromptsForTemplate', () => {
      it('should compose system prompts with context', async () => {
        const mockTemplate = {
          id: TEMPLATE_ID,
          category: 'conversation',
        };

        const mockSystemPrompts = [
          {
            id: SYSTEM_PROMPT_ID,
            slug: 'compliance',
            layer_type: 'compliance',
            scope: 'global',
            is_active: true,
            condition_rules: null,
          },
        ];

        mockRpc.mockResolvedValue({ data: 'composed-text', error: null });
        mockSingle.mockResolvedValueOnce({
          data: mockTemplate,
          error: null,
        });
        mockOrder.mockResolvedValue({
          data: mockSystemPrompts,
          error: null,
        });

        const result = await composeSystemPromptsForTemplate(TEMPLATE_ID, {
          region: 'eu',
        });

        expect(result).toHaveProperty('template_id', TEMPLATE_ID);
        expect(result).toHaveProperty('composition_hash');
        expect(mockRpc).toHaveBeenCalledWith('compose_system_prompts', {
          p_template_id: TEMPLATE_ID,
          p_context: { region: 'eu' },
        });
      });

      it('should filter prompts based on context conditions', async () => {
        const mockTemplate = {
          id: TEMPLATE_ID,
          category: 'conversation',
        };

        const mockSystemPrompts = [
          {
            id: SYSTEM_PROMPT_ID,
            slug: 'compliance-eu',
            layer_type: 'compliance',
            scope: 'global',
            is_active: true,
            condition_rules: { region: 'eu' },
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440020',
            slug: 'compliance-us',
            layer_type: 'compliance',
            scope: 'global',
            is_active: true,
            condition_rules: { region: 'us' },
          },
        ];

        mockRpc.mockResolvedValue({ data: 'composed-text', error: null });
        mockSingle.mockResolvedValueOnce({
          data: mockTemplate,
          error: null,
        });
        mockOrder.mockResolvedValue({
          data: mockSystemPrompts,
          error: null,
        });

        const result = await composeSystemPromptsForTemplate(TEMPLATE_ID, {
          region: 'eu',
        });

        // Should only include EU prompt
        expect(result.system_prompts).toHaveLength(1);
        expect(result.system_prompts[0]?.slug).toBe('compliance-eu');
      });
    });
  });

  describe('Variant Queries', () => {
    describe('getTemplateVariants', () => {
      it('should fetch all variants for template', async () => {
        const mockVariants = [
          {
            id: VARIANT_ID,
            template_id: TEMPLATE_ID,
            variant_name: 'Friendly Tone',
            is_active: true,
            traffic_weight: 50,
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440030',
            template_id: TEMPLATE_ID,
            variant_name: 'Professional Tone',
            is_active: true,
            traffic_weight: 50,
          },
        ];

        mockOrder.mockResolvedValue({ data: mockVariants, error: null });

        const result = await getTemplateVariants(TEMPLATE_ID);

        expect(result).toEqual(mockVariants);
        expect(mockEq).toHaveBeenCalledWith('template_id', TEMPLATE_ID);
        expect(mockEq).toHaveBeenCalledWith('is_active', true);
      });
    });

    describe('selectVariant', () => {
      it('should select variant based on traffic weights', async () => {
        const mockVariants = [
          {
            id: VARIANT_ID,
            template_id: TEMPLATE_ID,
            variant_name: 'Variant A',
            traffic_weight: 30,
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440030',
            template_id: TEMPLATE_ID,
            variant_name: 'Variant B',
            traffic_weight: 70,
          },
        ];

        mockOrder.mockResolvedValue({ data: mockVariants, error: null });

        // Mock random to select first variant
        vi.spyOn(Math, 'random').mockReturnValue(0.1); // 10% - should select Variant A

        const result = await selectVariant(TEMPLATE_ID);

        expect(result).toEqual(mockVariants[0]);
      });

      it('should return null when no variants exist', async () => {
        mockOrder.mockResolvedValue({ data: [], error: null });

        const result = await selectVariant(TEMPLATE_ID);

        expect(result).toBeNull();
      });

      it('should select variant B with high random value', async () => {
        const mockVariants = [
          {
            id: VARIANT_ID,
            template_id: TEMPLATE_ID,
            variant_name: 'Variant A',
            traffic_weight: 30,
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440030',
            template_id: TEMPLATE_ID,
            variant_name: 'Variant B',
            traffic_weight: 70,
          },
        ];

        mockOrder.mockResolvedValue({ data: mockVariants, error: null });

        // Mock random to select second variant
        vi.spyOn(Math, 'random').mockReturnValue(0.8); // 80% - should select Variant B

        const result = await selectVariant(TEMPLATE_ID);

        expect(result).toEqual(mockVariants[1]);
      });
    });
  });

  describe('Variant Assignment Queries', () => {
    describe('getVariantAssignments', () => {
      it('should fetch all accounts assigned to variant', async () => {
        const mockAssignments = [
          {
            id: '550e8400-e29b-41d4-a716-446655440050',
            variant_id: VARIANT_ID,
            account_id: ACCOUNT_ID,
            account: {
              id: ACCOUNT_ID,
              name: 'Test Account',
              slug: 'test-account',
            },
          },
        ];

        mockOrder.mockResolvedValue({ data: mockAssignments, error: null });

        const result = await getVariantAssignments(VARIANT_ID);

        expect(result).toEqual(mockAssignments);
        expect(mockEq).toHaveBeenCalledWith('variant_id', VARIANT_ID);
      });
    });

    describe('getAccountAssignedVariant', () => {
      it('should fetch assigned variant for account', async () => {
        const mockData = {
          variant: {
            id: VARIANT_ID,
            template_id: TEMPLATE_ID,
            variant_name: 'Friendly Tone',
          },
        };

        mockSingle.mockResolvedValue({ data: mockData, error: null });

        const result = await getAccountAssignedVariant(TEMPLATE_ID, ACCOUNT_ID);

        expect(result).toEqual(mockData.variant);
        expect(mockEq).toHaveBeenCalledWith('account_id', ACCOUNT_ID);
      });

      it('should return null when no assignment exists', async () => {
        mockSingle.mockResolvedValue({
          data: null,
          error: { code: 'PGRST116' },
        });

        const result = await getAccountAssignedVariant(TEMPLATE_ID, ACCOUNT_ID);

        expect(result).toBeNull();
      });
    });

    describe('resolveVariantForAccount', () => {
      it('should resolve variant using database function', async () => {
        const mockVariant = {
          id: VARIANT_ID,
          template_id: TEMPLATE_ID,
          variant_name: 'Friendly Tone',
        };

        mockRpc.mockResolvedValue({ data: VARIANT_ID, error: null });
        mockSingle.mockResolvedValue({ data: mockVariant, error: null });

        const result = await resolveVariantForAccount(TEMPLATE_ID, ACCOUNT_ID);

        expect(result).toEqual(mockVariant);
        expect(mockRpc).toHaveBeenCalledWith('resolve_variant_for_account', {
          p_template_id: TEMPLATE_ID,
          p_account_id: ACCOUNT_ID,
        });
      });

      it('should return null when no variant resolved', async () => {
        mockRpc.mockResolvedValue({ data: null, error: null });

        const result = await resolveVariantForAccount(TEMPLATE_ID, ACCOUNT_ID);

        expect(result).toBeNull();
      });
    });

    describe('getAccountVariantAssignments', () => {
      it('should fetch all variant assignments for account', async () => {
        const mockAssignments = [
          {
            id: '550e8400-e29b-41d4-a716-446655440050',
            variant: {
              id: VARIANT_ID,
              template: {
                id: TEMPLATE_ID,
                slug: 'customer-support',
                name: 'Customer Support',
              },
            },
          },
        ];

        mockOrder.mockResolvedValue({ data: mockAssignments, error: null });

        const result = await getAccountVariantAssignments(ACCOUNT_ID);

        expect(result).toEqual(mockAssignments);
        expect(mockEq).toHaveBeenCalledWith('account_id', ACCOUNT_ID);
      });
    });
  });

  describe('Experiment Queries', () => {
    describe('getActiveExperiments', () => {
      it('should fetch running experiments for account', async () => {
        const mockExperiments = [
          {
            id: EXPERIMENT_ID,
            name: 'Tone Comparison',
            template_id: TEMPLATE_ID,
            status: 'running',
            account_id: ACCOUNT_ID,
          },
        ];

        mockOrder.mockResolvedValue({ data: mockExperiments, error: null });

        const result = await getActiveExperiments(ACCOUNT_ID);

        expect(result).toEqual(mockExperiments);
        expect(mockEq).toHaveBeenCalledWith('account_id', ACCOUNT_ID);
        expect(mockEq).toHaveBeenCalledWith('status', 'running');
      });
    });

    describe('getExperimentResults', () => {
      it('should fetch experiment with results', async () => {
        const mockExperiment = {
          id: EXPERIMENT_ID,
          name: 'Tone Comparison',
          status: 'completed',
          winner_variant_id: VARIANT_ID,
          results_summary: { improvement: '15%' },
          system_prompt_combinations: [],
        };

        mockSingle.mockResolvedValue({ data: mockExperiment, error: null });

        const result = await getExperimentResults(EXPERIMENT_ID);

        expect(result).toEqual(mockExperiment);
        expect(mockEq).toHaveBeenCalledWith('id', EXPERIMENT_ID);
      });
    });
  });

  describe('Performance Queries', () => {
    describe('getCompositionPerformance', () => {
      it('should fetch performance metrics for template', async () => {
        const mockPerformance = [
          {
            composition_hash: 'hash-123',
            template_id: TEMPLATE_ID,
            execution_count: 100,
            success_count: 95,
            avg_latency_ms: 250,
          },
        ];

        mockLimit.mockResolvedValue({ data: mockPerformance, error: null });

        const result = await getCompositionPerformance(TEMPLATE_ID);

        expect(result).toEqual(mockPerformance);
        expect(mockEq).toHaveBeenCalledWith('template_id', TEMPLATE_ID);
        expect(mockLimit).toHaveBeenCalledWith(10);
      });
    });

    describe('getBestComposition', () => {
      it('should fetch best performing composition', async () => {
        const mockComposition = {
          composition_hash: 'hash-best',
          template_id: TEMPLATE_ID,
          execution_count: 50,
          success_count: 48,
          avg_latency_ms: 200,
        };

        mockSingle.mockResolvedValue({ data: mockComposition, error: null });

        const result = await getBestComposition(TEMPLATE_ID);

        expect(result).toEqual(mockComposition);
        expect(mockGte).toHaveBeenCalledWith('execution_count', 10);
      });

      it('should return null when no compositions meet threshold', async () => {
        mockSingle.mockResolvedValue({
          data: null,
          error: { code: 'PGRST116' },
        });

        const result = await getBestComposition(TEMPLATE_ID);

        expect(result).toBeNull();
      });
    });

    describe('getExecutionLogs', () => {
      it('should fetch execution logs with default limit', async () => {
        const mockLogs = [
          {
            id: '550e8400-e29b-41d4-a716-446655440060',
            template_id: TEMPLATE_ID,
            success: true,
            latency_ms: 250,
          },
        ];

        mockLimit.mockResolvedValue({ data: mockLogs, error: null });

        const result = await getExecutionLogs(TEMPLATE_ID);

        expect(result).toEqual(mockLogs);
        expect(mockLimit).toHaveBeenCalledWith(50);
      });

      it('should fetch execution logs with custom limit', async () => {
        const mockLogs = [];

        mockLimit.mockResolvedValue({ data: mockLogs, error: null });

        await getExecutionLogs(TEMPLATE_ID, 100);

        expect(mockLimit).toHaveBeenCalledWith(100);
      });
    });

    describe('calculateAttributionScores', () => {
      it('should calculate attribution scores via RPC', async () => {
        const mockScores = [
          {
            system_prompt_id: SYSTEM_PROMPT_ID,
            attribution_score: 0.85,
            impact_on_success: 0.12,
          },
        ];

        mockRpc.mockResolvedValue({ data: mockScores, error: null });

        const result = await calculateAttributionScores(TEMPLATE_ID);

        expect(result).toEqual(mockScores);
        expect(mockRpc).toHaveBeenCalledWith('calculate_attribution_scores', {
          p_template_id: TEMPLATE_ID,
        });
      });
    });
  });
});
