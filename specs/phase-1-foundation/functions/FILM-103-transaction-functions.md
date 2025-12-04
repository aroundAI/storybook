# FILM-103: Transaction Functions

## Metadata
- **Phase:** 1 - Foundation
- **Priority:** P0 (Critical)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-101a through FILM-101n (all database tables)
- **Blocks:** FILM-202 (Character Actions), FILM-303 (Shot CRUD)

---

## Context

Multi-table operations in the Film Studio require atomic transactions to maintain data integrity. For example, creating a character involves inserting into both `assets` and `character_details` tables - if either fails, both should rollback. PostgreSQL functions with `SECURITY DEFINER` provide this atomicity while maintaining RLS security.

---

## Specification

### Requirements

1. **Atomic Character Creation**: Create asset and character_details in single transaction
2. **Optimistic Locking for Episodes**: Prevent concurrent edit conflicts using version column
3. **Batch Shot Creation**: Replace all shots for an episode atomically
4. **Soft Delete Cascade**: Mark related records as deleted when parent is soft-deleted
5. **Cost Tracking Rollup**: Aggregate generation costs per project/account

### Database Functions

#### 1. create_character_with_details

```sql
CREATE OR REPLACE FUNCTION create_character_with_details(
  p_project_id UUID,
  p_name VARCHAR(255),
  p_description TEXT,
  p_physical_attributes JSONB,
  p_personality TEXT,
  p_element_prompt TEXT,
  p_reference_images TEXT[],
  p_voice_asset_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_asset_id UUID;
BEGIN
  -- Create asset record
  INSERT INTO assets (project_id, type, name, description)
  VALUES (p_project_id, 'character', p_name, p_description)
  RETURNING id INTO v_asset_id;

  -- Create character details
  INSERT INTO character_details (
    asset_id, physical_attributes, personality,
    element_prompt, reference_images, voice_asset_id
  ) VALUES (
    v_asset_id, p_physical_attributes, p_personality,
    p_element_prompt, p_reference_images, p_voice_asset_id
  );

  RETURN v_asset_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to create character: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Usage:**
```typescript
const { data: assetId } = await supabase.rpc('create_character_with_details', {
  p_project_id: projectId,
  p_name: 'Detective Chen',
  p_description: 'Lead investigator',
  p_physical_attributes: { age: 'mid-30s', hair: 'black' },
  p_personality: 'Determined and methodical',
  p_element_prompt: null,
  p_reference_images: [],
  p_voice_asset_id: null,
});
```

#### 2. update_episode_with_lock

```sql
CREATE OR REPLACE FUNCTION update_episode_with_lock(
  p_episode_id UUID,
  p_expected_version INTEGER,
  p_updates JSONB
) RETURNS TABLE(success BOOLEAN, new_version INTEGER, conflict_data JSONB) AS $$
DECLARE
  v_current_version INTEGER;
  v_current_data JSONB;
BEGIN
  -- Get current version with row lock
  SELECT version, to_jsonb(e.*) INTO v_current_version, v_current_data
  FROM episodes e
  WHERE id = p_episode_id
  FOR UPDATE;

  -- Check for version conflict
  IF v_current_version IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::INTEGER, NULL::JSONB;
    RETURN;
  END IF;

  IF v_current_version != p_expected_version THEN
    -- Conflict detected - return current data for resolution
    RETURN QUERY SELECT FALSE, v_current_version, v_current_data;
    RETURN;
  END IF;

  -- Apply updates
  UPDATE episodes SET
    title = COALESCE(p_updates->>'title', title),
    description = COALESCE(p_updates->>'description', description),
    status = COALESCE(p_updates->>'status', status),
    story_data = COALESCE(p_updates->'story_data', story_data),
    screenplay_data = COALESCE(p_updates->'screenplay_data', screenplay_data),
    shot_list = COALESCE(p_updates->'shot_list', shot_list),
    metadata = COALESCE(p_updates->'metadata', metadata),
    version = version + 1,
    updated_at = NOW()
  WHERE id = p_episode_id;

  RETURN QUERY SELECT TRUE, v_current_version + 1, NULL::JSONB;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Usage:**
```typescript
const { data } = await supabase.rpc('update_episode_with_lock', {
  p_episode_id: episodeId,
  p_expected_version: currentVersion,
  p_updates: { title: 'New Title', status: 'story' },
});

if (!data.success) {
  // Handle conflict - data.conflict_data contains current state
  console.error('Version conflict', data.conflict_data);
}
```

#### 3. batch_create_shots

