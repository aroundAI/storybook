import { z } from 'zod';

// =====================================================
// TEMPLATE SCHEMAS
// =====================================================

export const CreatePromptTemplateSchema = z.object({
  account_id: z.string().uuid(),
  slug: z
    .string()
    .min(3, 'Slug must be at least 3 characters')
    .max(100, 'Slug must be at most 100 characters')
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().optional(),
  category: z.enum([
    'analysis',
    'classification',
    'conversation',
    'extraction',
    'generation',
    'summarization',
    'transformation',
    'validation',
    'orchestration',
  ]),
  template_content: z.string().min(1, 'Template content is required'),
  variables: z.record(z.object({
    type: z.enum(['text', 'number', 'boolean', 'array', 'object', 'markdown', 'json', 'context']),
    description: z.string(),
    required: z.boolean().default(false),
    default: z.unknown().optional(),
    validation: z.object({
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().optional(),
      enum: z.array(z.unknown()).optional(),
    }).optional(),
  })).default({}),
  output_schema: z.record(z.unknown()).optional(),
  composition_strategy: z.enum(['fixed', 'conditional', 'ab_test', 'bandit', 'optimized']).default('fixed'),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export const UpdatePromptTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  template_content: z.string().min(1).optional(),
  variables: z.record(z.object({
    type: z.enum(['text', 'number', 'boolean', 'array', 'object', 'markdown', 'json', 'context']),
    description: z.string(),
    required: z.boolean().default(false),
    default: z.unknown().optional(),
  })).optional(),
  output_schema: z.record(z.unknown()).optional(),
  composition_strategy: z.enum(['fixed', 'conditional', 'ab_test', 'bandit', 'optimized']).optional(),
  is_active: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const DeletePromptTemplateSchema = z.object({
  id: z.string().uuid(),
});

export const PromoteToEnvironmentSchema = z.object({
  id: z.string().uuid(),
  environment: z.enum(['development', 'staging', 'canary', 'production']),
});

// =====================================================
// SYSTEM PROMPT SCHEMAS
// =====================================================

export const CreateSystemPromptSchema = z.object({
  account_id: z.string().uuid().optional(),
  slug: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  layer_type: z.enum([
    'compliance',
    'role',
    'context',
    'brand_voice',
    'format',
    'standards',
    'constraints',
    'examples',
  ]),
  scope: z.enum(['global', 'category', 'template', 'account']),
  target_category: z.enum([
    'analysis',
    'classification',
    'conversation',
    'extraction',
    'generation',
    'summarization',
    'transformation',
    'validation',
    'orchestration',
  ]).optional(),
  target_template_id: z.string().uuid().optional(),
  content: z.string().min(1),
  priority: z.number().int().min(0).default(0),
  condition_rules: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export const UpdateSystemPromptSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  content: z.string().min(1).optional(),
  priority: z.number().int().min(0).optional(),
  condition_rules: z.record(z.unknown()).optional(),
  is_active: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const DeleteSystemPromptSchema = z.object({
  id: z.string().uuid(),
});

// =====================================================
// LINK SCHEMAS
// =====================================================

export const LinkSystemPromptSchema = z.object({
  template_id: z.string().uuid(),
  system_prompt_id: z.string().uuid(),
  order_index: z.number().int().min(0),
  condition_rules: z.record(z.unknown()).optional(),
});

export const UnlinkSystemPromptSchema = z.object({
  template_id: z.string().uuid(),
  system_prompt_id: z.string().uuid(),
});

// =====================================================
// VARIANT SCHEMAS
// =====================================================

export const CreateVariantSchema = z.object({
  template_id: z.string().uuid(),
  variant_name: z.string().min(1).max(100),
  description: z.string().optional(),
  template_content: z.string().optional(),
  system_prompt_overrides: z.record(z.unknown()).optional(),
  traffic_weight: z.number().min(0).max(100).default(50),
});

export const UpdateVariantSchema = z.object({
  id: z.string().uuid(),
  variant_name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  template_content: z.string().optional(),
  system_prompt_overrides: z.record(z.unknown()).optional(),
  traffic_weight: z.number().min(0).max(100).optional(),
  is_active: z.boolean().optional(),
});

export const DeleteVariantSchema = z.object({
  id: z.string().uuid(),
});

// =====================================================
// EXPERIMENT SCHEMAS
// =====================================================

export const CreateExperimentSchema = z.object({
  account_id: z.string().uuid(),
  template_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  hypothesis: z.string().optional(),
  optimization_target: z.enum(['success_rate', 'avg_rating', 'cost', 'latency']),
  minimum_sample_size: z.number().int().min(10).default(100),
  confidence_level: z.number().min(0.5).max(0.99).default(0.95),
  variant_ids: z.array(z.string().uuid()).min(2),
});

export const UpdateExperimentSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['draft', 'running', 'analyzing', 'completed', 'applied', 'cancelled']),
  winner_variant_id: z.string().uuid().optional(),
  results_summary: z.record(z.unknown()).optional(),
});

// =====================================================
// EXECUTION SCHEMAS
// =====================================================

export const RenderTemplateSchema = z.object({
  template_id: z.string().uuid(),
  variables: z.record(z.unknown()),
  context: z.record(z.unknown()).optional(),
  variant_id: z.string().uuid().optional(),
});

export const LogExecutionSchema = z.object({
  account_id: z.string().uuid(),
  user_id: z.string().uuid().optional(),
  template_id: z.string().uuid(),
  variant_id: z.string().uuid().optional(),
  composition_hash: z.string(),
  variables: z.record(z.unknown()),
  context: z.record(z.unknown()).optional(),
  rendered_system_prompt: z.string(),
  rendered_user_prompt: z.string(),
  system_prompt_ids: z.array(z.object({
    id: z.string().uuid(),
    slug: z.string(),
    layer: z.string(),
  })),
  response_text: z.string().optional(),
  response_metadata: z.record(z.unknown()).optional(),
  success: z.boolean(),
  error_message: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  cost: z.number().min(0).optional(),
  latency_ms: z.number().int().min(0).optional(),
  tokens_used: z.number().int().min(0).optional(),
});

// Type exports
export type CreatePromptTemplateInput = z.infer<typeof CreatePromptTemplateSchema>;
export type UpdatePromptTemplateInput = z.infer<typeof UpdatePromptTemplateSchema>;
export type CreateSystemPromptInput = z.infer<typeof CreateSystemPromptSchema>;
export type UpdateSystemPromptInput = z.infer<typeof UpdateSystemPromptSchema>;
export type CreateVariantInput = z.infer<typeof CreateVariantSchema>;
export type UpdateVariantInput = z.infer<typeof UpdateVariantSchema>;
export type CreateExperimentInput = z.infer<typeof CreateExperimentSchema>;
export type RenderTemplateInput = z.infer<typeof RenderTemplateSchema>;
export type LogExecutionInput = z.infer<typeof LogExecutionSchema>;
