/**
 * Prompt Template Mutations Tests
 *
 * Tests for all server actions that mutate prompt data:
 * - Template CRUD operations
 * - System prompt CRUD operations
 * - Template-system prompt linking
 * - Variant management
 * - Variant assignments
 * - Experiment management
 * - Execution logging
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Mock dependencies - define outside to avoid initialization issues
vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(async () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockGetClaims = vi.fn();
const mockGetAuthenticatorAssuranceLevel = vi.fn();

const mockSupabaseClient = {
  from: mockFrom,
  rpc: mockRpc,
  auth: {
    getClaims: mockGetClaims,
    mfa: {
      getAuthenticatorAssuranceLevel: mockGetAuthenticatorAssuranceLevel,
    },
    suppressGetSessionWarning: false,
  },
} as unknown as SupabaseClient;

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => mockSupabaseClient),
}));

// Import mutations after mocks are set up
import { getLogger } from '@kit/shared/logger';
import {
  assignVariantToAccountAction,
  createExperimentAction,
  createPromptTemplateAction,
  createSystemPromptAction,
  createVariantAction,
  deletePromptTemplateAction,
  deleteSystemPromptAction,
  deleteVariantAction,
  linkSystemPromptAction,
  logExecutionAction,
  unassignVariantFromAccountAction,
  unlinkSystemPromptAction,
  updateExperimentAction,
  updatePromptTemplateAction,
  updateSystemPromptAction,
  updateVariantAction,
} from '../src/lib/server/prompt.mutations';

// Valid UUIDs for testing
const TEMPLATE_ID = '550e8400-e29b-41d4-a716-446655440000';
const SYSTEM_PROMPT_ID = '550e8400-e29b-41d4-a716-446655440001';
const VARIANT_ID = '550e8400-e29b-41d4-a716-446655440002';
const ACCOUNT_ID = '550e8400-e29b-41d4-a716-446655440003';
const EXPERIMENT_ID = '550e8400-e29b-41d4-a716-446655440004';
const USER_ID = '550e8400-e29b-41d4-a716-446655440005';

describe('Prompt Template Mutations', () => {
  let mockLogger: Awaited<ReturnType<typeof getLogger>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockLogger = await getLogger();

    // Mock authenticated user
    mockGetClaims.mockResolvedValue({
      data: {
        claims: {
          sub: USER_ID,
          email: 'test@example.com',
        },
      },
      error: null,
    });

    // Mock MFA check
    mockGetAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal1' },
      error: null,
    });

    // Setup default chain behavior
    mockFrom.mockReturnValue({
      insert: mockInsert,
      update: mockUpdate,
      delete: mockDelete,
      select: mockSelect,
    });

    mockInsert.mockReturnValue({ select: mockSelect });
    mockUpdate.mockReturnValue({ select: mockSelect, eq: mockEq });
    mockDelete.mockReturnValue({ eq: mockEq });
    mockSelect.mockReturnValue({ single: mockSingle, eq: mockEq });

    // mockEq needs to return both {select, eq} and support chained .eq().eq()
    const mockEqResult = {
      select: mockSelect,
      eq: mockEq,
      // For Promise resolution (delete operations)
      then: (resolve: (value: { error: null }) => void) => {
        resolve({ error: null });
        return Promise.resolve({ error: null });
      },
    };
    mockEq.mockReturnValue(mockEqResult);
  });

  describe('Template CRUD Operations', () => {
    describe('createPromptTemplateAction', () => {
      it('should create a template successfully', async () => {
        const mockTemplate = {
          id: TEMPLATE_ID,
          name: 'Test Template',
          template_content: 'Hello {{name}}',
          slug: 'test-template',
          category: 'conversation',
          created_at: new Date().toISOString(),
        };

        mockSingle.mockResolvedValue({ data: mockTemplate, error: null });

        const result = await createPromptTemplateAction({
          name: 'Test Template',
          template_content: 'Hello {{name}}',
          slug: 'test-template',
          category: 'conversation',
          variables: {},
        });

        expect(result).toEqual(mockTemplate);
        expect(mockFrom).toHaveBeenCalledWith('prompt_templates');
        expect(mockInsert).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Test Template',
            template_content: 'Hello {{name}}',
            slug: 'test-template',
            category: 'conversation',
          }),
        );
      });

      it('should throw error when creation fails', async () => {
        const mockError = new Error('Database error');
        mockSingle.mockResolvedValue({ data: null, error: mockError });

        await expect(
          createPromptTemplateAction({
            name: 'Test Template',
            template_content: 'Hello {{name}}',
            slug: 'test-template',
            category: 'conversation',
            variables: {},
          }),
        ).rejects.toThrow('Database error');

      });
    });

    describe('updatePromptTemplateAction', () => {
      it('should update a template successfully', async () => {
        const mockTemplate = {
          id: TEMPLATE_ID,
          name: 'Updated Template',
          template_content: 'Hello {{name}}!',
          updated_at: new Date().toISOString(),
        };

        mockEq.mockReturnValue({ select: mockSelect });
        mockSingle.mockResolvedValue({ data: mockTemplate, error: null });

        const result = await updatePromptTemplateAction({
          id: TEMPLATE_ID,
          name: 'Updated Template',
          template_content: 'Hello {{name}}!',
        });

        expect(result).toEqual(mockTemplate);
        expect(mockFrom).toHaveBeenCalledWith('prompt_templates');
        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Updated Template',
            template_content: 'Hello {{name}}!',
            updated_at: expect.any(String),
          }),
        );
        expect(mockEq).toHaveBeenCalledWith('id', TEMPLATE_ID);
      });

      it('should throw error when update fails', async () => {
        const mockError = new Error('Not found');
        mockEq.mockReturnValue({ select: mockSelect });
        mockSingle.mockResolvedValue({ data: null, error: mockError });

        await expect(
          updatePromptTemplateAction({
            id: TEMPLATE_ID,
            name: 'Updated Template',
          }),
        ).rejects.toThrow('Not found');
      });
    });

    describe('deletePromptTemplateAction', () => {
      it('should delete a template successfully', async () => {
        mockEq.mockResolvedValue({ error: null });

        const result = await deletePromptTemplateAction({ id: TEMPLATE_ID });

        expect(result).toEqual({ success: true });
        expect(mockFrom).toHaveBeenCalledWith('prompt_templates');
        expect(mockDelete).toHaveBeenCalled();
        expect(mockEq).toHaveBeenCalledWith('id', TEMPLATE_ID);
      });

      it('should throw error when deletion fails', async () => {
        const mockError = new Error('Cannot delete');
        mockEq.mockResolvedValue({ error: mockError });

        await expect(
          deletePromptTemplateAction({ id: TEMPLATE_ID }),
        ).rejects.toThrow('Cannot delete');
      });
    });
  });

  describe('System Prompt CRUD Operations', () => {
    describe('createSystemPromptAction', () => {
      it('should create a system prompt successfully', async () => {
        const mockSystemPrompt = {
          id: SYSTEM_PROMPT_ID,
          name: 'GDPR Compliance',
          slug: 'compliance-gdpr',
          layer_type: 'compliance',
          scope: 'global',
          content: 'Follow GDPR guidelines',
          created_at: new Date().toISOString(),
        };

        mockSingle.mockResolvedValue({ data: mockSystemPrompt, error: null });

        const result = await createSystemPromptAction({
          name: 'GDPR Compliance',
          slug: 'compliance-gdpr',
          layer_type: 'compliance',
          scope: 'global',
          content: 'Follow GDPR guidelines',
        });

        expect(result).toEqual(mockSystemPrompt);
        expect(mockFrom).toHaveBeenCalledWith('prompt_system_prompts');
      });

      it('should handle system prompt with condition rules', async () => {
        const mockSystemPrompt = {
          id: SYSTEM_PROMPT_ID,
          name: 'EU Compliance',
          slug: 'compliance-eu',
          layer_type: 'compliance',
          scope: 'global',
          content: 'EU-specific rules',
          condition_rules: { region: 'eu' },
          created_at: new Date().toISOString(),
        };

        mockSingle.mockResolvedValue({ data: mockSystemPrompt, error: null });

        const result = await createSystemPromptAction({
          name: 'EU Compliance',
          slug: 'compliance-eu',
          layer_type: 'compliance',
          scope: 'global',
          content: 'EU-specific rules',
          condition_rules: { region: 'eu' },
        });

        expect(result.condition_rules).toEqual({ region: 'eu' });
      });
    });

    describe('updateSystemPromptAction', () => {
      it('should update a system prompt successfully', async () => {
        const mockSystemPrompt = {
          id: SYSTEM_PROMPT_ID,
          content: 'Updated compliance text',
          updated_at: new Date().toISOString(),
        };

        mockEq.mockReturnValue({ select: mockSelect });
        mockSingle.mockResolvedValue({ data: mockSystemPrompt, error: null });

        const result = await updateSystemPromptAction({
          id: SYSTEM_PROMPT_ID,
          content: 'Updated compliance text',
        });

        expect(result).toEqual(mockSystemPrompt);
        expect(mockEq).toHaveBeenCalledWith('id', SYSTEM_PROMPT_ID);
      });
    });

    describe('deleteSystemPromptAction', () => {
      it('should delete a system prompt successfully', async () => {
        mockEq.mockResolvedValue({ error: null });

        const result = await deleteSystemPromptAction({
          id: SYSTEM_PROMPT_ID,
        });

        expect(result).toEqual({ success: true });
      });
    });
  });

  describe('Template-System Prompt Linking', () => {
    describe('linkSystemPromptAction', () => {
      it('should link system prompt to template', async () => {
        const mockLink = {
          id: '550e8400-e29b-41d4-a716-446655440010',
          template_id: TEMPLATE_ID,
          system_prompt_id: SYSTEM_PROMPT_ID,
          order_index: 0,
        };

        mockSingle.mockResolvedValue({ data: mockLink, error: null });

        const result = await linkSystemPromptAction({
          template_id: TEMPLATE_ID,
          system_prompt_id: SYSTEM_PROMPT_ID,
          order_index: 0,
        });

        expect(result).toEqual(mockLink);
        expect(mockFrom).toHaveBeenCalledWith('template_system_prompt_links');
      });

      it('should link with condition rules', async () => {
        const mockLink = {
          id: '550e8400-e29b-41d4-a716-446655440011',
          template_id: TEMPLATE_ID,
          system_prompt_id: SYSTEM_PROMPT_ID,
          order_index: 1,
          condition_rules: { environment: 'production' },
        };

        mockSingle.mockResolvedValue({ data: mockLink, error: null });

        const result = await linkSystemPromptAction({
          template_id: TEMPLATE_ID,
          system_prompt_id: SYSTEM_PROMPT_ID,
          order_index: 1,
          condition_rules: { environment: 'production' },
        });

        expect(result.condition_rules).toEqual({ environment: 'production' });
      });
    });

    describe('unlinkSystemPromptAction', () => {
      it('should unlink system prompt from template', async () => {
        // Chain for .delete().eq().eq()
        const chainableEq = {
          eq: vi.fn().mockResolvedValue({ error: null }),
        };
        mockEq.mockReturnValue(chainableEq);

        const result = await unlinkSystemPromptAction({
          template_id: TEMPLATE_ID,
          system_prompt_id: SYSTEM_PROMPT_ID,
        });

        expect(result).toEqual({ success: true });
        expect(mockDelete).toHaveBeenCalled();
      });
    });
  });

  describe('Variant Management', () => {
    describe('createVariantAction', () => {
      it('should create a variant successfully', async () => {
        const mockVariant = {
          id: VARIANT_ID,
          template_id: TEMPLATE_ID,
          variant_name: 'Friendly Tone',
          template_content: 'Hi {{name}}! How are you?',
          created_at: new Date().toISOString(),
        };

        mockSingle.mockResolvedValue({ data: mockVariant, error: null });

        const result = await createVariantAction({
          template_id: TEMPLATE_ID,
          variant_name: 'Friendly Tone',
          template_content: 'Hi {{name}}! How are you?',
        });

        expect(result).toEqual(mockVariant);
        expect(mockFrom).toHaveBeenCalledWith('template_variants');
      });

      it('should create variant with system prompt overrides', async () => {
        const mockVariant = {
          id: VARIANT_ID,
          template_id: TEMPLATE_ID,
          variant_name: 'Professional Tone',
          system_prompt_overrides: { role: 'professional-assistant' },
          created_at: new Date().toISOString(),
        };

        mockSingle.mockResolvedValue({ data: mockVariant, error: null });

        const result = await createVariantAction({
          template_id: TEMPLATE_ID,
          variant_name: 'Professional Tone',
          system_prompt_overrides: { role: 'professional-assistant' },
        });

        expect(result.system_prompt_overrides).toEqual({
          role: 'professional-assistant',
        });
      });
    });

    describe('updateVariantAction', () => {
      it('should update a variant successfully', async () => {
        const mockVariant = {
          id: VARIANT_ID,
          variant_name: 'Updated Friendly Tone',
          updated_at: new Date().toISOString(),
        };

        mockEq.mockReturnValue({ select: mockSelect });
        mockSingle.mockResolvedValue({ data: mockVariant, error: null });

        const result = await updateVariantAction({
          id: VARIANT_ID,
          variant_name: 'Updated Friendly Tone',
        });

        expect(result).toEqual(mockVariant);
        expect(mockEq).toHaveBeenCalledWith('id', VARIANT_ID);
      });
    });

    describe('deleteVariantAction', () => {
      it('should delete a variant successfully', async () => {
        mockEq.mockResolvedValue({ error: null });

        const result = await deleteVariantAction({ id: VARIANT_ID });

        expect(result).toEqual({ success: true });
      });
    });
  });

  describe('Variant Assignment', () => {
    describe('assignVariantToAccountAction', () => {
      it('should assign variant to account', async () => {
        const mockAssignment = {
          id: '550e8400-e29b-41d4-a716-446655440020',
          variant_id: VARIANT_ID,
          account_id: ACCOUNT_ID,
          created_at: new Date().toISOString(),
        };

        mockSingle.mockResolvedValue({ data: mockAssignment, error: null });

        const result = await assignVariantToAccountAction({
          variant_id: VARIANT_ID,
          account_id: ACCOUNT_ID,
        });

        expect(result).toEqual(mockAssignment);
        expect(mockFrom).toHaveBeenCalledWith('variant_account_assignments');
      });
    });

    describe('unassignVariantFromAccountAction', () => {
      it('should unassign variant from account', async () => {
        // Chain for .delete().eq().eq()
        const chainableEq = {
          eq: vi.fn().mockResolvedValue({ error: null }),
        };
        mockEq.mockReturnValue(chainableEq);

        const result = await unassignVariantFromAccountAction({
          variant_id: VARIANT_ID,
          account_id: ACCOUNT_ID,
        });

        expect(result).toEqual({ success: true });
      });
    });
  });

  describe('Experiment Management', () => {
    describe('createExperimentAction', () => {
      it('should create an experiment successfully', async () => {
        const variant2Id = '550e8400-e29b-41d4-a716-446655440030';

        const mockExperiment = {
          id: EXPERIMENT_ID,
          name: 'Tone Comparison',
          template_id: TEMPLATE_ID,
          variant_ids: [VARIANT_ID, variant2Id],
          optimization_target: 'success_rate',
          status: 'draft',
          created_at: new Date().toISOString(),
        };

        mockSingle.mockResolvedValue({ data: mockExperiment, error: null });

        const result = await createExperimentAction({
          name: 'Tone Comparison',
          template_id: TEMPLATE_ID,
          variant_ids: [VARIANT_ID, variant2Id],
          optimization_target: 'success_rate',
        });

        expect(result).toEqual(mockExperiment);
        expect(mockFrom).toHaveBeenCalledWith('optimization_experiments');
      });
    });

    describe('updateExperimentAction', () => {
      it('should update experiment to running status', async () => {
        const mockExperiment = {
          id: EXPERIMENT_ID,
          status: 'running',
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        mockEq.mockReturnValue({ select: mockSelect });
        mockSingle.mockResolvedValue({ data: mockExperiment, error: null });

        const result = await updateExperimentAction({
          id: EXPERIMENT_ID,
          status: 'running',
        });

        expect(result).toEqual(mockExperiment);
        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'running',
            started_at: expect.any(String),
          }),
        );
      });

      it('should update experiment to completed with winner', async () => {
        const mockExperiment = {
          id: EXPERIMENT_ID,
          status: 'completed',
          winner_variant_id: VARIANT_ID,
          results_summary: { improvement: '15%' },
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        mockEq.mockReturnValue({ select: mockSelect });
        mockSingle.mockResolvedValue({ data: mockExperiment, error: null });

        const result = await updateExperimentAction({
          id: EXPERIMENT_ID,
          status: 'completed',
          winner_variant_id: VARIANT_ID,
          results_summary: { improvement: '15%' },
        });

        expect(result).toEqual(mockExperiment);
        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'completed',
            winner_variant_id: VARIANT_ID,
            completed_at: expect.any(String),
          }),
        );
      });
    });
  });

  describe('Execution Logging', () => {
    describe('logExecutionAction', () => {
      it('should log successful execution', async () => {
        mockRpc.mockResolvedValue({ data: 'log-id-123', error: null });

        const result = await logExecutionAction({
          template_id: TEMPLATE_ID,
          composition_hash: 'hash-123',
          variables: { name: 'John' },
          rendered_system_prompt: 'You are a helpful assistant',
          rendered_user_prompt: 'Hello John',
          system_prompt_ids: [
            { id: SYSTEM_PROMPT_ID, slug: 'compliance', layer: 'compliance' },
          ],
          response_text: 'Hi John! How can I help?',
          success: true,
          tokens_used: 50,
          cost: 0.001,
          latency_ms: 250,
        });

        expect(result).toEqual({ logId: 'log-id-123' });
        expect(mockRpc).toHaveBeenCalledWith(
          'log_prompt_execution',
          expect.objectContaining({
            p_template_id: TEMPLATE_ID,
            p_composition_hash: 'hash-123',
            p_success: true,
            p_tokens_used: 50,
            p_cost: 0.001,
            p_latency_ms: 250,
          }),
        );
      });

      it('should log failed execution with error', async () => {
        mockRpc.mockResolvedValue({ data: 'log-id-456', error: null });

        const result = await logExecutionAction({
          template_id: TEMPLATE_ID,
          composition_hash: 'hash-456',
          variables: { name: 'Jane' },
          rendered_system_prompt: 'You are a helpful assistant',
          rendered_user_prompt: 'Hello Jane',
          system_prompt_ids: [
            { id: SYSTEM_PROMPT_ID, slug: 'role', layer: 'role' },
          ],
          success: false,
          error_message: 'API timeout',
          latency_ms: 30000,
        });

        expect(result).toEqual({ logId: 'log-id-456' });
        expect(mockRpc).toHaveBeenCalledWith(
          'log_prompt_execution',
          expect.objectContaining({
            p_success: false,
            p_error_message: 'API timeout',
          }),
        );
      });

      it('should log execution with variant', async () => {
        mockRpc.mockResolvedValue({ data: 'log-id-789', error: null });

        const result = await logExecutionAction({
          template_id: TEMPLATE_ID,
          variant_id: VARIANT_ID,
          composition_hash: 'hash-789',
          variables: { name: 'Alice' },
          rendered_system_prompt: 'You are a helpful assistant',
          rendered_user_prompt: 'Hi Alice! How are you?',
          system_prompt_ids: [
            { id: SYSTEM_PROMPT_ID, slug: 'friendly', layer: 'role' },
          ],
          response_text: 'Hello! I am doing well.',
          success: true,
        });

        expect(result).toEqual({ logId: 'log-id-789' });
        expect(mockRpc).toHaveBeenCalledWith(
          'log_prompt_execution',
          expect.objectContaining({
            p_variant_id: VARIANT_ID,
          }),
        );
      });

      it('should throw error when logging fails', async () => {
        const mockError = new Error('Database error');
        mockRpc.mockResolvedValue({ data: null, error: mockError });

        await expect(
          logExecutionAction({
            template_id: TEMPLATE_ID,
            composition_hash: 'hash-999',
            variables: {},
            rendered_system_prompt: 'System',
            rendered_user_prompt: 'User',
            system_prompt_ids: [],
            success: true,
          }),
        ).rejects.toThrow('Database error');

      });
    });
  });
});
