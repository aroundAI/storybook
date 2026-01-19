-- Add 'audio_cue_generation' to generation_jobs job_type check constraint
ALTER TABLE public.generation_jobs DROP CONSTRAINT IF EXISTS generation_jobs_job_type_check;

ALTER TABLE public.generation_jobs ADD CONSTRAINT generation_jobs_job_type_check
CHECK (job_type IN ('video', 'voice', 'music', 'sfx', 'story', 'screenplay', 'shot_list', 'translate-dialogue', 'audio_cue_generation'));
