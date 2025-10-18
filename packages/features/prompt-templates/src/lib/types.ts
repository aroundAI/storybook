import type { Database } from '@kit/supabase/database';

// Database types
export type PromptTemplate =
  Database['public']['Tables']['prompt_templates']['Row'];
export type PromptSystemPrompt =
  Database['public']['Tables']['prompt_system_prompts']['Row'];
export type TemplateSystemPromptLink =
  Database['public']['Tables']['template_system_prompt_links']['Row'];
export type TemplateVariant =
  Database['public']['Tables']['template_variants']['Row'];
export type OptimizationExperiment =
  Database['public']['Tables']['optimization_experiments']['Row'];
export type CompositionPerformance =
  Database['public']['Tables']['composition_performance']['Row'];
export type PromptExecutionLog =
  Database['public']['Tables']['prompt_execution_logs']['Row'];

// Enum types
export type PromptCategory = Database['public']['Enums']['prompt_category'];
export type TemplateVariableType =
  Database['public']['Enums']['template_variable_type'];
export type EnvironmentLabel = Database['public']['Enums']['environment_label'];
export type SystemPromptLayer =
  Database['public']['Enums']['system_prompt_layer'];
export type SystemPromptScope =
  Database['public']['Enums']['system_prompt_scope'];
export type OptimizationStatus =
  Database['public']['Enums']['optimization_status'];
export type CompositionStrategy =
  Database['public']['Enums']['composition_strategy'];

// Extended types for queries
export interface PromptTemplateWithSystemPrompts extends PromptTemplate {
  system_prompts: Array<{
    system_prompt: PromptSystemPrompt;
    order_index: number;
    condition_rules: Record<string, unknown> | null;
  }>;
}

export interface SystemPromptComposition {
  template_id: string;
  system_prompts: Array<{
    id: string;
    slug: string;
    layer: SystemPromptLayer;
    content: string;
    priority: number;
  }>;
  composition_hash: string;
}

// Template variable schema
export interface TemplateVariable {
  type: TemplateVariableType;
  description: string;
  required: boolean;
  default?: unknown;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: unknown[];
  };
}

export interface TemplateVariables {
  [key: string]: TemplateVariable;
}

// Rendering types
export interface RenderContext {
  variables: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export interface RenderedPrompt {
  system_prompt: string;
  user_prompt: string;
  system_prompt_ids: Array<{
    id: string;
    slug: string;
    layer: SystemPromptLayer;
  }>;
  composition_hash: string;
}

// Optimization types
export interface ExperimentResult {
  variant_id: string;
  execution_count: number;
  success_count: number;
  success_rate: number;
  avg_rating: number | null;
  avg_cost: number | null;
  avg_latency_ms: number | null;
  confidence_interval?: {
    lower: number;
    upper: number;
  };
}

// Template execution options
export interface ExecutionOptions {
  variant_id?: string;
  context?: Record<string, unknown>;
  use_optimized?: boolean;
  experiment_id?: string;
  rating?: number;
}

// Performance metrics
export interface PerformanceMetrics {
  success: boolean;
  error_message?: string;
  rating?: number;
  cost?: number;
  latency_ms?: number;
  tokens_used?: number;
}
