-- =====================================================
-- Prompt Management System - Database Schema
-- =====================================================
-- This schema provides a comprehensive prompt management system with:
-- - Global template management with versioning
-- - Layered system prompt composition
-- - A/B testing and optimization
-- - Performance tracking and attribution
-- - DSPy-style automated optimization
--
-- NOTE: Templates are GLOBAL (no account_id) - managed by super admins only
-- =====================================================

-- =====================================================
-- ENUMS
-- =====================================================

-- Prompt categories for organization
create type public.prompt_category as enum (
  'analysis',           -- Data analysis, insights generation
  'classification',     -- Content classification, categorization
  'conversation',       -- Chat, dialogue, customer support
  'extraction',         -- Information extraction, parsing
  'generation',         -- Content generation, creative writing
  'summarization',      -- Text summarization, condensing
  'transformation',     -- Format conversion, rewriting
  'validation',         -- Quality checks, compliance verification
  'orchestration'       -- Multi-agent coordination, routing
);

-- Variable types for template variables
create type public.template_variable_type as enum (
  'text',               -- Plain text input
  'number',             -- Numeric values
  'boolean',            -- True/false flags
  'array',              -- List of values
  'object',             -- Structured data
  'markdown',           -- Formatted markdown content
  'json',               -- JSON data structures
  'context'             -- External context injection
);

-- Environment labels for staged rollout
create type public.environment_label as enum (
  'development',        -- Local/dev environment
  'staging',            -- Staging/QA environment
  'canary',             -- Canary release (small % of production)
  'production',         -- Full production release
  'archived'            -- Archived/deprecated versions
);

-- System prompt layer types (order matters - applied in this sequence)
create type public.system_prompt_layer as enum (
  'compliance',         -- Legal, safety, ethical guidelines (highest priority)
  'role',               -- Core persona and expertise definition
  'context',            -- Domain knowledge and background
  'brand_voice',        -- Tone, style, brand guidelines
  'format',             -- Output structure and formatting rules
  'standards',          -- Quality standards, best practices
  'constraints',        -- Limitations, boundaries, guardrails
  'examples'            -- Few-shot examples, demonstrations (lowest priority)
);

-- System prompt scope (where it applies)
create type public.system_prompt_scope as enum (
  'global',             -- Applies to all prompts
  'category',           -- Applies to specific category
  'template'            -- Applies to specific template
);

-- Optimization experiment status
create type public.optimization_status as enum (
  'draft',              -- Being designed
  'running',            -- Actively testing
  'analyzing',          -- Collecting results
  'completed',          -- Finished with results
  'applied',            -- Winner promoted to production
  'cancelled'           -- Stopped early
);

-- Composition strategy for system prompt selection
create type public.composition_strategy as enum (
  'fixed',              -- Always use same combination
  'conditional',        -- Select based on context rules
  'ab_test',            -- Random assignment for testing
  'bandit',             -- Multi-armed bandit optimization
  'optimized'           -- Use best performing combination
);

-- =====================================================
-- CORE TABLES
-- =====================================================

-- Prompt templates (the "what to do")
-- NOTE: Global templates - no account_id (managed by super admins only)
create table public.prompt_templates (
  id uuid primary key default gen_random_uuid(),

  -- Identity
  slug text not null,                          -- Stable reference (e.g., "analyze-support-ticket")
  name text not null,
  description text,
  category prompt_category not null,

  -- Content
  template_content text not null,              -- Template with {{variables}}
  variables jsonb not null default '{}',       -- Schema: {name: {type, description, required, default}}
  output_schema jsonb,                         -- Expected output structure

  -- Versioning
  version integer not null default 1,
  environment environment_label not null default 'development',
  is_active boolean not null default true,
  parent_version_id uuid references public.prompt_templates(id) on delete set null,

  -- Composition
  composition_strategy composition_strategy not null default 'fixed',

  -- Metadata
  tags text[] default '{}',
  metadata jsonb default '{}',

  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,

  -- Constraints
  unique(slug, version),
  check(version > 0)
);

