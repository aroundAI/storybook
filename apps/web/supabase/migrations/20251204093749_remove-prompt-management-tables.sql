-- =====================================================
-- Remove Prompt Management System Tables
-- =====================================================
-- This migration removes the database-based prompt management system
-- in favor of JSON file-based prompts (@kit/prompt-engine)
-- =====================================================

-- Drop RLS policies first
DROP POLICY IF EXISTS "Super admins can view templates" ON public.prompt_templates;
DROP POLICY IF EXISTS "Super admins can create templates" ON public.prompt_templates;
DROP POLICY IF EXISTS "Super admins can update templates" ON public.prompt_templates;
DROP POLICY IF EXISTS "Super admins can delete templates" ON public.prompt_templates;

DROP POLICY IF EXISTS "Super admins can view all system prompts" ON public.prompt_system_prompts;
DROP POLICY IF EXISTS "Super admins can create system prompts" ON public.prompt_system_prompts;
DROP POLICY IF EXISTS "Super admins can update system prompts" ON public.prompt_system_prompts;
DROP POLICY IF EXISTS "Super admins can delete system prompts" ON public.prompt_system_prompts;

DROP POLICY IF EXISTS "Super admins can view links" ON public.template_system_prompt_links;
DROP POLICY IF EXISTS "Super admins can manage links" ON public.template_system_prompt_links;

DROP POLICY IF EXISTS "Super admins can view variants" ON public.template_variants;
DROP POLICY IF EXISTS "Super admins can manage variants" ON public.template_variants;

DROP POLICY IF EXISTS "Super admins can view variant assignments" ON public.variant_account_assignments;
DROP POLICY IF EXISTS "Super admins can manage variant assignments" ON public.variant_account_assignments;

DROP POLICY IF EXISTS "Super admins can view experiments" ON public.optimization_experiments;
DROP POLICY IF EXISTS "Super admins can manage experiments" ON public.optimization_experiments;

DROP POLICY IF EXISTS "Super admins can view combinations" ON public.system_prompt_combinations;
DROP POLICY IF EXISTS "System can manage combinations" ON public.system_prompt_combinations;

DROP POLICY IF EXISTS "Super admins can view performance" ON public.composition_performance;
DROP POLICY IF EXISTS "System can manage performance data" ON public.composition_performance;

DROP POLICY IF EXISTS "Super admins can view logs" ON public.prompt_execution_logs;
DROP POLICY IF EXISTS "System can create logs" ON public.prompt_execution_logs;

-- Drop database functions
DROP FUNCTION IF EXISTS public.compose_system_prompts(uuid, jsonb);
DROP FUNCTION IF EXISTS public.resolve_template(text, environment_label);
DROP FUNCTION IF EXISTS public.log_prompt_execution(uuid, uuid, uuid, text, jsonb, jsonb, text, text, jsonb, text, jsonb, boolean, text, numeric, numeric, integer, integer);
DROP FUNCTION IF EXISTS public.calculate_attribution_scores(uuid);
DROP FUNCTION IF EXISTS public.resolve_variant_for_account(uuid, uuid);

-- Drop tables in dependency order (most dependent first)
DROP TABLE IF EXISTS public.prompt_execution_logs CASCADE;
DROP TABLE IF EXISTS public.composition_performance CASCADE;
DROP TABLE IF EXISTS public.system_prompt_combinations CASCADE;
DROP TABLE IF EXISTS public.optimization_experiments CASCADE;
DROP TABLE IF EXISTS public.variant_account_assignments CASCADE;
DROP TABLE IF EXISTS public.template_variants CASCADE;
DROP TABLE IF EXISTS public.template_system_prompt_links CASCADE;
DROP TABLE IF EXISTS public.prompt_system_prompts CASCADE;
DROP TABLE IF EXISTS public.prompt_templates CASCADE;

-- Drop enums (safe after tables are dropped)
DROP TYPE IF EXISTS public.prompt_category;
DROP TYPE IF EXISTS public.template_variable_type;
DROP TYPE IF EXISTS public.environment_label;
DROP TYPE IF EXISTS public.system_prompt_layer;
DROP TYPE IF EXISTS public.system_prompt_scope;
DROP TYPE IF EXISTS public.optimization_status;
DROP TYPE IF EXISTS public.composition_strategy;
