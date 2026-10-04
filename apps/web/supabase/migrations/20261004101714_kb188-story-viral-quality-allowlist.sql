-- KB-188: the story stage's commit stores episodes.viral_quality.
--
-- The Story Orchestrator used to write viral_quality itself, mid-run, with a
-- plain update. The update trigger bumps episodes.version on every update,
-- so the story run, briefed at the version the page sent, then had its own
-- commit refused with TARGET_CHANGED. The score now goes into the story's
-- plan, applied in the run's one transaction, and the allowlist gains
-- viral_quality on episodes updates. Nothing else changes: the function is
-- redefined whole, as 20261003163615 left it plus that one column.

create or replace function kit.generation_commit_allowlist()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select $json$ {
    "episodes": {"scope": "episode_row", "ops": ["insert", "update"],
      "insert": ["project_id", "season_id", "number", "title", "slug", "description", "status",
                 "story_data", "version", "generation_origin"],
      "update": ["title", "description", "status", "story_data", "screenplay_data", "shot_list",
                 "metadata", "target_duration_seconds", "updated_at", "generation_origin",
                 "viral_quality"]},
    "projects": {"scope": "project_row", "ops": ["update"],
      "insert": [], "update": ["metadata"]},
    "assets": {"scope": "project", "ops": ["upsert"],
      "insert": ["project_id", "type", "name", "description", "metadata", "deleted_at", "generation_origin"],
      "update": ["description", "metadata", "deleted_at", "generation_origin"]},
    "shots": {"scope": "episode", "ops": ["insert", "delete", "update"],
      "insert": ["episode_id", "scene_number", "shot_number", "sequence_number", "scene_description",
                 "prompt", "duration_seconds", "camera_direction", "status", "shorts_candidate",
                 "shorts_metadata", "generation_metadata", "transition_type", "frame_strategy",
                 "primary_subject", "first_frame_description", "last_frame_description",
                 "location_area", "location_environment_description", "generation_origin"],
      "update": ["scene_description", "prompt", "duration_seconds", "camera_direction",
                 "generation_metadata", "transition_type", "frame_strategy", "primary_subject",
                 "first_frame_description", "last_frame_description", "location_area",
                 "location_environment_description", "generation_origin"]},
    "audio_cues": {"scope": "episode", "ops": ["insert", "delete"],
      "insert": ["episode_id", "scene_number", "cue_type", "prompt", "start_offset_seconds",
                 "duration_seconds", "is_loopable", "status", "generation_origin"],
      "update": []},
    "audio_tracks": {"scope": "episode", "ops": ["delete"], "insert": [], "update": []},
    "dialogue_lines": {"scope": "episode", "ops": ["insert", "delete", "update"],
      "insert": ["episode_id", "character_asset_id", "shot_id", "text", "sequence_number",
                 "scene_number", "timeline_start_seconds", "estimated_duration_seconds", "language",
                 "source_dialogue_id", "status", "generation_origin"],
      "update": ["text", "character_asset_id", "status", "generation_origin"]},
    "generation_jobs": {"scope": "job", "ops": ["update"],
      "insert": [], "update": ["status", "completed_at", "output_data"]},
    "verified_facts": {"scope": "project", "ops": ["insert"],
      "insert": ["project_id", "claim", "simplified_claim", "category", "source_type",
                 "source_citation", "source_title", "confidence_score", "verification_status",
                 "created_by"],
      "update": []},
    "immutable_events": {"scope": "project", "ops": ["insert", "delete"],
      "insert": ["project_id", "event_type", "event_key", "established_in", "season",
                 "episode_number", "description", "metadata", "created_by"],
      "update": []},
    "character_states": {"scope": "episode", "ops": ["insert", "delete"],
      "insert": ["character_id", "episode_id", "state_type", "state_value", "trigger_event",
                 "created_by"],
      "update": []},
    "narrative_threads": {"scope": "project", "ops": ["insert", "update", "delete"],
      "insert": ["project_id", "thread_name", "thread_type", "opened_at", "description", "promises",
                 "episodes_touched", "status", "auto_generated"],
      "update": ["status", "episodes_touched", "description", "version", "resolved_at", "payoffs"]},
    "episode_summaries": {"scope": "episode", "ops": ["upsert"],
      "insert": ["episode_id", "plot_summary", "key_events", "character_changes", "sentiment_score",
                 "estimated_tokens", "updated_at"],
      "update": ["plot_summary", "key_events", "character_changes", "sentiment_score",
                 "estimated_tokens", "updated_at"]},
    "world_states": {"scope": "project", "ops": ["insert", "update"],
      "insert": ["project_id", "episode_id", "location", "time_period", "atmosphere",
                 "active_conflicts", "updated_at"],
      "update": ["location", "time_period", "atmosphere", "active_conflicts", "updated_at"]},
    "state_deltas": {"scope": "episode", "ops": ["insert"],
      "insert": ["episode_id", "entity_type", "entity_id", "before_state", "after_state",
                 "change_reason"],
      "update": []}
  } $json$::jsonb
$$;

revoke all on function kit.generation_commit_allowlist() from public;
