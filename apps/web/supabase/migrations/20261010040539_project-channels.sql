-- A project's channels: the channels its episodes publish to.
--
-- project_publishing_configs was written and never read (lead L1 in
-- specs/plans/KB-30-edd.md), so every project published to every channel
-- on the team. It becomes the project's channel list: one row per channel.
-- Which language version a channel receives is the channel's own
-- platform_connections.language; this table's language is no longer read.

-- One row per (project, channel), keeping an enabled row over a disabled one
delete from public.project_publishing_configs cfg
 using public.project_publishing_configs keep
 where keep.project_id = cfg.project_id
   and keep.platform_connection_id = cfg.platform_connection_id
   and keep.id <> cfg.id
   and (coalesce(keep.is_enabled, false), keep.created_at, keep.id)
     > (coalesce(cfg.is_enabled, false), cfg.created_at, cfg.id);

alter table public.project_publishing_configs
  drop constraint if exists project_publishing_unique,
  drop constraint if exists project_publishing_language_check;

alter table public.project_publishing_configs
  add constraint project_publishing_channel_unique
    unique (project_id, platform_connection_id);

comment on table public.project_publishing_configs is
  'The channels a project publishes to: its episodes can publish only to these';
comment on column public.project_publishing_configs.language is
  'Not read: a channel receives the version in platform_connections.language';
