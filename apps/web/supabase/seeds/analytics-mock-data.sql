-- ==================================
-- Analytics Mock Data Seed
-- ==================================
-- Comprehensive mock data for testing the analytics dashboard
-- Creates a new project with 3 seasons, 20 episodes, 45 publishes, and ~400 analytics records
--
-- Run with: psql postgres://postgres:postgres@127.0.0.1:55322/postgres -f apps/web/supabase/seeds/analytics-mock-data.sql

-- ==================================
-- Configuration
-- ==================================
-- Account: storybook (5deaa894-2094-4da3-b4fd-1fada0809d1c)
-- User: test@storybook.dev (31a03e74-1639-45b6-bfa7-77447f1a4762)
-- New Project ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890

-- ==================================
-- Section 1: Project
-- ==================================

-- Temporarily disable triggers for project creation
ALTER TABLE public.projects DISABLE TRIGGER add_project_owner;
ALTER TABLE public.projects DISABLE TRIGGER projects_set_user_tracking;

INSERT INTO public.projects (id, account_id, name, description, slug, status, created_by, updated_by, created_at, updated_at, metadata)
VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  '5deaa894-2094-4da3-b4fd-1fada0809d1c',
  'The Chronicles',
  'An epic animated fantasy series following heroes across three realms',
  'the-chronicles',
  'active',
  '31a03e74-1639-45b6-bfa7-77447f1a4762',
  '31a03e74-1639-45b6-bfa7-77447f1a4762',
  NOW(),
  NOW(),
  '{"genre": "fantasy", "format": "animated_series"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Re-enable triggers
ALTER TABLE public.projects ENABLE TRIGGER add_project_owner;
ALTER TABLE public.projects ENABLE TRIGGER projects_set_user_tracking;

-- Manually add project membership (since we disabled the trigger)
INSERT INTO public.project_members (project_id, user_id, role, created_at, updated_at)
VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  '31a03e74-1639-45b6-bfa7-77447f1a4762',
  'owner',
  NOW(),
  NOW()
)
ON CONFLICT (project_id, user_id) DO NOTHING;

-- ==================================
-- Section 2: Seasons
-- ==================================

-- Season 1: The Awakening (8 episodes)
INSERT INTO public.seasons (id, project_id, number, name, description)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  1,
  'The Awakening',
  'Our heroes discover their powers and the threat that looms over their world'
)
ON CONFLICT DO NOTHING;

-- Season 2: Rising Shadows (7 episodes)
INSERT INTO public.seasons (id, project_id, number, name, description)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  2,
  'Rising Shadows',
  'The darkness spreads as alliances are tested and secrets revealed'
)
ON CONFLICT DO NOTHING;

-- Season 3: The Reckoning (5 episodes)
INSERT INTO public.seasons (id, project_id, number, name, description)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  3,
  'The Reckoning',
  'The final battle approaches - will light prevail over darkness?'
)
ON CONFLICT DO NOTHING;

-- ==================================
-- Section 3: Episodes
-- ==================================

