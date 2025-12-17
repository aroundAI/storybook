-- Migration: Add extended analytics columns to content_analytics
-- Purpose: Store additional data points from YouTube API
-- - Device type breakdown (mobile, desktop, tablet, TV, game console)
-- - Operating system breakdown (iOS, Android, Windows, etc.)
-- - City-level geography
-- - Subscribed vs non-subscribed viewers
-- - Revenue breakdown (ad revenue vs YouTube Premium)
-- - Saves/bookmarks (TikTok, Instagram)

-- Add saves column (for TikTok/Instagram bookmarks)
ALTER TABLE public.content_analytics
ADD COLUMN IF NOT EXISTS saves bigint DEFAULT 0 NOT NULL;

-- Add revenue breakdown columns
ALTER TABLE public.content_analytics
ADD COLUMN IF NOT EXISTS ad_revenue_cents integer DEFAULT 0 NOT NULL;

ALTER TABLE public.content_analytics
ADD COLUMN IF NOT EXISTS red_revenue_cents integer DEFAULT 0 NOT NULL;

-- Add subscribed status breakdown columns
ALTER TABLE public.content_analytics
ADD COLUMN IF NOT EXISTS subscribed_views bigint DEFAULT 0 NOT NULL;

ALTER TABLE public.content_analytics
ADD COLUMN IF NOT EXISTS unsubscribed_views bigint DEFAULT 0 NOT NULL;

-- Add device breakdown JSONB column
-- Structure: [{ "deviceType": "MOBILE", "views": 1000, "watchTimeMinutes": 500 }, ...]
ALTER TABLE public.content_analytics
ADD COLUMN IF NOT EXISTS device_breakdown jsonb;

-- Add operating system breakdown JSONB column
-- Structure: [{ "operatingSystem": "ANDROID", "views": 1000 }, ...]
ALTER TABLE public.content_analytics
ADD COLUMN IF NOT EXISTS os_breakdown jsonb;

-- Add city geography JSONB column
-- Structure: [{ "city": "New York", "views": 500 }, ...]
ALTER TABLE public.content_analytics
ADD COLUMN IF NOT EXISTS city_breakdown jsonb;

-- Add comments for documentation
COMMENT ON COLUMN public.content_analytics.saves IS 'Bookmarks/saves count (primarily TikTok and Instagram)';
COMMENT ON COLUMN public.content_analytics.ad_revenue_cents IS 'Ad revenue portion in cents (YouTube)';
COMMENT ON COLUMN public.content_analytics.red_revenue_cents IS 'YouTube Premium revenue portion in cents';
COMMENT ON COLUMN public.content_analytics.subscribed_views IS 'Views from subscribed users (YouTube)';
COMMENT ON COLUMN public.content_analytics.unsubscribed_views IS 'Views from non-subscribed users (YouTube)';
COMMENT ON COLUMN public.content_analytics.device_breakdown IS 'Device type breakdown: MOBILE, DESKTOP, TABLET, TV, GAME_CONSOLE';
COMMENT ON COLUMN public.content_analytics.os_breakdown IS 'Operating system breakdown: ANDROID, IOS, WINDOWS, etc.';
COMMENT ON COLUMN public.content_analytics.city_breakdown IS 'City-level geography breakdown';