create index idx_prompt_templates_slug on public.prompt_templates(slug);
create index idx_prompt_templates_category on public.prompt_templates(category);
create index idx_prompt_templates_active on public.prompt_templates(is_active) where is_active = true;
create index idx_prompt_templates_environment on public.prompt_templates(environment);

-- System prompts (the "how to behave")
create table public.prompt_system_prompts (
  id uuid primary key default gen_random_uuid(),

  -- Identity
  slug text not null,                          -- Stable reference (e.g., "compliance-gdpr")
  name text not null,
  description text,

  -- Layer and Scope
  layer_type system_prompt_layer not null,
  scope system_prompt_scope not null,
  target_category prompt_category,             -- For category scope
  target_template_id uuid references public.prompt_templates(id) on delete cascade, -- For template scope

  -- Content
  content text not null,
  priority integer not null default 0,         -- Higher = appears first in layer

  -- Conditional inclusion
  condition_rules jsonb,                       -- When to include: {user_level: 'premium', locale: 'en-US'}

  -- Performance tracking
  contribution_score numeric(5, 2),            -- Performance attribution (-100 to +100)

  -- Versioning
  version integer not null default 1,
  is_active boolean not null default true,
  parent_version_id uuid references public.prompt_system_prompts(id) on delete set null,

  -- Metadata
  tags text[] default '{}',
  metadata jsonb default '{}',

  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,

  -- Constraints
  check(version > 0),
  check(priority >= 0),
  check(contribution_score is null or (contribution_score >= -100 and contribution_score <= 100)),
  check(
    (scope = 'global' and target_category is null and target_template_id is null) or
    (scope = 'category' and target_category is not null and target_template_id is null) or
    (scope = 'template' and target_template_id is not null and target_category is null)
  )
);

create index idx_system_prompts_slug on public.prompt_system_prompts(slug);
create index idx_system_prompts_layer on public.prompt_system_prompts(layer_type);
create index idx_system_prompts_scope on public.prompt_system_prompts(scope);
create index idx_system_prompts_active on public.prompt_system_prompts(is_active) where is_active = true;
create index idx_system_prompts_priority on public.prompt_system_prompts(priority desc);

-- Links between templates and system prompts (many-to-many)
create table public.template_system_prompt_links (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.prompt_templates(id) on delete cascade not null,
  system_prompt_id uuid references public.prompt_system_prompts(id) on delete cascade not null,

  -- Ordering
  order_index integer not null,                -- Explicit ordering within layer

  -- Conditional inclusion
  condition_rules jsonb,                       -- Override system prompt conditions

  -- Audit
  created_at timestamptz not null default now(),

  -- Constraints
  unique(template_id, system_prompt_id),
  check(order_index >= 0)
);

create index idx_template_system_prompt_links_template on public.template_system_prompt_links(template_id);
create index idx_template_system_prompt_links_system_prompt on public.template_system_prompt_links(system_prompt_id);

-- =====================================================
-- VARIANT & OPTIMIZATION TABLES
-- =====================================================

-- Template variants for A/B testing
create table public.template_variants (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.prompt_templates(id) on delete cascade not null,

  -- Identity
  variant_name text not null,                  -- E.g., "control", "variant-a", "with-examples"
  description text,

  -- Content overrides (null = use template default)
  template_content text,                       -- Override template content
  system_prompt_overrides jsonb,               -- Override specific system prompts

  -- Traffic allocation
  traffic_weight numeric(5, 2) not null default 50.00, -- Percentage (0-100)

  -- Status
  is_active boolean not null default true,

  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Constraints
  unique(template_id, variant_name),
  check(traffic_weight >= 0 and traffic_weight <= 100)
);

create index idx_template_variants_template on public.template_variants(template_id);
create index idx_template_variants_active on public.template_variants(is_active) where is_active = true;

