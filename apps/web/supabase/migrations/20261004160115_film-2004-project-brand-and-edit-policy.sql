-- FILM-2004: a project carries a brand and an edit policy the Studio reads.
--
-- Both are JSON objects validated in the app by BrandSchema and
-- EditPolicySchema (@kit/desktop-integration). '{}' means "all defaults":
-- the schemas fill every missing field, so a project that never opened the
-- Brand or Edit policy page still hands the Studio a complete object. The
-- column only guarantees an object; field rules live in the schemas, which
-- the fork shares.
--
-- No new policy: the columns ride on projects_update (can_edit_project,
-- project owner or admin). Writing either one bumps projects.updated_at
-- through projects_set_timestamps, which the edit package etag reads
-- (FILM-2001).

alter table public.projects
  add column brand jsonb not null default '{}'::jsonb,
  add column edit_policy jsonb not null default '{}'::jsonb,
  add constraint projects_brand_is_object
    check (jsonb_typeof(brand) = 'object'),
  add constraint projects_edit_policy_is_object
    check (jsonb_typeof(edit_policy) = 'object');

comment on column public.projects.brand is
  'FILM-2004 BrandSchema: fonts, colours, caption style, logo, intro/outro asset ids, transition and music style. {} = defaults.';
comment on column public.projects.edit_policy is
  'FILM-2004 EditPolicySchema: target duration, shot length bounds, transitions, music ducking, captions, visual rules, loudness. {} = defaults.';
