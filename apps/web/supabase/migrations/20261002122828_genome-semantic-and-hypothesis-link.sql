-- ==================================
-- Content genome v2: semantic attributes, and the experiment's hypothesis
-- (FILM-1717)
-- ==================================
-- Layer B: what a creative is doing to the viewer, recorded by hand as a
-- level. More tag dimensions, as in v1 (20261002122827) — still no ClickHouse
-- change. The list is TAG_DIMENSIONS in genome-attributes.ts;
-- genome-vocabulary.test.ts compares the two.

alter table public.content_tags
  drop constraint content_tags_dimension_check;

alter table public.content_tags
  add constraint content_tags_dimension_check check (dimension in (
    -- taxonomy: what the video is
    'topic', 'format', 'thumbnail_style',
    -- genome, observable: what it contains, recorded at publish
    'hook_type', 'opening_visual', 'first_sentence', 'face_present',
    'text_present', 'cuts_per_minute', 'scene_changes', 'question_first_3s',
    'result_first',
    -- genome, semantic: what the creative does to the viewer
    'curiosity', 'novelty', 'utility', 'relatability', 'identity',
    'surprise', 'aspiration', 'controversy', 'humour', 'authority'
  ));

alter table public.content_tags
  drop constraint content_tags_genome_closed_values_check;

alter table public.content_tags
  add constraint content_tags_genome_closed_values_check check (
    case dimension
      when 'face_present' then slug in ('yes', 'no')
      when 'text_present' then slug in ('yes', 'no')
      when 'question_first_3s' then slug in ('yes', 'no')
      when 'result_first' then slug in ('yes', 'no')
      when 'cuts_per_minute' then slug in ('under-5', '5-to-15', '15-to-30', 'over-30')
      when 'scene_changes' then slug in ('none', '1-to-3', '4-to-10', 'over-10')
      when 'curiosity' then slug in ('low', 'medium', 'high')
      when 'novelty' then slug in ('low', 'medium', 'high')
      when 'utility' then slug in ('low', 'medium', 'high')
      when 'relatability' then slug in ('low', 'medium', 'high')
      when 'identity' then slug in ('low', 'medium', 'high')
      when 'surprise' then slug in ('low', 'medium', 'high')
      when 'aspiration' then slug in ('low', 'medium', 'high')
      when 'controversy' then slug in ('low', 'medium', 'high')
      when 'humour' then slug in ('low', 'medium', 'high')
      when 'authority' then slug in ('low', 'medium', 'high')
      else true
    end
  );

-- The loop the genome closes: hypothesis → experiment → outcome → causal
-- evidence. Without a link from the experiment back to the hypothesis that
-- generated it, the genome can only ever accumulate correlations. The
-- hypothesis is not a row (no new table): it is its key, the attribute and
-- the funnel stage it is scored on, `dimension:slug@stage` — the stage is
-- what the experiment was about, without a second stage vocabulary.
--
-- Both kinds of experiment carry it: a Change log entry (FILM-1610) and a
-- channel experiment (FILM-1724, 20261001114902). The stages are FILM-1714's
-- five plus `monetisation`, which FILM-1726 appends (owner-approved); the
-- TypeScript pattern derives from FUNNEL_STAGES, so it accepts monetisation
-- once FILM-1726 adds the stage there.
alter table public.analytics_experiments
  add column genome_hypothesis varchar(120);

alter table public.analytics_experiments
  add constraint analytics_experiments_genome_hypothesis_check check (
    genome_hypothesis ~ '^[a-z0-9_]+:[a-z0-9]+(-[a-z0-9]+)*@(reach|hook|attention|transmission|audience|monetisation)$'
  );

alter table public.channel_experiments
  add column genome_hypothesis varchar(120);

alter table public.channel_experiments
  add constraint channel_experiments_genome_hypothesis_check check (
    genome_hypothesis ~ '^[a-z0-9_]+:[a-z0-9]+(-[a-z0-9]+)*@(reach|hook|attention|transmission|audience|monetisation)$'
  );

comment on column public.channel_experiments.genome_hypothesis is 'The content genome hypothesis this experiment tests, as dimension:slug@stage (FILM-1717); null when it did not come from one';

comment on column public.analytics_experiments.genome_hypothesis is 'The content genome hypothesis this change tests, as dimension:slug@stage (FILM-1717); null when it did not come from one';

-- Fixed once the change has started, as the hypothesis and expectation are
-- (20260919145838): linking a running or concluded change to a hypothesis
-- after the fact would let the result pick which hypothesis it confirms.
-- The service role (seeds, repairs) is exempt, as in the lifecycle guard.
create or replace function public.freeze_genome_hypothesis()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and old.status <> 'planned'
     and new.genome_hypothesis is distinct from old.genome_hypothesis then
    raise exception
      'The genome hypothesis cannot change once the experiment has started';
  end if;

  return new;
end;
$$;

create trigger analytics_experiments_freeze_genome_hypothesis
  before update of genome_hypothesis on public.analytics_experiments
  for each row execute function public.freeze_genome_hypothesis();

create trigger channel_experiments_freeze_genome_hypothesis
  before update of genome_hypothesis on public.channel_experiments
  for each row execute function public.freeze_genome_hypothesis();
