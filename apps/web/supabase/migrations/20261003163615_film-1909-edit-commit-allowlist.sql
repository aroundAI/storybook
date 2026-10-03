-- FILM-1909: targeted edits (edit_shot, edit_scene, edit_dialogue_line over
-- MCP) commit through apply_generation_commit like every stage, under an
-- external run on the episode, so they are versioned (TARGET_CHANGED),
-- snapshotted into content_revisions and applied in one transaction.
--
-- An edit changes one shot or one dialogue line in place, keeping its id,
-- its place in the sequence, its status and its rendered media, as the
-- visual and audio studios' own edits do. The allowlist gains `update` on
-- shots and dialogue_lines, for the content columns only:
--
--   shots           what the shots commit inserts about a shot (description,
--                   prompt, duration, camera, metadata, transition, frame
--                   strategy and descriptions, location detail, origin);
--                   never episode_id, scene or sequence numbers, status or
--                   media urls
--   dialogue_lines  text, speaker (character_asset_id), status (a voiced
--                   line goes back to pending) and origin; never episode_id,
--                   sequence numbers, language or audio
--
-- Every row an update touches is still checked to be the run's episode
-- (kit.check_generation_commit_scope), and the snapshot already covers
-- shots and dialogue_lines whenever a plan writes them.

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
                 "metadata", "target_duration_seconds", "updated_at", "generation_origin"]},
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
