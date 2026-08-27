-- ==================================
-- Hook Testing Engine (FILM-1301 / FILM-1510)
-- ==================================
-- Deliberate A/B testing of video hooks. Retention is NOT stored here:
-- it is read from the generic ClickHouse video_retention_curves table
-- (FILM-1505) and interpolated against the video's duration, then cached
-- onto the variant for fast list rendering.

create table if not exists public.hook_tests (
  id uuid primary key default extensions.uuid_generate_v4(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  topic text not null,
  hypothesis text,
  status text not null default 'draft',
  viral_threshold numeric not null default 0.75,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('draft', 'generating', 'rendering', 'live', 'completed', 'archived')),
  check (viral_threshold > 0 and viral_threshold <= 1)
);

comment on table public.hook_tests is 'Hook A/B test containers (FILM-1510)';
comment on column public.hook_tests.viral_threshold is '3-second retention rate a variant must exceed to be declared the winner';

create index if not exists idx_hook_tests_account on public.hook_tests(account_id, created_at desc);
create index if not exists idx_hook_tests_project on public.hook_tests(project_id);

create trigger set_hook_tests_timestamp
  before update on public.hook_tests
  for each row
  execute function public.trigger_set_timestamps();

create table if not exists public.hook_variants (
  id uuid primary key default extensions.uuid_generate_v4(),
  test_id uuid not null references public.hook_tests(id) on delete cascade,
  hook_type text not null,
  label text,
  script text not null,
  veo_prompt jsonb,
  asset_id uuid references public.assets(id) on delete set null,
  publish_id uuid references public.publishes(id) on delete set null,
  thumbnail_url text,
  duration_seconds numeric default 5,
  retention_1s numeric,
  retention_3s numeric,
  retention_5s numeric,
  retention_full numeric,
  total_views integer default 0,
  is_winner boolean not null default false,
  retention_updated_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.hook_variants is 'Hook variants within a test; retention values are cached from ClickHouse video_retention_curves';
comment on column public.hook_variants.publish_id is 'The published video this variant maps to, used to look up its retention curve';

-- One winner per test, enforced in the database
create unique index if not exists uq_one_winner_per_test
  on public.hook_variants (test_id) where is_winner is true;

create index if not exists idx_hook_variants_test on public.hook_variants(test_id);
create index if not exists idx_hook_variants_publish on public.hook_variants(publish_id)
  where publish_id is not null;

-- ==================================
-- RLS
-- ==================================

alter table public.hook_tests enable row level security;
alter table public.hook_variants enable row level security;

revoke all on public.hook_tests from authenticated, service_role;
revoke all on public.hook_variants from authenticated, service_role;

grant select, insert, update, delete on public.hook_tests to authenticated;
grant select, insert, update, delete on public.hook_variants to authenticated;
grant select, insert, update, delete on public.hook_tests to service_role;
grant select, insert, update, delete on public.hook_variants to service_role;

create policy "hook_tests_read" on public.hook_tests for select
  to authenticated using (public.has_account_access(account_id));

create policy "hook_tests_create" on public.hook_tests for insert
  to authenticated with check (public.has_account_access(account_id));

create policy "hook_tests_update" on public.hook_tests for update
  to authenticated using (public.has_account_access(account_id));

create policy "hook_tests_delete" on public.hook_tests for delete
  to authenticated using (public.has_account_access(account_id));

-- Variants authorize through their parent test
create policy "hook_variants_read" on public.hook_variants for select
  to authenticated using (
    exists (
      select 1 from public.hook_tests t
      where t.id = test_id and public.has_account_access(t.account_id)
    )
  );

create policy "hook_variants_create" on public.hook_variants for insert
  to authenticated with check (
    exists (
      select 1 from public.hook_tests t
      where t.id = test_id and public.has_account_access(t.account_id)
    )
  );

create policy "hook_variants_update" on public.hook_variants for update
  to authenticated using (
    exists (
      select 1 from public.hook_tests t
      where t.id = test_id and public.has_account_access(t.account_id)
    )
  );

create policy "hook_variants_delete" on public.hook_variants for delete
  to authenticated using (
    exists (
      select 1 from public.hook_tests t
      where t.id = test_id and public.has_account_access(t.account_id)
    )
  );
