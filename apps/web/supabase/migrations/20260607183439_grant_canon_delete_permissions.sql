-- Grant DELETE on canon tables needed for episode reset operations.
-- Previously only SELECT/INSERT/UPDATE were granted, causing
-- resetToStageAction to fail with permission errors.

GRANT DELETE ON TABLE public.narrative_threads TO authenticated;
GRANT DELETE ON TABLE public.character_states TO authenticated;
GRANT DELETE ON TABLE public.state_deltas TO authenticated;
GRANT DELETE ON TABLE public.episode_summaries TO authenticated;