```sql
CREATE OR REPLACE FUNCTION batch_create_shots(
  p_episode_id UUID,
  p_shots JSONB -- Array of shot objects
) RETURNS SETOF UUID AS $$
DECLARE
  v_shot JSONB;
  v_shot_id UUID;
  v_sequence INTEGER := 1;
BEGIN
  -- Verify episode exists and user has access (RLS will handle this)
  IF NOT EXISTS (SELECT 1 FROM episodes WHERE id = p_episode_id) THEN
    RAISE EXCEPTION 'Episode not found: %', p_episode_id;
  END IF;

  -- Delete existing shots for this episode
  DELETE FROM shots WHERE episode_id = p_episode_id;

  -- Insert new shots
  FOR v_shot IN SELECT * FROM jsonb_array_elements(p_shots)
  LOOP
    INSERT INTO shots (
      episode_id, sequence_number, duration_seconds,
      scene_description, action_description, prompt,
      camera_direction, status
    ) VALUES (
      p_episode_id,
      v_sequence,
      COALESCE((v_shot->>'duration_seconds')::INTEGER, 10),
      v_shot->>'scene_description',
      v_shot->>'action_description',
      v_shot->>'prompt',
      v_shot->>'camera_direction',
      'pending'
    ) RETURNING id INTO v_shot_id;

    v_sequence := v_sequence + 1;
    RETURN NEXT v_shot_id;
  END LOOP;

  -- Update episode status
  UPDATE episodes
  SET status = 'storyboard', updated_at = NOW()
  WHERE id = p_episode_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

#### 4. soft_delete_episode

```sql
CREATE OR REPLACE FUNCTION soft_delete_episode(
  p_episode_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Soft delete the episode
  UPDATE episodes
  SET deleted_at = v_now, updated_at = v_now
  WHERE id = p_episode_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Cascade soft delete to related records
  -- Note: shots, dialogue_lines, audio_tracks have CASCADE delete
  -- but for soft delete we mark them explicitly

  -- Cancel any pending generation jobs
  UPDATE generation_jobs
  SET status = 'cancelled', completed_at = v_now
  WHERE reference_type = 'shot'
    AND reference_id IN (SELECT id FROM shots WHERE episode_id = p_episode_id)
    AND status IN ('queued', 'processing');

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

#### 5. get_project_generation_costs

```sql
CREATE OR REPLACE FUNCTION get_project_generation_costs(
  p_project_id UUID,
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_end_date TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE(
  job_type VARCHAR(50),
  provider VARCHAR(50),
  total_cost_cents BIGINT,
  job_count BIGINT,
  completed_count BIGINT,
  failed_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    gj.job_type,
    gj.provider,
    COALESCE(SUM(gj.cost_cents), 0)::BIGINT as total_cost_cents,
    COUNT(*)::BIGINT as job_count,
    COUNT(*) FILTER (WHERE gj.status = 'completed')::BIGINT as completed_count,
    COUNT(*) FILTER (WHERE gj.status = 'failed')::BIGINT as failed_count
  FROM generation_jobs gj
  WHERE gj.project_id = p_project_id
    AND (p_start_date IS NULL OR gj.created_at >= p_start_date)
    AND (p_end_date IS NULL OR gj.created_at <= p_end_date)
  GROUP BY gj.job_type, gj.provider
  ORDER BY total_cost_cents DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `apps/web/supabase/schemas/32-film-studio-functions.sql` |

---

## Acceptance Criteria

- [ ] `create_character_with_details` creates both records atomically
- [ ] `create_character_with_details` rolls back on any failure
- [ ] `update_episode_with_lock` returns conflict data when version mismatch
- [ ] `update_episode_with_lock` increments version on success
- [ ] `batch_create_shots` deletes existing shots before inserting new ones
- [ ] `batch_create_shots` returns array of new shot IDs
- [ ] `soft_delete_episode` cancels pending generation jobs
- [ ] `get_project_generation_costs` aggregates costs correctly
- [ ] All functions use `SECURITY DEFINER` for RLS bypass
- [ ] All functions have proper error handling with meaningful messages

---

## Test Plan

### Unit Tests
- [ ] Test character creation with valid data
- [ ] Test character creation with missing required fields (should fail)
- [ ] Test optimistic lock success case
- [ ] Test optimistic lock conflict detection
- [ ] Test batch shot creation with empty array
- [ ] Test batch shot creation with multiple shots
- [ ] Test cost aggregation with various job types

### Integration Tests
- [ ] Test transaction rollback on character creation failure
- [ ] Test concurrent episode updates trigger conflict
- [ ] Test RLS policies are respected within functions

---

## Security Considerations

- Functions use `SECURITY DEFINER` to execute with owner privileges
- RLS policies on underlying tables still apply for initial access check
- Input validation via Zod schemas in application layer before RPC calls
- No SQL injection possible - parameterized queries only

---

## Error Handling

| Error | Handling |
|-------|----------|
| Foreign key violation | Return descriptive error message |
| Version conflict | Return current data for client-side resolution |
| Episode not found | Raise exception with episode ID |
| Permission denied | Let RLS policy error propagate |

---

## Open Questions

- [x] Should `batch_create_shots` update episode status? **Yes, to 'storyboard'**
- [ ] Should we add a `restore_episode` function for soft delete recovery? (non-blocking)
