/**
 * Prompt Management Server Queries
 *
 * Server-side database queries for:
 * - Templates
 * - System prompts
 * - Variants
 * - Experiments
 * - Performance tracking
 */
import 'server-only';

import { cache } from 'react';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { composeSystemPrompts } from '../engine/composer';
import type {
  CompositionPerformance,
  EnvironmentLabel,
  OptimizationExperiment,
  PromptSystemPrompt,
  PromptTemplate,
  SystemPromptComposition,
  TemplateVariant,
} from '../types';

// =====================================================
// TEMPLATE QUERIES
// =====================================================

/**
 * Get all templates (global - no account filtering)
 */
export const getAllTemplates = cache(async () => {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('prompt_templates')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data as PromptTemplate[];
});

/**
 * Get template by ID
 */
export const getTemplate = cache(async (templateId: string) => {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('prompt_templates')
    .select('*')
    .eq('id', templateId)
    .single();

  if (error) {
    throw error;
  }

  return data as PromptTemplate | null;
});

/**
 * Resolve template by slug and environment
 */
export const resolveTemplate = cache(
  async (slug: string, environment: EnvironmentLabel = 'production') => {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('resolve_template', {
      p_slug: slug,
      p_environment: environment,
    });

    if (error) {
      throw error;
    }

    return data as string | null;
  },
);

/**
 * Get template with linked system prompts
 */
export const getTemplateWithSystemPrompts = cache(
  async (templateId: string) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('prompt_templates')
      .select(
        `
      *,
      template_system_prompt_links (
        order_index,
        condition_rules,
        system_prompt:prompt_system_prompts (*)
      )
    `,
      )
      .eq('id', templateId)
      .single();

    if (error) {
      throw error;
    }

    return data;
  },
);

// =====================================================
// SYSTEM PROMPT QUERIES
// =====================================================

/**
 * Get all system prompts for a template (including global, category, and template-specific)
 */
export const getSystemPromptsForTemplate = cache(async (templateId: string) => {
  const client = getSupabaseServerClient();

  // Get template details first
  const template = await getTemplate(templateId);

  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  // Get all applicable system prompts
  const { data, error } = await client
    .from('prompt_system_prompts')
    .select(
      `
      *,
      template_system_prompt_links!left (
        template_id,
        order_index,
        condition_rules
      )
    `,
    )
    .eq('is_active', true)
    .or(
      `scope.eq.global,and(scope.eq.category,target_category.eq.${template.category}),and(scope.eq.template,template_system_prompt_links.template_id.eq.${templateId})`,
    )
    .order('priority', { ascending: false });

  if (error) {
    throw error;
  }

  return data as PromptSystemPrompt[];
});

/**
 * Get system prompts by scope
 */
export const getSystemPromptsByScope = cache(
  async (scope: 'global' | 'category' | 'template') => {
    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('prompt_system_prompts')
      .select('*')
      .eq('scope', scope)
      .eq('is_active', true)
      .order('layer_type')
      .order('priority', { ascending: false });

    if (error) {
      throw error;
    }

    return data as PromptSystemPrompt[];
  },
);

/**
 * Compose system prompts for a template using database function
 */
export const composeSystemPromptsForTemplate = cache(
  async (
    templateId: string,
    context: Record<string, unknown> = {},
  ): Promise<SystemPromptComposition> => {
    const client = getSupabaseServerClient();

    // Call database function to compose
    const { data: _data, error } = await client.rpc('compose_system_prompts', {
      p_template_id: templateId,
      p_context: context as never,
    });

    if (error) {
      throw error;
    }

    // Also get the system prompts for metadata
    const systemPrompts = await getSystemPromptsForTemplate(templateId);

    // Filter based on context
    const filtered = systemPrompts.filter((sp) => {
      if (!sp.condition_rules) return true;

      // Evaluate conditions
      for (const [key, value] of Object.entries(sp.condition_rules)) {
        if (context[key] !== value) {
          return false;
        }
      }

      return true;
    });

    // Use engine to create composition
    const composition = composeSystemPrompts(filtered, { context });

    return {
      ...composition,
      template_id: templateId,
    };
  },
);

// =====================================================
// VARIANT QUERIES
// =====================================================

/**
 * Get all variants for a template
 */
