-- ==================================
-- FILM-512 Fix: Add updated_at to dubbed_dialogue_lines
-- ==================================
-- Adds updated_at column and timestamp trigger for audit trail consistency

-- Add updated_at column
alter table public.dubbed_dialogue_lines
add column if not exists updated_at timestamp with time zone default now() not null;

-- Add timestamps trigger for dubbed_dialogue_lines
create trigger dubbed_dialogue_lines_set_timestamps
before insert or update on public.dubbed_dialogue_lines
for each row execute function public.trigger_set_timestamps();

comment on column public.dubbed_dialogue_lines.updated_at is 'Last modification timestamp';
