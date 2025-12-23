-- Fix permissions for service_role which were revoked in 20251205125737_film-studio-tables.sql
-- The service_role (used by server actions/cron) needs full access to these tables.

GRANT ALL ON TABLE public.seasons TO service_role;
GRANT ALL ON TABLE public.episodes TO service_role;
GRANT ALL ON TABLE public.assets TO service_role;
GRANT ALL ON TABLE public.generation_jobs TO service_role;
GRANT ALL ON TABLE public.platform_connections TO service_role;
GRANT ALL ON TABLE public.shared_resources TO service_role;
GRANT ALL ON TABLE public.external_api_keys TO service_role;
GRANT ALL ON TABLE public.shots TO service_role;
GRANT ALL ON TABLE public.dialogue_lines TO service_role;
GRANT ALL ON TABLE public.audio_tracks TO service_role;
GRANT ALL ON TABLE public.character_details TO service_role;
GRANT ALL ON TABLE public.voice_profiles TO service_role;
GRANT ALL ON TABLE public.publishes TO service_role;
GRANT ALL ON TABLE public.content_analytics TO service_role;
