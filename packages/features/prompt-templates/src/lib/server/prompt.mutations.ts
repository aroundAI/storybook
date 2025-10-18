/**
 * Prompt Management Server Mutations
 *
 * Server actions for:
 * - Creating/updating/deleting templates
 * - Creating/updating/deleting system prompts
 * - Managing variants and experiments
 * - Logging executions
 */

import 'server-only';
import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { getLogger } from '@kit/shared/logger';
import {
  CreatePromptTemplateSchema,
  UpdatePromptTemplateSchema,
  DeletePromptTemplateSchema,
  CreateSystemPromptSchema,
  UpdateSystemPromptSchema,
  DeleteSystemPromptSchema,
  LinkSystemPromptSchema,
  UnlinkSystemPromptSchema,
  CreateVariantSchema,
  UpdateVariantSchema,
  DeleteVariantSchema,
  AssignVariantToAccountSchema,
  UnassignVariantFromAccountSchema,
  CreateExperimentSchema,
  UpdateExperimentSchema,
  LogExecutionSchema,
} from '../schemas/prompt.schema';
import type {
  CreatePromptTemplateInput,
  UpdatePromptTemplateInput,
  CreateSystemPromptInput,
  UpdateSystemPromptInput,
  CreateVariantInput,
  UpdateVariantInput,
  AssignVariantToAccountInput,
  UnassignVariantFromAccountInput,
  CreateExperimentInput,
  LogExecutionInput,
} from '../schemas/prompt.schema';

const logger = await getLogger();

// =====================================================
// TEMPLATE MUTATIONS
// =====================================================

export const createPromptTemplateAction = enhanceAction(
  async (data: CreatePromptTemplateInput) => {
    const client = getSupabaseServerClient();

    const { data: template, error } = await client
      .from('prompt_templates')
      .insert({
        ...data,
        variables: data.variables as never,
        output_schema: data.output_schema,
        tags: data.tags,
        metadata: data.metadata as never,
      })
      .select()
      .single();

    if (error) {
      logger.error({ error }, 'Failed to create prompt template');
      throw error;
    }

    logger.info({ templateId: template.id }, 'Created prompt template');

    return template;
  },
  {
    schema: CreatePromptTemplateSchema,
  },
);

