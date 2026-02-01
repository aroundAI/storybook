-- Fix RLS policies for episodes and shots to ensure account owners can update/delete
-- Currently typical READ policies used 'primary_owner_user_id' check but WRITE policies relied solely on 'project_members'
-- This caused issues for Personal Accounts if the owner wasn't correctly in project_members

-- Episode Update Policy
DROP POLICY IF EXISTS "episodes_update" ON public.episodes;
CREATE POLICY "episodes_update" ON public.episodes FOR UPDATE
  TO authenticated USING (
    EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = episodes.project_id
        AND (
            -- Allow Account Owner
            EXISTS (
                SELECT 1 FROM public.accounts a
                WHERE a.id = p.account_id
                AND a.primary_owner_user_id = auth.uid()
                AND a.is_personal_account = true
            )
            OR
            -- Allow Project Members
            EXISTS (
                SELECT 1 FROM public.project_members pm
                WHERE pm.project_id = p.id
                AND pm.user_id = auth.uid()
                AND pm.role IN ('owner', 'admin', 'member')
            )
        )
    )
  );

-- Episode Delete Policy
DROP POLICY IF EXISTS "episodes_delete" ON public.episodes;
CREATE POLICY "episodes_delete" ON public.episodes FOR DELETE
  TO authenticated USING (
    EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = episodes.project_id
        AND (
            -- Allow Account Owner
            EXISTS (
                SELECT 1 FROM public.accounts a
                WHERE a.id = p.account_id
                AND a.primary_owner_user_id = auth.uid()
                AND a.is_personal_account = true
            )
            OR
            -- Allow Project Admins/Owners only
            EXISTS (
                SELECT 1 FROM public.project_members pm
                WHERE pm.project_id = p.id
                AND pm.user_id = auth.uid()
                AND pm.role IN ('owner', 'admin')
            )
        )
    )
  );

-- Shots Delete Policy
DROP POLICY IF EXISTS "shots_delete" ON public.shots;
CREATE POLICY "shots_delete" ON public.shots FOR DELETE
  TO authenticated USING (
    EXISTS (
        SELECT 1 FROM public.episodes e
        JOIN public.projects p ON p.id = e.project_id
        WHERE e.id = shots.episode_id
        AND (
            -- Allow Account Owner
            EXISTS (
                SELECT 1 FROM public.accounts a
                WHERE a.id = p.account_id
                AND a.primary_owner_user_id = auth.uid()
                AND a.is_personal_account = true
            )
            OR
            -- Allow Project Admins/Owners only
            EXISTS (
                SELECT 1 FROM public.project_members pm
                WHERE pm.project_id = p.id
                AND pm.user_id = auth.uid()
                AND pm.role IN ('owner', 'admin')
            )
        )
    )
  );
