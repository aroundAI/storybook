-- RLS Policies for Public Sharing
-- This migration adds Row Level Security policies to allow public read access
-- to accounts, projects, and episodes based on visibility settings.

-- Enable RLS on tables if not already enabled
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.episodes ENABLE ROW LEVEL SECURITY;

-- ============================================
-- ACCOUNTS: Public Profile Access
-- ============================================

-- Allow public read of accounts with is_public = true in public_profile
CREATE POLICY "Allow public read of public accounts"
ON public.accounts
FOR SELECT
TO anon, authenticated
USING (
    (public_profile->>'is_public')::boolean = true
);

-- ============================================
-- PROJECTS: Public/Unlisted Access
-- ============================================

-- Allow public read of projects with visibility = 'public' or 'unlisted'
CREATE POLICY "Allow public read of public/unlisted projects"
ON public.projects
FOR SELECT
TO anon, authenticated
USING (
    visibility IN ('public', 'unlisted')
);

-- ============================================
-- EPISODES: Public/Unlisted/Inherit Access
-- ============================================

-- Allow public read of episodes based on visibility
-- - 'public' or 'unlisted': directly accessible
-- - 'inherit': accessible if parent project is public/unlisted
CREATE POLICY "Allow public read of public/unlisted/inherit episodes"
ON public.episodes
FOR SELECT
TO anon, authenticated
USING (
    (
        -- Direct visibility
        visibility IN ('public', 'unlisted')
        -- OR inherit from project
        OR (
            visibility = 'inherit'
            AND EXISTS (
                SELECT 1 FROM public.projects p
                WHERE p.id = project_id
                AND p.visibility IN ('public', 'unlisted')
            )
        )
    )
);

-- ============================================
-- NOTES
-- ============================================
-- These policies allow anonymous (anon) and authenticated users to read public content.
-- Existing policies for authenticated team members should still allow full CRUD access.
-- Make sure existing policies don't conflict with these new public access policies.