-- Variant account assignments (admin assigns variants to specific accounts)
create table public.variant_account_assignments (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid references public.template_variants(id) on delete cascade not null,
  account_id uuid references public.accounts(id) on delete cascade not null,

  -- Audit
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,

  -- Constraints
  unique(variant_id, account_id)
);

create index idx_variant_account_assignments_variant on public.variant_account_assignments(variant_id);
create index idx_variant_account_assignments_account on public.variant_account_assignments(account_id);

-- Optimization experiments
create table public.optimization_experiments (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.prompt_templates(id) on delete cascade not null,

  -- Identity
  name text not null,
  description text,
  hypothesis text,                             -- What we're testing

  -- Configuration
  optimization_target text not null,           -- Metric to optimize: 'success_rate', 'avg_rating', 'cost'
  minimum_sample_size integer not null default 100,
  confidence_level numeric(4, 3) not null default 0.95,

  -- Variants being tested
  variant_ids uuid[] not null,                 -- References template_variants

  -- Status
  status optimization_status not null default 'draft',
  winner_variant_id uuid,                      -- Best performing variant

  -- Results
  results_summary jsonb,                       -- Aggregated statistics

  -- Timing
  started_at timestamptz,
  completed_at timestamptz,

  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,

  -- Constraints
  check(minimum_sample_size > 0),
  check(confidence_level > 0 and confidence_level < 1),
  check(array_length(variant_ids, 1) >= 2)
);

create index idx_optimization_experiments_template on public.optimization_experiments(template_id);
create index idx_optimization_experiments_status on public.optimization_experiments(status);

-- System prompt combinations tested during optimization
create table public.system_prompt_combinations (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid references public.optimization_experiments(id) on delete cascade not null,

  -- Combination
  system_prompt_ids jsonb not null,            -- Array of {layer, system_prompt_id}
  composition_hash text not null,              -- Hash for quick lookup

  -- Performance metrics
  execution_count integer not null default 0,
  success_count integer not null default 0,
  avg_rating numeric(4, 2),
  avg_cost numeric(10, 4),
  avg_latency_ms integer,

  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Constraints
  unique(experiment_id, composition_hash)
);

create index idx_system_prompt_combinations_experiment on public.system_prompt_combinations(experiment_id);
create index idx_system_prompt_combinations_hash on public.system_prompt_combinations(composition_hash);

-- =====================================================
-- EXECUTION & TRACKING TABLES
-- =====================================================

-- Composition performance tracking (aggregated by composition)
-- NOTE: Global performance tracking - no account_id
create table public.composition_performance (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.prompt_templates(id) on delete cascade not null,

  -- Composition
  composition_hash text not null unique,
  system_prompt_ids jsonb not null,            -- Array of {layer, system_prompt_id, slug}

  -- Aggregated metrics
  execution_count integer not null default 0,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  avg_rating numeric(4, 2),
  avg_cost numeric(10, 4),
  avg_latency_ms integer,
  avg_tokens integer,

  -- Time windows
  last_executed_at timestamptz,
  first_executed_at timestamptz not null default now(),

  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Constraints
  check(execution_count >= 0),
  check(success_count >= 0),
  check(failure_count >= 0),
  check(avg_rating is null or (avg_rating >= 0 and avg_rating <= 5))
);

create index idx_composition_performance_template on public.composition_performance(template_id);
create index idx_composition_performance_hash on public.composition_performance(composition_hash);
create index idx_composition_performance_success_rate on public.composition_performance((success_count::numeric / nullif(execution_count, 0)));

-- Execution logs (individual runs)
create table public.prompt_execution_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  template_id uuid references public.prompt_templates(id) on delete set null,
  variant_id uuid references public.template_variants(id) on delete set null,
  composition_hash text,

  -- Input
  variables jsonb not null,
  context jsonb,                               -- Context used for conditional selection

  -- Rendered prompts
  rendered_system_prompt text,
  rendered_user_prompt text,
  system_prompt_ids jsonb,                     -- Array of system prompt IDs used

  -- Output
  response_text text,
  response_metadata jsonb,

  -- Metrics
  success boolean not null default false,
  error_message text,
  rating numeric(3, 1),                        -- User rating (0-5)
  cost numeric(10, 4),
  latency_ms integer,
  tokens_used integer,

  -- Timing
  executed_at timestamptz not null default now(),

  -- Constraints
  check(rating is null or (rating >= 0 and rating <= 5)),
  check(cost is null or cost >= 0),
  check(latency_ms is null or latency_ms >= 0),
  check(tokens_used is null or tokens_used >= 0)
);

