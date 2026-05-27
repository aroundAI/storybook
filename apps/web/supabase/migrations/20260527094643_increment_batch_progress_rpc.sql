-- Atomic batch progress tracking RPC function
-- Used by the voice worker Lambda to safely increment batch counters
-- when multiple Lambda instances finish concurrently.
--
-- Returns is_complete: true when all lines have been processed,
-- allowing the last worker to send a WebSocket completion notification.

CREATE OR REPLACE FUNCTION increment_batch_progress(
  p_batch_job_id UUID,
  p_status TEXT,        -- 'completed' or 'failed'
  p_cost NUMERIC DEFAULT 0,
  p_error JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_total INT;
  v_completed INT;
  v_failed INT;
  v_is_complete BOOLEAN;
  v_final_status TEXT;
BEGIN
  -- Atomic increment with row-level lock (FOR UPDATE via UPDATE ... RETURNING)
  IF p_status = 'completed' THEN
    UPDATE batch_generation_jobs
    SET completed_lines = completed_lines + 1,
        actual_cost = actual_cost + p_cost
    WHERE id = p_batch_job_id
    RETURNING total_lines, completed_lines, failed_lines
    INTO v_total, v_completed, v_failed;
  ELSIF p_status = 'failed' THEN
    UPDATE batch_generation_jobs
    SET failed_lines = failed_lines + 1,
        errors = CASE
          WHEN p_error IS NOT NULL THEN
            COALESCE(errors, '[]'::jsonb) || jsonb_build_array(p_error)
          ELSE errors
        END
    WHERE id = p_batch_job_id
    RETURNING total_lines, completed_lines, failed_lines
    INTO v_total, v_completed, v_failed;
  ELSE
    RAISE EXCEPTION 'Invalid status: %. Must be completed or failed.', p_status;
  END IF;

  -- If job wasn't found, return null indicator
  IF v_total IS NULL THEN
    RETURN jsonb_build_object(
      'is_complete', false,
      'error', 'Batch job not found'
    );
  END IF;

  -- Check if batch is complete (all lines processed)
  v_is_complete := (v_completed + v_failed) >= v_total;

  IF v_is_complete THEN
    -- Determine final status based on results
    v_final_status := CASE
      WHEN v_failed = v_total THEN 'failed'
      WHEN v_failed > 0 THEN 'completed_with_errors'
      ELSE 'completed'
    END;

    UPDATE batch_generation_jobs
    SET status = v_final_status,
        completed_at = NOW()
    WHERE id = p_batch_job_id;
  END IF;

  RETURN jsonb_build_object(
    'is_complete', v_is_complete,
    'completed', v_completed,
    'failed', v_failed,
    'total', v_total,
    'final_status', COALESCE(v_final_status, 'processing')
  );
END;
$$ LANGUAGE plpgsql;
