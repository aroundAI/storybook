-- ==================================
-- Team AI settings always allow a mode (FILM-1910)
-- ==================================
-- account_ai_settings (FILM-1903) lets an owner turn server generation
-- (Gemini in the app) and external generation (an MCP client such as
-- Claude) on and off. Turning both off would leave a team with no way to
-- generate anything, and a default mode the team does not allow would leave
-- openRun choosing between a refusal and a silent switch.
--
-- Decision (lead, 2026-10-03, README open question 4; the owner may revise):
-- a team may turn either mode off, never both, and its default is a mode it
-- allows. The settings page refuses both with a message; these constraints
-- hold the rule for every other writer too, since owners write the table
-- directly under RLS.
--
-- Defaults (true, true, 'server') satisfy both, so no existing row can fail.
-- Tests: tests/database/account-ai-settings-modes.test.sql.

alter table public.account_ai_settings
  add constraint account_ai_settings_a_mode_allowed
    check (server_generation_enabled or external_generation_enabled);

alter table public.account_ai_settings
  add constraint account_ai_settings_default_mode_allowed
    check (
      (default_mode = 'server' and server_generation_enabled)
      or (default_mode = 'external' and external_generation_enabled)
    );

comment on constraint account_ai_settings_a_mode_allowed on public.account_ai_settings is
  'A team allows at least one generation mode (FILM-1910)';
comment on constraint account_ai_settings_default_mode_allowed on public.account_ai_settings is
  'The default mode is one the team allows (FILM-1910)';