export const getTemplateVariants = cache(async (templateId: string) => {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('template_variants')
    .select('*')
    .eq('template_id', templateId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data as TemplateVariant[];
});

/**
 * Select variant for A/B testing based on traffic weights
 */
export const selectVariant = cache(
  async (templateId: string): Promise<TemplateVariant | null> => {
    const variants = await getTemplateVariants(templateId);

    if (variants.length === 0) {
      return null;
    }

    // Calculate total weight
    const totalWeight = variants.reduce(
      (sum, v) => sum + Number(v.traffic_weight),
      0,
    );

    // Random selection based on weights
    let random = Math.random() * totalWeight;

    for (const variant of variants) {
      random -= Number(variant.traffic_weight);
      if (random <= 0) {
        return variant;
      }
    }

    return variants[0] ?? null;
  },
);

// =====================================================
// VARIANT ASSIGNMENT QUERIES
// =====================================================

/**
 * Get all accounts assigned to a variant
 */
export const getVariantAssignments = cache(async (variantId: string) => {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('variant_account_assignments')
    .select(
      `
      *,
      account:accounts (
        id,
        name,
        slug,
        picture_url
      )
    `,
    )
    .eq('variant_id', variantId)
    .order('assigned_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data;
});

/**
 * Get assigned variant for an account and template
 */
export const getAccountAssignedVariant = cache(
  async (templateId: string, accountId: string) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('variant_account_assignments')
      .select(
        `
        *,
        variant:template_variants (*)
      `,
      )
      .eq('account_id', accountId)
      .eq('variant.template_id', templateId)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned
      throw error;
    }

    return data?.variant || null;
  },
);

/**
 * Resolve which variant to use for an account (assigned or traffic-weighted)
 */
export const resolveVariantForAccount = cache(
  async (templateId: string, accountId: string) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client.rpc('resolve_variant_for_account', {
      p_template_id: templateId as never,
      p_account_id: accountId as never,
    });

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    // Fetch the full variant details
    const { data: variant, error: variantError } = await client
      .from('template_variants')
      .select('*')
      .eq('id', data)
      .single();

    if (variantError) {
      throw variantError;
    }

    return variant;
  },
);

/**
 * Get all assignments for an account
 */
export const getAccountVariantAssignments = cache(async (accountId: string) => {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('variant_account_assignments')
    .select(
      `
      *,
      variant:template_variants (
        *,
        template:prompt_templates (
          id,
          slug,
          name,
          category
        )
      )
    `,
    )
    .eq('account_id', accountId)
    .order('assigned_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data;
});

// =====================================================
// EXPERIMENT QUERIES
// =====================================================

/**
 * Get active experiments for an account
 */
export const getActiveExperiments = cache(async (accountId: string) => {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('optimization_experiments')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'running')
    .order('started_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data as OptimizationExperiment[];
});

/**
 * Get experiment results
 */
export const getExperimentResults = cache(async (experimentId: string) => {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('optimization_experiments')
    .select(
      `
      *,
      system_prompt_combinations (*)
    `,
    )
    .eq('id', experimentId)
    .single();

  if (error) {
    throw error;
  }

  return data;
});

// =====================================================
// PERFORMANCE QUERIES
// =====================================================

/**
 * Get composition performance metrics
 */
export const getCompositionPerformance = cache(async (templateId: string) => {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('composition_performance')
    .select('*')
    .eq('template_id', templateId)
    .order('execution_count', { ascending: false })
    .limit(10);

  if (error) {
    throw error;
  }

  return data as CompositionPerformance[];
});

/**
 * Get best performing composition for a template
 */
export const getBestComposition = cache(async (templateId: string) => {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('composition_performance')
    .select('*')
    .eq('template_id', templateId)
    .gte('execution_count', 10) // Minimum sample size
    .order('success_count', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = no rows returned
    throw error;
  }

  return (data as CompositionPerformance) || null;
});

/**
 * Get execution logs for a template
 */
export const getExecutionLogs = cache(
  async (templateId: string, limit = 50) => {
    const client = getSupabaseServerClient();

    const { data, error } = await client
      .from('prompt_execution_logs')
      .select('*')
      .eq('template_id', templateId)
      .order('executed_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    return data;
  },
);

/**
 * Calculate attribution scores for system prompts
 */
export const calculateAttributionScores = cache(async (templateId: string) => {
  const client = getSupabaseServerClient();

  const { data, error } = await client.rpc('calculate_attribution_scores', {
    p_template_id: templateId,
  });

  if (error) {
    throw error;
  }

  return data;
});