-- Season 1 Episodes (8)
INSERT INTO public.episodes (id, project_id, season_id, number, title, description, status, duration_seconds, thumbnail_url) VALUES
('e1010101-0101-0101-0101-010101010101', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '11111111-1111-1111-1111-111111111111', 1, 'The Beginning', 'A mysterious event awakens dormant powers in three unlikely heroes', 'published', 1440, 'https://picsum.photos/seed/ep1/1280/720'),
('e1020202-0202-0202-0202-020202020202', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '11111111-1111-1111-1111-111111111111', 2, 'First Steps', 'Our heroes meet for the first time and must learn to work together', 'published', 1380, 'https://picsum.photos/seed/ep2/1280/720'),
('e1030303-0303-0303-0303-030303030303', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '11111111-1111-1111-1111-111111111111', 3, 'The Ancient Temple', 'A journey to the temple reveals shocking truths about their destiny', 'published', 1520, 'https://picsum.photos/seed/ep3/1280/720'),
('e1040404-0404-0404-0404-040404040404', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '11111111-1111-1111-1111-111111111111', 4, 'Shadows Emerge', 'The first signs of the coming darkness appear on the horizon', 'published', 1460, 'https://picsum.photos/seed/ep4/1280/720'),
('e1050505-0505-0505-0505-050505050505', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '11111111-1111-1111-1111-111111111111', 5, 'Trial by Fire', 'A dangerous trial tests the limits of their newfound abilities', 'published', 1500, 'https://picsum.photos/seed/ep5/1280/720'),
('e1060606-0606-0606-0606-060606060606', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '11111111-1111-1111-1111-111111111111', 6, 'Unlikely Allies', 'An unexpected encounter leads to a fragile alliance', 'published', 1420, 'https://picsum.photos/seed/ep6/1280/720'),
('e1070707-0707-0707-0707-070707070707', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '11111111-1111-1111-1111-111111111111', 7, 'The Prophecy', 'Ancient writings reveal the true nature of the threat they face', 'published', 1550, 'https://picsum.photos/seed/ep7/1280/720'),
('e1080808-0808-0808-0808-080808080808', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '11111111-1111-1111-1111-111111111111', 8, 'Season Finale: Awakened', 'The heroes fully embrace their powers as the real journey begins', 'published', 1800, 'https://picsum.photos/seed/ep8/1280/720')
ON CONFLICT (id) DO NOTHING;

-- Season 2 Episodes (7)
INSERT INTO public.episodes (id, project_id, season_id, number, title, description, status, duration_seconds, thumbnail_url) VALUES
('e2010101-0101-0101-0101-010101010101', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '22222222-2222-2222-2222-222222222222', 9, 'Dark Horizons', 'The shadow realm begins to bleed into the mortal world', 'published', 1480, 'https://picsum.photos/seed/ep9/1280/720'),
('e2020202-0202-0202-0202-020202020202', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '22222222-2222-2222-2222-222222222222', 10, 'Betrayal', 'A trusted ally reveals their true allegiance', 'published', 1520, 'https://picsum.photos/seed/ep10/1280/720'),
('e2030303-0303-0303-0303-030303030303', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '22222222-2222-2222-2222-222222222222', 11, 'The Lost City', 'An expedition to a forgotten city uncovers powerful artifacts', 'published', 1560, 'https://picsum.photos/seed/ep11/1280/720'),
('e2040404-0404-0404-0404-040404040404', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '22222222-2222-2222-2222-222222222222', 12, 'Bonds Tested', 'Internal conflict threatens to tear the team apart', 'published', 1440, 'https://picsum.photos/seed/ep12/1280/720'),
('e2050505-0505-0505-0505-050505050505', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '22222222-2222-2222-2222-222222222222', 13, 'The Shadow King', 'The main antagonist is finally revealed in all their terrifying glory', 'published', 1600, 'https://picsum.photos/seed/ep13/1280/720'),
('e2060606-0606-0606-0606-060606060606', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '22222222-2222-2222-2222-222222222222', 14, 'Sacrifice', 'A devastating loss changes everything', 'published', 1500, 'https://picsum.photos/seed/ep14/1280/720'),
('e2070707-0707-0707-0707-070707070707', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '22222222-2222-2222-2222-222222222222', 15, 'Season Finale: Rising', 'Against all odds, hope is rekindled as the heroes prepare for war', 'published', 1850, 'https://picsum.photos/seed/ep15/1280/720')
ON CONFLICT (id) DO NOTHING;