create index idx_prompt_execution_logs_template on public.prompt_execution_logs(template_id);
create index idx_prompt_execution_logs_composition on public.prompt_execution_logs(composition_hash);
create index idx_prompt_execution_logs_executed_at on public.prompt_execution_logs(executed_at desc);
create index idx_prompt_execution_logs_success on public.prompt_execution_logs(success);

-- =====================================================
-- DATABASE FUNCTIONS
-- =====================================================

-- Function: Compose system prompts for a template
create or replace function public.compose_system_prompts(
  p_template_id uuid,
  p_context jsonb default '{}'
)
returns text
language plpgsql
security definer
as $$
declare
  v_composition text := '';
  v_layer system_prompt_layer;
  v_system_prompt record;
  v_template record;
begin
  -- Get template details
  select * into v_template
  from public.prompt_templates
  where id = p_template_id and is_active = true;

  if not found then
    raise exception 'Template not found or inactive: %', p_template_id;
  end if;

  -- Iterate through layers in order
  foreach v_layer in array enum_range(null::system_prompt_layer)
  loop
    -- Get system prompts for this layer
    for v_system_prompt in
      select sp.*
      from public.prompt_system_prompts sp
      left join public.template_system_prompt_links link
        on link.system_prompt_id = sp.id and link.template_id = p_template_id
      where sp.is_active = true
        and sp.layer_type = v_layer
        and (
          -- Global scope
          (sp.scope = 'global') or
          -- Category scope
          (sp.scope = 'category' and sp.target_category = v_template.category) or
          -- Template scope (via link)
          (sp.scope = 'template' and link.template_id is not null)
        )
        -- Check conditions
        and (
          sp.condition_rules is null or
          sp.condition_rules <@ p_context
        )
      order by sp.priority desc, link.order_index nulls last, sp.created_at
    loop
      if v_composition != '' then
        v_composition := v_composition || E'\n\n';
      end if;
      v_composition := v_composition || '# ' || v_layer || E'\n' || v_system_prompt.content;
    end loop;
  end loop;

  return v_composition;
end;
$$;

