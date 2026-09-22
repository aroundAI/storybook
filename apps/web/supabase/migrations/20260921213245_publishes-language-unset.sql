-- FILM-1702: a publish whose language nobody set is not an English publish.
--
-- `publishes.language` was `varchar(5) NOT NULL DEFAULT 'en'`
-- (20251224180000_add_multi_language_analytics.sql). The column could not
-- say "never set", so every publish created without a language was recorded
-- as English, indistinguishably from one deliberately published in English.
-- Every language breakdown therefore had an English bucket that was really
-- "English, plus everything nobody labelled" — and on a project that never
-- used the language features, that bucket was simply everything.
--
-- NULL now means never set. Nothing defaults to a language.
--
-- `platform_connections.language` keeps its `'en'` default on purpose. It is
-- a routing *setting*, not a measurement: a channel left on the default
-- really does receive the English asset, so "English" is what it does, not a
-- guess about what it is. The analytics surfaces name it "Channel target
-- language" for that reason.

-- ---------------------------------------------------------------------------
-- 1. The column can express "never set"
-- ---------------------------------------------------------------------------

alter table public.publishes
  alter column language drop default,
  alter column language drop not null;

-- ---------------------------------------------------------------------------
-- 2. What the existing 'en' rows mean
-- ---------------------------------------------------------------------------
--
-- The information was never captured, so it cannot be recovered; it can only
-- be interpreted. The interpretation, recorded in the spec before this ran
-- (specs/phase-17-analytics-provenance/FILM-1702 §2a):
--
--   An existing 'en' is reclassified to NULL only where it is PROVABLE that
--   no code path ever wrote it. Everything else stays 'en'.
--
-- Two cases are provable:
--
--   (a) `platform_connection_id is null`. The only application writer that
--       creates a connection-less publish is markAsExternallyUploaded
--       (packages/features/publishing/src/server/upload-only-actions.ts),
--       and its insert has never named `language`. Seeds and SQL fixtures
--       likewise. The value is the column default, every time.
--
--   (b) `created_at` before this column existed. 20251224180000 is the
--       migration's own timestamp, which is a lower bound on when it could
--       have been applied anywhere — so a row created before it received
--       'en' from `ADD COLUMN ... DEFAULT`, not from anyone's choice.
--
-- Every other 'en' was written by publishToAllAction, which has always named
-- `language` — from the key of the asset the publish screen picked, or from
-- the channel's target. Those stay English. One ambiguity survives and is
-- recorded rather than resolved: where the value was inherited from a
-- channel whose own target was never changed from its default, English is
-- what the routing did, but nobody can say it is what the video is.
--
-- Deliberately not heuristic. "This account never used dubbing, so its 'en'
-- is probably a default" is plausible and unfalsifiable, and would relabel a
-- genuinely English channel as unknown. A wrong NULL is as much a fabricated
-- value as a wrong 'en'.
--
-- Reversible, because only 'en' is ever reclassified and nothing written
-- before this migration could have been NULL:
--
--   update public.publishes set language = 'en'
--   where language is null and created_at < '<when this migration ran>';
--
-- A blank is "not set" too; the constraint below would otherwise refuse the
-- table.

update public.publishes
set language = null
where btrim(language) = '';

update public.publishes
set language = null
where language = 'en'
  and (
    platform_connection_id is null
    or created_at < timestamptz '2025-12-24 18:00:00+00'
  );

-- ---------------------------------------------------------------------------
-- 3. "Not set" has exactly one spelling
-- ---------------------------------------------------------------------------
--
-- Without this, '' becomes a third state between NULL and a code, and the
-- readers that used `language || 'en'` were treating it as English already.

alter table public.publishes
  add constraint publishes_language_not_blank
  check (language is null or char_length(btrim(language)) >= 2);

comment on column public.publishes.language is
  'ISO 639-1 code of the published asset (en, hi, es, pt, ...). NULL means nobody set one: it is never defaulted to a language, because a defaulted code is indistinguishable from a chosen one (FILM-1702).';