-- Season 3 Episodes (5)
INSERT INTO public.episodes (id, project_id, season_id, number, title, description, status, duration_seconds, thumbnail_url) VALUES
('e3010101-0101-0101-0101-010101010101', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '33333333-3333-3333-3333-333333333333', 16, 'The Gathering Storm', 'Forces assemble for the final confrontation', 'published', 1520, 'https://picsum.photos/seed/ep16/1280/720'),
('e3020202-0202-0202-0202-020202020202', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '33333333-3333-3333-3333-333333333333', 17, 'Into the Darkness', 'The heroes infiltrate the shadow realm', 'published', 1580, 'https://picsum.photos/seed/ep17/1280/720'),
('e3030303-0303-0303-0303-030303030303', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '33333333-3333-3333-3333-333333333333', 18, 'Last Stand', 'The final battle begins with everything at stake', 'published', 1650, 'https://picsum.photos/seed/ep18/1280/720'),
('e3040404-0404-0404-0404-040404040404', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '33333333-3333-3333-3333-333333333333', 19, 'Breaking Point', 'The tide of battle shifts dramatically', 'ready', 1700, 'https://picsum.photos/seed/ep19/1280/720'),
('e3050505-0505-0505-0505-050505050505', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', '33333333-3333-3333-3333-333333333333', 20, 'Series Finale: Dawn', 'The epic conclusion to The Chronicles', 'ready', 2100, 'https://picsum.photos/seed/ep20/1280/720')
ON CONFLICT (id) DO NOTHING;

-- ==================================
-- Section 4: Publishes
-- ==================================
-- Each published episode gets 2-3 platform publishes
-- Note: Using valid hex-only UUIDs

-- Season 1 Publishes
INSERT INTO public.publishes (id, episode_id, platform, content_type, title, description, status, published_at, thumbnail_url, platform_content_id) VALUES
-- Episode 1
('a1010101-0101-0101-0101-010101010101', 'e1010101-0101-0101-0101-010101010101', 'youtube', 'full', 'The Chronicles S1E1: The Beginning', 'Watch the premiere episode of The Chronicles!', 'published', NOW() - INTERVAL '90 days', 'https://picsum.photos/seed/ep1yt/1280/720', 'yt_chronicles_s1e1'),
('a1010102-0101-0101-0101-010101010101', 'e1010101-0101-0101-0101-010101010101', 'tiktok', 'short', 'The Chronicles: Hero Awakens #anime #fantasy', 'Epic moment from The Chronicles premiere!', 'published', NOW() - INTERVAL '89 days', 'https://picsum.photos/seed/ep1tt/1080/1920', 'tt_chronicles_s1e1'),
('a1010103-0101-0101-0101-010101010101', 'e1010101-0101-0101-0101-010101010101', 'instagram', 'short', 'The Beginning - Epic Scene', 'When destiny calls...', 'published', NOW() - INTERVAL '88 days', 'https://picsum.photos/seed/ep1ig/1080/1920', 'ig_chronicles_s1e1'),
-- Episode 2
('a1020201-0202-0202-0202-020202020202', 'e1020202-0202-0202-0202-020202020202', 'youtube', 'full', 'The Chronicles S1E2: First Steps', 'The heroes meet for the first time!', 'published', NOW() - INTERVAL '83 days', 'https://picsum.photos/seed/ep2yt/1280/720', 'yt_chronicles_s1e2'),
('a1020202-0202-0202-0202-020202020202', 'e1020202-0202-0202-0202-020202020202', 'tiktok', 'short', 'Team Up Moment #TheChronicles', 'When the squad finally meets!', 'published', NOW() - INTERVAL '82 days', 'https://picsum.photos/seed/ep2tt/1080/1920', 'tt_chronicles_s1e2'),
-- Episode 3
('a1030301-0303-0303-0303-030303030303', 'e1030303-0303-0303-0303-030303030303', 'youtube', 'full', 'The Chronicles S1E3: The Ancient Temple', 'Secrets of the past revealed!', 'published', NOW() - INTERVAL '76 days', 'https://picsum.photos/seed/ep3yt/1280/720', 'yt_chronicles_s1e3'),
('a1030302-0303-0303-0303-030303030303', 'e1030303-0303-0303-0303-030303030303', 'tiktok', 'short', 'Temple Discovery Scene', 'The plot thickens...', 'published', NOW() - INTERVAL '75 days', 'https://picsum.photos/seed/ep3tt/1080/1920', 'tt_chronicles_s1e3'),
('a1030303-0303-0303-0303-030303030303', 'e1030303-0303-0303-0303-030303030303', 'instagram', 'short', 'Ancient Secrets Revealed', 'Watch til the end!', 'published', NOW() - INTERVAL '74 days', 'https://picsum.photos/seed/ep3ig/1080/1920', 'ig_chronicles_s1e3'),
-- Episode 4
('a1040401-0404-0404-0404-040404040404', 'e1040404-0404-0404-0404-040404040404', 'youtube', 'full', 'The Chronicles S1E4: Shadows Emerge', 'Darkness approaches...', 'published', NOW() - INTERVAL '69 days', 'https://picsum.photos/seed/ep4yt/1280/720', 'yt_chronicles_s1e4'),
('a1040402-0404-0404-0404-040404040404', 'e1040404-0404-0404-0404-040404040404', 'tiktok', 'short', 'First Shadow Appearance', 'Things are about to get dark', 'published', NOW() - INTERVAL '68 days', 'https://picsum.photos/seed/ep4tt/1080/1920', 'tt_chronicles_s1e4'),
-- Episode 5
('a1050501-0505-0505-0505-050505050505', 'e1050505-0505-0505-0505-050505050505', 'youtube', 'full', 'The Chronicles S1E5: Trial by Fire', 'The ultimate test!', 'published', NOW() - INTERVAL '62 days', 'https://picsum.photos/seed/ep5yt/1280/720', 'yt_chronicles_s1e5'),
('a1050502-0505-0505-0505-050505050505', 'e1050505-0505-0505-0505-050505050505', 'tiktok', 'short', 'Fire Trial Battle Scene', 'This fight was INSANE', 'published', NOW() - INTERVAL '61 days', 'https://picsum.photos/seed/ep5tt/1080/1920', 'tt_chronicles_s1e5'),
('a1050503-0505-0505-0505-050505050505', 'e1050505-0505-0505-0505-050505050505', 'instagram', 'short', 'Trial by Fire Highlight', 'Who survived? Watch to find out!', 'published', NOW() - INTERVAL '60 days', 'https://picsum.photos/seed/ep5ig/1080/1920', 'ig_chronicles_s1e5'),
-- Episode 6
('a1060601-0606-0606-0606-060606060606', 'e1060606-0606-0606-0606-060606060606', 'youtube', 'full', 'The Chronicles S1E6: Unlikely Allies', 'New friends, new dangers', 'published', NOW() - INTERVAL '55 days', 'https://picsum.photos/seed/ep6yt/1280/720', 'yt_chronicles_s1e6'),
('a1060602-0606-0606-0606-060606060606', 'e1060606-0606-0606-0606-060606060606', 'tiktok', 'short', 'New Alliance Reveal', 'You wont believe who joins!', 'published', NOW() - INTERVAL '54 days', 'https://picsum.photos/seed/ep6tt/1080/1920', 'tt_chronicles_s1e6'),
-- Episode 7
('a1070701-0707-0707-0707-070707070707', 'e1070707-0707-0707-0707-070707070707', 'youtube', 'full', 'The Chronicles S1E7: The Prophecy', 'The truth is finally revealed!', 'published', NOW() - INTERVAL '48 days', 'https://picsum.photos/seed/ep7yt/1280/720', 'yt_chronicles_s1e7'),
('a1070702-0707-0707-0707-070707070707', 'e1070707-0707-0707-0707-070707070707', 'tiktok', 'short', 'Prophecy Reading Scene', 'Mind = Blown', 'published', NOW() - INTERVAL '47 days', 'https://picsum.photos/seed/ep7tt/1080/1920', 'tt_chronicles_s1e7'),
('a1070703-0707-0707-0707-070707070707', 'e1070707-0707-0707-0707-070707070707', 'instagram', 'short', 'The Prophecy Revealed', 'Everything changes now...', 'published', NOW() - INTERVAL '46 days', 'https://picsum.photos/seed/ep7ig/1080/1920', 'ig_chronicles_s1e7'),
-- Episode 8 (Season Finale)
('a1080801-0808-0808-0808-080808080808', 'e1080808-0808-0808-0808-080808080808', 'youtube', 'full', 'The Chronicles S1E8: Season Finale - Awakened', 'The epic Season 1 finale!', 'published', NOW() - INTERVAL '41 days', 'https://picsum.photos/seed/ep8yt/1280/720', 'yt_chronicles_s1e8'),
('a1080802-0808-0808-0808-080808080808', 'e1080808-0808-0808-0808-080808080808', 'tiktok', 'short', 'S1 Finale Epic Moment', 'Season 1 finale hits different', 'published', NOW() - INTERVAL '40 days', 'https://picsum.photos/seed/ep8tt/1080/1920', 'tt_chronicles_s1e8'),
('a1080803-0808-0808-0808-080808080808', 'e1080808-0808-0808-0808-080808080808', 'instagram', 'short', 'Awakened - Final Scene', 'Season 2 when?!', 'published', NOW() - INTERVAL '39 days', 'https://picsum.photos/seed/ep8ig/1080/1920', 'ig_chronicles_s1e8')
ON CONFLICT (id) DO NOTHING;

-- Season 2 Publishes
INSERT INTO public.publishes (id, episode_id, platform, content_type, title, description, status, published_at, thumbnail_url, platform_content_id) VALUES
-- Episode 1
('a2010101-0101-0101-0101-010101010101', 'e2010101-0101-0101-0101-010101010101', 'youtube', 'full', 'The Chronicles S2E1: Dark Horizons', 'Season 2 premiere is here!', 'published', NOW() - INTERVAL '34 days', 'https://picsum.photos/seed/ep9yt/1280/720', 'yt_chronicles_s2e1'),
('a2010102-0101-0101-0101-010101010101', 'e2010101-0101-0101-0101-010101010101', 'tiktok', 'short', 'Season 2 Opening Scene', 'S2 IS HERE!!! #TheChronicles', 'published', NOW() - INTERVAL '33 days', 'https://picsum.photos/seed/ep9tt/1080/1920', 'tt_chronicles_s2e1'),
('a2010103-0101-0101-0101-010101010101', 'e2010101-0101-0101-0101-010101010101', 'instagram', 'short', 'Dark Horizons Preview', 'The darkness begins...', 'published', NOW() - INTERVAL '32 days', 'https://picsum.photos/seed/ep9ig/1080/1920', 'ig_chronicles_s2e1'),
-- Episode 2
('a2020201-0202-0202-0202-020202020202', 'e2020202-0202-0202-0202-020202020202', 'youtube', 'full', 'The Chronicles S2E2: Betrayal', 'Trust no one...', 'published', NOW() - INTERVAL '27 days', 'https://picsum.photos/seed/ep10yt/1280/720', 'yt_chronicles_s2e2'),
('a2020202-0202-0202-0202-020202020202', 'e2020202-0202-0202-0202-020202020202', 'tiktok', 'short', 'The Betrayal Scene', 'DID NOT SEE THAT COMING', 'published', NOW() - INTERVAL '26 days', 'https://picsum.photos/seed/ep10tt/1080/1920', 'tt_chronicles_s2e2'),
-- Episode 3
('a2030301-0303-0303-0303-030303030303', 'e2030303-0303-0303-0303-030303030303', 'youtube', 'full', 'The Chronicles S2E3: The Lost City', 'Adventure awaits!', 'published', NOW() - INTERVAL '20 days', 'https://picsum.photos/seed/ep11yt/1280/720', 'yt_chronicles_s2e3'),
('a2030302-0303-0303-0303-030303030303', 'e2030303-0303-0303-0303-030303030303', 'tiktok', 'short', 'Lost City Discovery', 'This city is GORGEOUS', 'published', NOW() - INTERVAL '19 days', 'https://picsum.photos/seed/ep11tt/1080/1920', 'tt_chronicles_s2e3'),
('a2030303-0303-0303-0303-030303030303', 'e2030303-0303-0303-0303-030303030303', 'instagram', 'short', 'Lost City Vibes', 'The animation quality!!', 'published', NOW() - INTERVAL '18 days', 'https://picsum.photos/seed/ep11ig/1080/1920', 'ig_chronicles_s2e3'),
-- Episode 4
('a2040401-0404-0404-0404-040404040404', 'e2040404-0404-0404-0404-040404040404', 'youtube', 'full', 'The Chronicles S2E4: Bonds Tested', 'Will they stay together?', 'published', NOW() - INTERVAL '13 days', 'https://picsum.photos/seed/ep12yt/1280/720', 'yt_chronicles_s2e4'),
('a2040402-0404-0404-0404-040404040404', 'e2040404-0404-0404-0404-040404040404', 'tiktok', 'short', 'Team Argument Scene', 'The tension is real', 'published', NOW() - INTERVAL '12 days', 'https://picsum.photos/seed/ep12tt/1080/1920', 'tt_chronicles_s2e4'),
-- Episode 5
('a2050501-0505-0505-0505-050505050505', 'e2050505-0505-0505-0505-050505050505', 'youtube', 'full', 'The Chronicles S2E5: The Shadow King', 'The villain revealed!', 'published', NOW() - INTERVAL '6 days', 'https://picsum.photos/seed/ep13yt/1280/720', 'yt_chronicles_s2e5'),
('a2050502-0505-0505-0505-050505050505', 'e2050505-0505-0505-0505-050505050505', 'tiktok', 'short', 'Shadow King Entrance', 'Most epic villain reveal EVER', 'published', NOW() - INTERVAL '5 days', 'https://picsum.photos/seed/ep13tt/1080/1920', 'tt_chronicles_s2e5'),
('a2050503-0505-0505-0505-050505050505', 'e2050505-0505-0505-0505-050505050505', 'instagram', 'short', 'Shadow King Reveal', 'Whos ready for the boss battle?', 'published', NOW() - INTERVAL '4 days', 'https://picsum.photos/seed/ep13ig/1080/1920', 'ig_chronicles_s2e5'),
-- Episode 6 (recent)
('a2060601-0606-0606-0606-060606060606', 'e2060606-0606-0606-0606-060606060606', 'youtube', 'full', 'The Chronicles S2E6: Sacrifice', 'Prepare for emotions...', 'published', NOW() - INTERVAL '2 days', 'https://picsum.photos/seed/ep14yt/1280/720', 'yt_chronicles_s2e6'),
('a2060602-0606-0606-0606-060606060606', 'e2060606-0606-0606-0606-060606060606', 'tiktok', 'short', 'The Sacrifice Scene', 'I cried so hard...', 'published', NOW() - INTERVAL '1 day', 'https://picsum.photos/seed/ep14tt/1080/1920', 'tt_chronicles_s2e6'),
-- Episode 7 (Season 2 Finale - just released)
('a2070701-0707-0707-0707-070707070707', 'e2070707-0707-0707-0707-070707070707', 'youtube', 'full', 'The Chronicles S2E7: Season Finale - Rising', 'Season 2 finale is here!', 'published', NOW() - INTERVAL '12 hours', 'https://picsum.photos/seed/ep15yt/1280/720', 'yt_chronicles_s2e7'),
('a2070702-0707-0707-0707-070707070707', 'e2070707-0707-0707-0707-070707070707', 'tiktok', 'short', 'S2 Finale Best Moments', 'WHAT A FINALE!', 'published', NOW() - INTERVAL '6 hours', 'https://picsum.photos/seed/ep15tt/1080/1920', 'tt_chronicles_s2e7')
ON CONFLICT (id) DO NOTHING;

-- Season 3 Publishes (fewer - just started)
INSERT INTO public.publishes (id, episode_id, platform, content_type, title, description, status, published_at, thumbnail_url, platform_content_id) VALUES
-- Episode 1
('a3010101-0101-0101-0101-010101010101', 'e3010101-0101-0101-0101-010101010101', 'youtube', 'full', 'The Chronicles S3E1: The Gathering Storm', 'The final season begins!', 'published', NOW() - INTERVAL '3 hours', 'https://picsum.photos/seed/ep16yt/1280/720', 'yt_chronicles_s3e1'),
('a3010102-0101-0101-0101-010101010101', 'e3010101-0101-0101-0101-010101010101', 'tiktok', 'short', 'Final Season Premiere!', 'ITS HAPPENING!!! #TheChronicles #FinalSeason', 'published', NOW() - INTERVAL '2 hours', 'https://picsum.photos/seed/ep16tt/1080/1920', 'tt_chronicles_s3e1'),
('a3010103-0101-0101-0101-010101010101', 'e3010101-0101-0101-0101-010101010101', 'instagram', 'short', 'Final Season Is Here', 'The end begins now...', 'published', NOW() - INTERVAL '1 hour', 'https://picsum.photos/seed/ep16ig/1080/1920', 'ig_chronicles_s3e1')
ON CONFLICT (id) DO NOTHING;

-- ==================================
-- Section 4b: Asset durations (FILM-1710)
-- ==================================
-- What the provider sync would have written. A YouTube `full` is the episode
-- render, so it shares the episode's length; a TikTok `short` is a 30-59s
-- clip of it, which is the whole point — before FILM-1710 these read as the
-- episode's ~1,500 seconds. Instagram stays NULL on purpose: Meta's Media
-- node has no duration field, so `duration_unknown` is its real state.

UPDATE public.publishes p
SET duration_seconds = CASE
  WHEN p.platform = 'youtube' THEN NULLIF(GREATEST(e.duration_seconds, 0), 0)
  ELSE 30 + (('x' || substr(md5(p.id::text), 1, 4))::bit(16)::int % 30)
END
FROM public.episodes e
WHERE e.id = p.episode_id
  AND e.project_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
  AND p.platform IN ('youtube', 'tiktok')
  AND p.duration_seconds IS NULL;

-- ==================================
-- Section 5: Content Analytics — REMOVED
-- ==================================
-- Analytics metrics are now stored in ClickHouse (video_daily_stats table).
-- The content_analytics Postgres table has been dropped.
-- See migration 20260212080000_drop_content_analytics.sql

-- ==================================
-- Output
-- ==================================
-- Display summary and URL

DO $$
DECLARE
  episode_count INTEGER;
  publish_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO episode_count
  FROM public.episodes
  WHERE project_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  SELECT COUNT(*) INTO publish_count
  FROM public.publishes p
  JOIN public.episodes e ON p.episode_id = e.id
  WHERE e.project_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  RAISE NOTICE '';
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'Analytics Mock Data Seed Complete!';
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'Project: The Chronicles';
  RAISE NOTICE 'Episodes: %', episode_count;
  RAISE NOTICE 'Publishes: %', publish_count;
  RAISE NOTICE 'Analytics: Stored in ClickHouse (not seeded here)';
  RAISE NOTICE '';
  RAISE NOTICE 'View at: http://localhost:3000/home/storybook/studio/a1b2c3d4-e5f6-7890-abcd-ef1234567890/analytics';
  RAISE NOTICE '===========================================';
END $$;
