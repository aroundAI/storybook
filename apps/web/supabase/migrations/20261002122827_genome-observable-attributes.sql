-- ==================================
-- Content genome v1: observable attributes (FILM-1717)
-- ==================================
-- The genome's attributes are tags: they flow through publish_tags into
-- ClickHouse video_dim.tags as `dimension:slug`, an Array(String) that
-- already carries any dimension, so ClickHouse needs no change. This adds
-- the observable layer's dimensions to the one CHECK that names them.
--
-- The list is the one in packages/clickhouse/src/lib/genome-attributes.ts
-- (TAG_DIMENSIONS); genome-vocabulary.test.ts compares the two.
--
-- hook_type stays, with its slugs unchanged: it is now read as a genome
-- attribute rather than a taxonomy one, and is the only hook vocabulary
-- left — the Hook Lab's free-text hook_variants.hook_type was dropped with
-- its table (20260919193447).

alter table public.content_tags
  drop constraint content_tags_dimension_check;

alter table public.content_tags
  add constraint content_tags_dimension_check check (dimension in (
    -- taxonomy: what the video is
    'topic', 'format', 'thumbnail_style',
    -- genome, observable: what it contains, recorded at publish
    'hook_type', 'opening_visual', 'first_sentence', 'face_present',
    'text_present', 'cuts_per_minute', 'scene_changes', 'question_first_3s',
    'result_first'
  ));

-- A yes/no attribute spelt differently on two accounts, or a band whose
-- edges move, could not be compared. These dimensions take only these
-- values (CLOSED_TAG_VALUES); the others stay each account's own vocabulary.
alter table public.content_tags
  add constraint content_tags_genome_closed_values_check check (
    case dimension
      when 'face_present' then slug in ('yes', 'no')
      when 'text_present' then slug in ('yes', 'no')
      when 'question_first_3s' then slug in ('yes', 'no')
      when 'result_first' then slug in ('yes', 'no')
      when 'cuts_per_minute' then slug in ('under-5', '5-to-15', '15-to-30', 'over-30')
      when 'scene_changes' then slug in ('none', '1-to-3', '4-to-10', 'over-10')
      else true
    end
  );

comment on table public.content_tags is 'Controlled per-account vocabulary for content analysis: taxonomy (topic/format/thumbnail_style) and genome attributes (FILM-1717)';
