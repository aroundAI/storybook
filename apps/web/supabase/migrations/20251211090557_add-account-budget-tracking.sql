-- Migration: Add budget tracking columns to accounts table
-- Purpose: Enable generation cost tracking and budget limits for FILM-502

-- Add budget columns to accounts table
ALTER TABLE public.accounts
ADD COLUMN IF NOT EXISTS monthly_budget_cents INTEGER DEFAULT NULL,
ADD COLUMN IF NOT EXISTS current_usage_cents INTEGER DEFAULT 0 NOT NULL;

COMMENT ON COLUMN public.accounts.monthly_budget_cents IS 'Monthly budget limit in cents. NULL means unlimited.';
COMMENT ON COLUMN public.accounts.current_usage_cents IS 'Current month usage in cents. Reset monthly.';

-- Function to increment account usage
-- Used by voice/music generation actions to track costs
CREATE OR REPLACE FUNCTION public.increment_account_usage(
  p_account_id UUID,
  p_amount_cents INTEGER
)
RETURNS TABLE (
  new_usage_cents INTEGER,
  budget_cents INTEGER,
  is_over_budget BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new_usage INTEGER;
  v_budget INTEGER;
BEGIN
  -- Atomically increment usage and get new value
  UPDATE public.accounts
  SET current_usage_cents = current_usage_cents + p_amount_cents,
      updated_at = NOW()
  WHERE id = p_account_id
  RETURNING current_usage_cents, monthly_budget_cents
  INTO v_new_usage, v_budget;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found: %', p_account_id;
  END IF;

  RETURN QUERY SELECT
    v_new_usage,
    v_budget,
    CASE
      WHEN v_budget IS NULL THEN FALSE
      ELSE v_new_usage > v_budget
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_account_usage(UUID, INTEGER) TO service_role;

-- Function to check if account has budget remaining
-- Returns TRUE if generation can proceed, FALSE if over budget
CREATE OR REPLACE FUNCTION public.check_account_budget(
  p_account_id UUID,
  p_estimated_cost_cents INTEGER DEFAULT 0
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_usage INTEGER;
  v_budget INTEGER;
BEGIN
  SELECT current_usage_cents, monthly_budget_cents
  INTO v_current_usage, v_budget
  FROM public.accounts
  WHERE id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found: %', p_account_id;
  END IF;

  -- No budget limit set = unlimited
  IF v_budget IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Check if current usage + estimated cost would exceed budget
  RETURN (v_current_usage + p_estimated_cost_cents) <= v_budget;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_account_budget(UUID, INTEGER) TO authenticated, service_role;

-- Function to reset monthly usage (to be called by a cron job)
CREATE OR REPLACE FUNCTION public.reset_monthly_usage()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF current_user NOT IN ('service_role') THEN
    RAISE EXCEPTION 'Only service_role can reset monthly usage';
  END IF;

  UPDATE public.accounts
  SET current_usage_cents = 0,
      updated_at = NOW()
  WHERE current_usage_cents > 0;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_monthly_usage() TO service_role;