export const updatePromptTemplateAction = enhanceAction(
  async (data: UpdatePromptTemplateInput) => {
    const client = getSupabaseServerClient();

    const { data: template, error } = await client
      .from('prompt_templates')
      .update({
        ...data,
        variables: data.variables as never,
        output_schema: data.output_schema,
        tags: data.tags,
        metadata: data.metadata as never,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.id)
      .select()
      .single();

    if (error) {
      logger.error({ error, templateId: data.id }, 'Failed to update template');
      throw error;
    }

    logger.info({ templateId: template.id }, 'Updated prompt template');

    return template;
  },
  {
    schema: UpdatePromptTemplateSchema,
  },
);

export const deletePromptTemplateAction = enhanceAction(
  async (data: { id: string }) => {
    const client = getSupabaseServerClient();

    const { error } = await client
      .from('prompt_templates')
      .delete()
      .eq('id', data.id);

    if (error) {
      logger.error({ error, templateId: data.id }, 'Failed to delete template');
      throw error;
    }

    logger.info({ templateId: data.id }, 'Deleted prompt template');

    return { success: true };
  },
  {
    schema: DeletePromptTemplateSchema,
  },
);

// =====================================================
// SYSTEM PROMPT MUTATIONS
// =====================================================

export const createSystemPromptAction = enhanceAction(
  async (data: CreateSystemPromptInput) => {
    const client = getSupabaseServerClient();

    const { data: systemPrompt, error } = await client
      .from('prompt_system_prompts')
      .insert({
        ...data,
        condition_rules: data.condition_rules as never,
        tags: data.tags,
        metadata: data.metadata as never,
      })
      .select()
      .single();

    if (error) {
      logger.error({ error }, 'Failed to create system prompt');
      throw error;
    }

    logger.info({ systemPromptId: systemPrompt.id }, 'Created system prompt');

    return systemPrompt;
  },
  {
    schema: CreateSystemPromptSchema,
  },
);

export const updateSystemPromptAction = enhanceAction(
  async (data: UpdateSystemPromptInput) => {
    const client = getSupabaseServerClient();

    const { data: systemPrompt, error } = await client
      .from('prompt_system_prompts')
      .update({
        ...data,
        condition_rules: data.condition_rules as never,
        tags: data.tags,
        metadata: data.metadata as never,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.id)
      .select()
      .single();

    if (error) {
      logger.error(
        { error, systemPromptId: data.id },
        'Failed to update system prompt',
      );
      throw error;
    }

    logger.info({ systemPromptId: systemPrompt.id }, 'Updated system prompt');

    return systemPrompt;
  },
  {
    schema: UpdateSystemPromptSchema,
  },
);

export const deleteSystemPromptAction = enhanceAction(
  async (data: { id: string }) => {
    const client = getSupabaseServerClient();

    const { error } = await client
      .from('prompt_system_prompts')
      .delete()
      .eq('id', data.id);

    if (error) {
      logger.error(
        { error, systemPromptId: data.id },
        'Failed to delete system prompt',
      );
      throw error;
    }

    logger.info({ systemPromptId: data.id }, 'Deleted system prompt');

    return { success: true };
  },
  {
    schema: DeleteSystemPromptSchema,
  },
);

// =====================================================
// LINK MUTATIONS
// =====================================================

export const linkSystemPromptAction = enhanceAction(
  async (data: {
    template_id: string;
    system_prompt_id: string;
    order_index: number;
    condition_rules?: Record<string, unknown>;
  }) => {
    const client = getSupabaseServerClient();

    const { data: link, error } = await client
      .from('template_system_prompt_links')
      .insert({
        template_id: data.template_id,
        system_prompt_id: data.system_prompt_id,
        order_index: data.order_index,
        condition_rules: data.condition_rules as never,
      })
      .select()
      .single();

    if (error) {
      logger.error({ error }, 'Failed to link system prompt');
      throw error;
    }

    logger.info(
      {
        templateId: data.template_id,
        systemPromptId: data.system_prompt_id,
      },
      'Linked system prompt to template',
    );

    return link;
  },
  {
    schema: LinkSystemPromptSchema,
  },
);

export const unlinkSystemPromptAction = enhanceAction(
  async (data: { template_id: string; system_prompt_id: string }) => {
    const client = getSupabaseServerClient();

    const { error } = await client
      .from('template_system_prompt_links')
      .delete()
      .eq('template_id', data.template_id)
      .eq('system_prompt_id', data.system_prompt_id);

    if (error) {
      logger.error({ error }, 'Failed to unlink system prompt');
      throw error;
    }

    logger.info(
      {
        templateId: data.template_id,
        systemPromptId: data.system_prompt_id,
      },
      'Unlinked system prompt from template',
    );

    return { success: true };
  },
  {
    schema: UnlinkSystemPromptSchema,
  },
);

// =====================================================
// VARIANT MUTATIONS
// =====================================================

export const createVariantAction = enhanceAction(
  async (data: CreateVariantInput) => {
    const client = getSupabaseServerClient();

    const { data: variant, error } = await client
      .from('template_variants')
      .insert({
        ...data,
        system_prompt_overrides: data.system_prompt_overrides as never,
      })
      .select()
      .single();

    if (error) {
      logger.error({ error }, 'Failed to create variant');
      throw error;
    }

    logger.info({ variantId: variant.id }, 'Created template variant');

    return variant;
  },
  {
    schema: CreateVariantSchema,
  },
);

export const updateVariantAction = enhanceAction(
  async (data: UpdateVariantInput) => {
    const client = getSupabaseServerClient();

    const { data: variant, error } = await client
      .from('template_variants')
      .update({
        ...data,
        system_prompt_overrides: data.system_prompt_overrides as never,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.id)
      .select()
      .single();

    if (error) {
      logger.error({ error, variantId: data.id }, 'Failed to update variant');
      throw error;
    }

    logger.info({ variantId: variant.id }, 'Updated template variant');

    return variant;
  },
  {
    schema: UpdateVariantSchema,
  },
);

export const deleteVariantAction = enhanceAction(
  async (data: { id: string }) => {
    const client = getSupabaseServerClient();

    const { error } = await client
      .from('template_variants')
      .delete()
      .eq('id', data.id);

    if (error) {
      logger.error({ error, variantId: data.id }, 'Failed to delete variant');
      throw error;
    }

    logger.info({ variantId: data.id }, 'Deleted template variant');

    return { success: true };
  },
  {
    schema: DeleteVariantSchema,
  },
);

// =====================================================
// VARIANT ASSIGNMENT MUTATIONS
// =====================================================

export const assignVariantToAccountAction = enhanceAction(
  async (data: AssignVariantToAccountInput) => {
    const client = getSupabaseServerClient();

    const { data: assignment, error } = await client
      .from('variant_account_assignments')
      .insert({
        variant_id: data.variant_id,
        account_id: data.account_id,
      })
      .select()
      .single();

    if (error) {
      logger.error({ error }, 'Failed to assign variant to account');
      throw error;
    }

    logger.info(
      {
        variantId: data.variant_id,
        accountId: data.account_id,
      },
      'Assigned variant to account',
    );

    return assignment;
  },
  {
    schema: AssignVariantToAccountSchema,
  },
);

export const unassignVariantFromAccountAction = enhanceAction(
  async (data: UnassignVariantFromAccountInput) => {
    const client = getSupabaseServerClient();

    const { error } = await client
      .from('variant_account_assignments')
      .delete()
      .eq('variant_id', data.variant_id)
      .eq('account_id', data.account_id);

    if (error) {
      logger.error({ error }, 'Failed to unassign variant from account');
      throw error;
    }

    logger.info(
      {
        variantId: data.variant_id,
        accountId: data.account_id,
      },
      'Unassigned variant from account',
    );

    return { success: true };
  },
  {
    schema: UnassignVariantFromAccountSchema,
  },
);

// =====================================================
// EXPERIMENT MUTATIONS
// =====================================================

export const createExperimentAction = enhanceAction(
  async (data: CreateExperimentInput) => {
    const client = getSupabaseServerClient();

    const { data: experiment, error } = await client
      .from('optimization_experiments')
      .insert({
        ...data,
        variant_ids: data.variant_ids as never,
      })
      .select()
      .single();

    if (error) {
      logger.error({ error }, 'Failed to create experiment');
      throw error;
    }

    logger.info({ experimentId: experiment.id }, 'Created optimization experiment');

    return experiment;
  },
  {
    schema: CreateExperimentSchema,
  },
);

export const updateExperimentAction = enhanceAction(
  async (data: {
    id: string;
    status: string;
    winner_variant_id?: string;
    results_summary?: Record<string, unknown>;
  }) => {
    const client = getSupabaseServerClient();

    const { data: experiment, error } = await client
      .from('optimization_experiments')
      .update({
        status: data.status as never,
        winner_variant_id: data.winner_variant_id ?? null,
        results_summary: data.results_summary as never,
        updated_at: new Date().toISOString(),
        ...(data.status === 'running'
          ? { started_at: new Date().toISOString() }
          : {}),
        ...(data.status === 'completed'
          ? { completed_at: new Date().toISOString() }
          : {}),
      })
      .eq('id', data.id)
      .select()
      .single();

    if (error) {
      logger.error(
        { error, experimentId: data.id },
        'Failed to update experiment',
      );
      throw error;
    }

    logger.info({ experimentId: experiment.id }, 'Updated optimization experiment');

    return experiment;
  },
  {
    schema: UpdateExperimentSchema,
  },
);

// =====================================================
// EXECUTION LOGGING
// =====================================================

export const logExecutionAction = enhanceAction(
  async (data: LogExecutionInput) => {
    const client = getSupabaseServerClient();

    const { data: logId, error } = await client.rpc('log_prompt_execution', {
      p_user_id: (data.user_id ?? null) as never,
      p_template_id: data.template_id as never,
      p_variant_id: (data.variant_id ?? null) as never,
      p_composition_hash: data.composition_hash as never,
      p_variables: data.variables as never,
      p_context: (data.context ?? {}) as never,
      p_rendered_system_prompt: data.rendered_system_prompt as never,
      p_rendered_user_prompt: data.rendered_user_prompt as never,
      p_system_prompt_ids: data.system_prompt_ids as never,
      p_response_text: (data.response_text ?? null) as never,
      p_response_metadata: (data.response_metadata ?? {}) as never,
      p_success: data.success as never,
      p_error_message: (data.error_message ?? null) as never,
      p_rating: (data.rating ?? null) as never,
      p_cost: (data.cost ?? null) as never,
      p_latency_ms: (data.latency_ms ?? null) as never,
      p_tokens_used: (data.tokens_used ?? null) as never,
    });

    if (error) {
      logger.error({ error }, 'Failed to log prompt execution');
      throw error;
    }

    logger.info(
      { logId, templateId: data.template_id },
      'Logged prompt execution',
    );

    return { logId };
  },
  {
    schema: LogExecutionSchema,
  },
);
