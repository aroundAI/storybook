/*
 * -------------------------------------------------------
 * Section: Update Project Cover Image Function
 * SECURITY DEFINER function to update cover image in project metadata
 * Bypasses RLS to avoid infinite recursion in policy chain
 * -------------------------------------------------------
 */

CREATE OR REPLACE FUNCTION update_project_cover_image(
  p_project_id uuid,
  p_cover_image_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.projects
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('coverImageUrl', p_cover_image_url),
      updated_at = NOW()
  WHERE id = p_project_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_project_cover_image(uuid, text) TO authenticated;
