-- Migration: Add atomic commit_canon_changes function
-- This function wraps the canon commit operations in a transaction to ensure atomicity
-- If any operation fails, all changes are rolled back

CREATE OR REPLACE FUNCTION commit_canon_changes(
    p_project_id UUID,
    p_episode_id UUID,
    p_season INTEGER,
    p_episode_number INTEGER,
    p_events JSONB,  -- Array of immutable events to insert
    p_episode_summary TEXT,
    p_sentiment_score NUMERIC(3,2)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_events_created INTEGER := 0;
    v_existing_metadata JSONB;
    v_new_metadata JSONB;
    v_event JSONB;
BEGIN
    -- Insert immutable events if provided
    IF jsonb_array_length(COALESCE(p_events, '[]'::jsonb)) > 0 THEN
        INSERT INTO immutable_events (
            project_id,
            event_type,
            event_key,
            description,
            established_in,
            season,
            episode_number
        )
        SELECT
            p_project_id,
            (event_obj->>'type')::text,
            (event_obj->>'eventKey')::text,
            (event_obj->>'description')::text,
            p_episode_id,
            p_season,
            p_episode_number
        FROM jsonb_array_elements(p_events) AS event_obj;
        
        GET DIAGNOSTICS v_events_created = ROW_COUNT;
    END IF;

    -- Fetch existing metadata
    SELECT metadata INTO v_existing_metadata
    FROM episodes
    WHERE id = p_episode_id;

    -- Merge new metadata with existing
    v_new_metadata := COALESCE(v_existing_metadata, '{}'::jsonb) || jsonb_build_object(
        'canonSummary', p_episode_summary,
        'sentimentScore', p_sentiment_score
    );

    -- Update episode metadata
    UPDATE episodes
    SET metadata = v_new_metadata
    WHERE id = p_episode_id;

    -- Return results
    RETURN jsonb_build_object(
        'eventsCreated', v_events_created,
        'summaryStored', true
    );
EXCEPTION
    WHEN OTHERS THEN
        -- Transaction will be rolled back automatically
        RAISE EXCEPTION 'commit_canon_changes failed: %', SQLERRM;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION commit_canon_changes TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION commit_canon_changes IS 'Atomically commits canon changes (immutable events + episode metadata) in a single transaction';