-- Function: Resolve template by slug and environment
create or replace function public.resolve_template(
  p_slug text,
  p_environment environment_label default 'production'
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_template_id uuid;
begin
  -- Get latest version for environment
  select id into v_template_id
  from public.prompt_templates
  where slug = p_slug
    and environment = p_environment
    and is_active = true
  order by version desc
  limit 1;

  if not found then
    -- Fallback to production if not found
    if p_environment != 'production' then
      select id into v_template_id
      from public.prompt_templates
      where slug = p_slug
        and environment = 'production'
        and is_active = true
      order by version desc
      limit 1;
    end if;
  end if;

  if not found then
    raise exception 'Template not found: % (environment: %)', p_slug, p_environment;
  end if;

  return v_template_id;
end;
$$;

-- Function: Log prompt execution
create or replace function public.log_prompt_execution(
  p_user_id uuid,
  p_template_id uuid,
  p_variant_id uuid,
  p_composition_hash text,
  p_variables jsonb,
  p_context jsonb,
  p_rendered_system_prompt text,
  p_rendered_user_prompt text,
  p_system_prompt_ids jsonb,
  p_response_text text,
  p_response_metadata jsonb,
  p_success boolean,
  p_error_message text,
  p_rating numeric,
  p_cost numeric,
  p_latency_ms integer,
  p_tokens_used integer
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_log_id uuid;
begin
  -- Insert execution log
  insert into public.prompt_execution_logs (
    user_id,
    template_id,
    variant_id,
    composition_hash,
    variables,
    context,
    rendered_system_prompt,
    rendered_user_prompt,
    system_prompt_ids,
    response_text,
    response_metadata,
    success,
    error_message,
    rating,
    cost,
    latency_ms,
    tokens_used
  ) values (
    p_user_id,
    p_template_id,
    p_variant_id,
    p_composition_hash,
    p_variables,
    p_context,
    p_rendered_system_prompt,
    p_rendered_user_prompt,
    p_system_prompt_ids,
    p_response_text,
    p_response_metadata,
    p_success,
    p_error_message,
    p_rating,
    p_cost,
    p_latency_ms,
    p_tokens_used
  )
  returning id into v_log_id;

  -- Update composition performance
  insert into public.composition_performance (
    template_id,
    composition_hash,
    system_prompt_ids,
    execution_count,
    success_count,
    failure_count,
    avg_rating,
    avg_cost,
    avg_latency_ms,
    avg_tokens,
    last_executed_at
  ) values (
    p_template_id,
    p_composition_hash,
    p_system_prompt_ids,
    1,
    case when p_success then 1 else 0 end,
    case when p_success then 0 else 1 end,
    p_rating,
    p_cost,
    p_latency_ms,
    p_tokens_used,
    now()
  )
  on conflict (composition_hash) do update set
    execution_count = composition_performance.execution_count + 1,
    success_count = composition_performance.success_count + case when p_success then 1 else 0 end,
    failure_count = composition_performance.failure_count + case when p_success then 0 else 1 end,
    avg_rating = case
      when p_rating is not null then
        (coalesce(composition_performance.avg_rating, 0) * composition_performance.execution_count + p_rating) / (composition_performance.execution_count + 1)
      else composition_performance.avg_rating
    end,
    avg_cost = case
      when p_cost is not null then
        (coalesce(composition_performance.avg_cost, 0) * composition_performance.execution_count + p_cost) / (composition_performance.execution_count + 1)
      else composition_performance.avg_cost
    end,
    avg_latency_ms = case
      when p_latency_ms is not null then
        (coalesce(composition_performance.avg_latency_ms, 0) * composition_performance.execution_count + p_latency_ms) / (composition_performance.execution_count + 1)
      else composition_performance.avg_latency_ms
    end,
    avg_tokens = case
      when p_tokens_used is not null then
        (coalesce(composition_performance.avg_tokens, 0) * composition_performance.execution_count + p_tokens_used) / (composition_performance.execution_count + 1)
      else composition_performance.avg_tokens
    end,
    last_executed_at = now(),
    updated_at = now();

  return v_log_id;
end;
$$;

-- Function: Calculate attribution scores for system prompts
create or replace function public.calculate_attribution_scores(
  p_template_id uuid
)
returns table (
  system_prompt_id uuid,
  layer_type system_prompt_layer,
  contribution_score numeric
)
language plpgsql
security definer
as $$
begin
  -- Calculate contribution scores using performance differences
  -- When a system prompt is present vs absent
  return query
  with performance_by_layer as (
    select
      jsonb_array_elements(cp.system_prompt_ids)->>'layer' as layer,
      jsonb_array_elements(cp.system_prompt_ids)->>'system_prompt_id' as sp_id,
      avg(cp.success_count::numeric / nullif(cp.execution_count, 0)) as success_rate,
      avg(cp.avg_rating) as avg_rating
    from public.composition_performance cp
    where cp.template_id = p_template_id
      and cp.execution_count >= 10  -- Minimum sample size
    group by layer, sp_id
  ),
  baseline_performance as (
    select
      layer,
      avg(success_rate) as baseline_success_rate,
      avg(avg_rating) as baseline_avg_rating
    from performance_by_layer
    group by layer
  )
  select
    pbl.sp_id::uuid,
    pbl.layer::system_prompt_layer,
    (
      -- Normalize contribution: difference from baseline * 100
      coalesce((pbl.success_rate - bp.baseline_success_rate) * 100, 0) +
      coalesce((pbl.avg_rating - bp.baseline_avg_rating) * 20, 0)
    )::numeric(5,2) as contribution_score
  from performance_by_layer pbl
  join baseline_performance bp on bp.layer = pbl.layer;
end;
$$;

-- Function: Resolve variant for account (checks assignment first, then traffic weight)
create or replace function public.resolve_variant_for_account(
  p_template_id uuid,
  p_account_id uuid
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_variant_id uuid;
  v_total_weight numeric;
  v_random_value numeric;
  v_cumulative_weight numeric := 0;
  v_variant record;
begin
  -- First, check if account has an assigned variant for this template
  select vaa.variant_id into v_variant_id
  from public.variant_account_assignments vaa
  join public.template_variants tv on tv.id = vaa.variant_id
  where vaa.account_id = p_account_id
    and tv.template_id = p_template_id
    and tv.is_active = true
  limit 1;

  -- If found, return the assigned variant
  if v_variant_id is not null then
    return v_variant_id;
  end if;

  -- No assignment found, use traffic-weighted random selection
  -- Calculate total weight of active variants
  select sum(traffic_weight) into v_total_weight
  from public.template_variants
  where template_id = p_template_id
    and is_active = true;

  -- If no active variants or zero total weight, return null
  if v_total_weight is null or v_total_weight = 0 then
    return null;
  end if;

  -- Generate random value between 0 and total_weight
  v_random_value := random() * v_total_weight;

  -- Select variant based on traffic weight
  for v_variant in
    select id, traffic_weight
    from public.template_variants
    where template_id = p_template_id
      and is_active = true
    order by created_at
  loop
    v_cumulative_weight := v_cumulative_weight + v_variant.traffic_weight;
    if v_random_value <= v_cumulative_weight then
      return v_variant.id;
    end if;
  end loop;

  -- Fallback (shouldn't reach here, but return first active variant)
  select id into v_variant_id
  from public.template_variants
  where template_id = p_template_id
    and is_active = true
  limit 1;

  return v_variant_id;
end;
$$;

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

alter table public.prompt_templates enable row level security;
alter table public.prompt_system_prompts enable row level security;
alter table public.template_system_prompt_links enable row level security;
alter table public.template_variants enable row level security;
alter table public.variant_account_assignments enable row level security;
alter table public.optimization_experiments enable row level security;
alter table public.system_prompt_combinations enable row level security;
alter table public.composition_performance enable row level security;
alter table public.prompt_execution_logs enable row level security;

-- RLS for prompt_templates (super admin only)
create policy "Super admins can view templates"
  on public.prompt_templates for select
  using (
    public.is_super_admin()
  );

create policy "Super admins can create templates"
  on public.prompt_templates for insert
  with check (
    public.is_super_admin()
  );

create policy "Super admins can update templates"
  on public.prompt_templates for update
  using (
    public.is_super_admin()
  );

create policy "Super admins can delete templates"
  on public.prompt_templates for delete
  using (
    public.is_super_admin()
  );

-- RLS for prompt_system_prompts
create policy "Super admins can view all system prompts"
  on public.prompt_system_prompts for select
  using (
    public.is_super_admin()
  );

create policy "Super admins can create system prompts"
  on public.prompt_system_prompts for insert
  with check (
    public.is_super_admin()
  );

create policy "Super admins can update system prompts"
  on public.prompt_system_prompts for update
  using (
    public.is_super_admin()
  );

create policy "Super admins can delete system prompts"
  on public.prompt_system_prompts for delete
  using (
    public.is_super_admin()
  );

-- RLS for template_system_prompt_links
create policy "Super admins can view links"
  on public.template_system_prompt_links for select
  using (
    public.is_super_admin()
  );

create policy "Super admins can manage links"
  on public.template_system_prompt_links for all
  using (
    public.is_super_admin()
  );

-- RLS for template_variants
create policy "Super admins can view variants"
  on public.template_variants for select
  using (
    public.is_super_admin()
  );

create policy "Super admins can manage variants"
  on public.template_variants for all
  using (
    public.is_super_admin()
  );

-- RLS for variant_account_assignments
create policy "Super admins can view variant assignments"
  on public.variant_account_assignments for select
  using (
    public.is_super_admin()
  );

create policy "Super admins can manage variant assignments"
  on public.variant_account_assignments for all
  using (
    public.is_super_admin()
  );

-- RLS for optimization_experiments
create policy "Super admins can view experiments"
  on public.optimization_experiments for select
  using (
    public.is_super_admin()
  );

create policy "Super admins can manage experiments"
  on public.optimization_experiments for all
  using (
    public.is_super_admin()
  );

-- RLS for system_prompt_combinations
create policy "Super admins can view combinations"
  on public.system_prompt_combinations for select
  using (
    public.is_super_admin()
  );

create policy "System can manage combinations"
  on public.system_prompt_combinations for all
  using (
    auth.jwt()->>'role' = 'service_role' or
    public.is_super_admin()
  );

-- RLS for composition_performance
create policy "Super admins can view performance"
  on public.composition_performance for select
  using (
    public.is_super_admin()
  );

create policy "System can manage performance data"
  on public.composition_performance for all
  using (
    auth.jwt()->>'role' = 'service_role' or
    public.is_super_admin()
  );

-- RLS for prompt_execution_logs
create policy "Super admins can view logs"
  on public.prompt_execution_logs for select
  using (
    public.is_super_admin()
  );

create policy "System can create logs"
  on public.prompt_execution_logs for insert
  with check (
    auth.jwt()->>'role' = 'service_role' or
    public.is_super_admin()
  );

-- =====================================================
-- SEED DATA
-- =====================================================

-- Global system prompts (foundational layer)
insert into public.prompt_system_prompts (slug, name, description, layer_type, scope, content, priority, is_active) values
(
  'compliance-safety',
  'Safety & Compliance',
  'Core safety and ethical guidelines',
  'compliance',
  'global',
  'You must prioritize user safety and follow ethical guidelines. Do not:
- Generate harmful, illegal, or dangerous content
- Violate privacy or confidentiality
- Provide medical, legal, or financial advice unless explicitly qualified
- Discriminate based on protected characteristics

Always:
- Respect intellectual property rights
- Maintain user confidentiality
- Decline inappropriate requests politely
- Cite sources when providing factual information',
  100,
  true
),
(
  'role-helpful-assistant',
  'Helpful Assistant Role',
  'Default helpful assistant persona',
  'role',
  'global',
  'You are a helpful, professional AI assistant designed to provide accurate, clear, and actionable information. You:
- Communicate clearly and concisely
- Ask clarifying questions when needed
- Admit uncertainty rather than guessing
- Provide step-by-step guidance for complex tasks
- Adapt your communication style to the user''s needs',
  50,
  true
),
(
  'format-markdown',
  'Markdown Formatting',
  'Standard markdown output formatting',
  'format',
  'global',
  'Format your responses using clear markdown:
- Use **bold** for emphasis on key points
- Use `code blocks` for technical terms, commands, or code
- Use numbered lists for sequential steps
- Use bullet points for non-sequential items
- Use headings to organize longer responses
- Use tables for structured data comparison',
  50,
  true
),
(
  'standards-quality',
  'Quality Standards',
  'Output quality expectations',
  'standards',
  'global',
  'Maintain high quality standards in all responses:
- Accuracy: Verify facts and provide sources when possible
- Clarity: Use simple language, avoid jargon unless necessary
- Completeness: Address all parts of the user''s question
- Conciseness: Be thorough but avoid unnecessary verbosity
- Professionalism: Maintain a respectful and professional tone',
  50,
  true
);

-- Category-specific system prompts
insert into public.prompt_system_prompts (slug, name, description, layer_type, scope, target_category, content, priority, is_active) values
(
  'analysis-methodology',
  'Analysis Methodology',
  'Structured approach for analysis tasks',
  'context',
  'category',
  'analysis',
  'When performing analysis:
1. Start by understanding the data structure and context
2. Identify patterns, trends, and anomalies
3. Consider multiple perspectives and potential biases
4. Quantify findings with specific metrics when possible
5. Draw evidence-based conclusions
6. Suggest actionable next steps

Always explain your analytical reasoning and any assumptions made.',
  75,
  true
),
(
  'conversation-guidelines',
  'Conversation Guidelines',
  'Natural conversation flow and empathy',
  'context',
  'category',
  'conversation',
  'Maintain natural, engaging conversation:
- Use a warm, friendly tone while remaining professional
- Show empathy and understanding for user concerns
- Remember context from earlier in the conversation
- Ask follow-up questions to better understand needs
- Provide personalized responses rather than generic answers
- End with clear next steps or questions to continue the dialogue',
  75,
  true
),
(
  'extraction-precision',
  'Extraction Precision',
  'Accurate information extraction guidelines',
  'context',
  'category',
  'extraction',
  'When extracting information:
- Identify and extract exactly what was requested
- Preserve original formatting and terminology
- Note any ambiguities or missing information
- Use structured output (JSON, tables) for complex data
- Include confidence levels if uncertain
- Provide source references for extracted information',
  75,
  true
);

-- Example prompt templates
insert into public.prompt_templates (
  slug,
  name,
  description,
  category,
  template_content,
  variables,
  environment,
  composition_strategy,
  is_active
) values
(
  'analyze-support-ticket',
  'Support Ticket Analysis',
  'Analyzes customer support tickets and suggests resolutions',
  'analysis',
  'Analyze the following support ticket and provide insights:

**Ticket ID:** {{ticket_id}}
**Customer:** {{customer_name}}
**Priority:** {{priority}}
**Category:** {{category}}

**Description:**
{{description}}

Please provide:
1. Root cause analysis
2. Suggested resolution steps
3. Estimated resolution time
4. Related known issues',
  '{
    "ticket_id": {"type": "text", "description": "Unique ticket identifier", "required": true},
    "customer_name": {"type": "text", "description": "Customer name", "required": true},
    "priority": {"type": "text", "description": "Ticket priority (low/medium/high/critical)", "required": true},
    "category": {"type": "text", "description": "Ticket category", "required": true},
    "description": {"type": "text", "description": "Detailed ticket description", "required": true}
  }',
  'production',
  'fixed',
  true
),
(
  'customer-conversation',
  'Customer Conversation',
  'Natural customer support conversation handling',
  'conversation',
  'You are assisting a customer with their inquiry. Maintain a helpful and professional tone.

**Customer:** {{customer_name}}
**Context:** {{conversation_context}}

**Latest Message:**
{{customer_message}}

Please respond appropriately, addressing their concerns and offering solutions.',
  '{
    "customer_name": {"type": "text", "description": "Customer name", "required": true},
    "conversation_context": {"type": "text", "description": "Previous conversation context", "required": false},
    "customer_message": {"type": "text", "description": "Latest customer message", "required": true}
  }',
  'production',
  'fixed',
  true
)
on conflict (slug, version) do nothing;

-- Link system prompts to templates
insert into public.template_system_prompt_links (template_id, system_prompt_id, order_index)
select
  pt.id,
  sp.id,
  case sp.layer_type
    when 'compliance' then 1
    when 'role' then 2
    when 'context' then 3
    when 'format' then 4
    when 'standards' then 5
    else 99
  end as order_index
from public.prompt_templates pt
cross join public.prompt_system_prompts sp
where pt.slug in ('analyze-support-ticket', 'customer-conversation')
  and sp.slug in ('compliance-safety', 'role-helpful-assistant', 'analysis-methodology', 'conversation-guidelines', 'format-markdown', 'standards-quality')
  and sp.is_active = true
  and (
    sp.scope = 'global' or
    (sp.scope = 'category' and sp.target_category = pt.category)
  )
on conflict (template_id, system_prompt_id) do nothing;
