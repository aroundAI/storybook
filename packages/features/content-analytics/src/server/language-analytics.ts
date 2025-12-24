'use server';

import 'server-only';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * Language performance summary
 */
export interface LanguagePerformance {
    language: string;
    views: number;
    viewsChange: number; // percentage change vs previous period
    likes: number;
    comments: number;
    shares: number;
    engagement: number; // (likes + comments + shares) / views * 100
    revenueCents: number;
    contentCount: number;
}

/**
 * Platform × Language matrix entry
 */
export interface PlatformLanguageEntry {
    platform: string;
    language: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    engagementRate: number;
    revenueCents: number;
    contentCount: number;
}

/**
 * Content type comparison (shorts vs long-form)
 */
export interface ContentTypeComparison {
    longForm: {
        views: number;
        likes: number;
        comments: number;
        shares: number;
        engagement: number;
        revenueCents: number;
        subscribersGained: number;
        contentCount: number;
    };
    shorts: {
        views: number;
        likes: number;
        comments: number;
        shares: number;
        engagement: number;
        revenueCents: number;
        subscribersGained: number;
        contentCount: number;
    };
}

/**
 * Get language performance breakdown for a project
 */
export async function getLanguagePerformance(
    projectId: string,
    options?: { startDate?: Date; endDate?: Date },
): Promise<LanguagePerformance[]> {
    const client = getSupabaseServerClient();

    // Default to last 30 days
    const endDate = options?.endDate || new Date();
    const startDate =
        options?.startDate ||
        new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Previous period for comparison
    const periodDays =
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    const previousEndDate = new Date(startDate.getTime() - 1);
    const previousStartDate = new Date(
        previousEndDate.getTime() - periodDays * 24 * 60 * 60 * 1000,
    );

    // Get all seasons for this project
    const { data: seasons } = await client
        .from('seasons')
        .select('id')
        .eq('project_id', projectId)
        .is('deleted_at', null);

    if (!seasons || seasons.length === 0) return [];

    const seasonIds = seasons.map((s) => s.id);

    // Get all episodes
    const { data: episodes } = await client
        .from('episodes')
        .select('id')
        .in('season_id', seasonIds)
        .is('deleted_at', null);

    if (!episodes || episodes.length === 0) return [];

    const episodeIds = episodes.map((e) => e.id);

    // Get all publishes - language column may not exist yet in types
    // but will be available after migration runs
    const { data: publishes } = await client
        .from('publishes')
        .select('id, platform_connection_id')
        .in('episode_id', episodeIds);

    if (!publishes || publishes.length === 0) return [];

    const publishIds = publishes.map((p) => p.id);

    // Get platform connections with language
    const connectionIds = [...new Set(publishes.map((p) => p.platform_connection_id).filter(Boolean))];
    const languageByConnection = new Map<string, string>();

    if (connectionIds.length > 0) {
        const { data: connections } = await client
            .from('platform_connections')
            .select('id, language')
            .in('id', connectionIds as string[]);

        for (const conn of connections || []) {
            const c = conn as unknown as { id: string; language?: string };
            languageByConnection.set(c.id, c.language || 'en');
        }
    }

    // Create publish -> language map (infer from platform_connection)
    const publishLanguageMap = new Map<string, string>();
    for (const p of publishes) {
        const connId = p.platform_connection_id;
        const language = connId ? (languageByConnection.get(connId) || 'en') : 'en';
        publishLanguageMap.set(p.id, language);
    }

    // Get current period analytics
    const { data: currentAnalytics } = await client
        .from('content_analytics')
        .select(
            'publish_id, views, likes, comments, shares, revenue_cents, subscribers_gained',
        )
        .in('publish_id', publishIds)
        .gte('snapshot_date', startDate.toISOString().split('T')[0])
        .lte('snapshot_date', endDate.toISOString().split('T')[0])
        .order('snapshot_date', { ascending: false });

    // Get previous period analytics
    const { data: previousAnalytics } = await client
        .from('content_analytics')
        .select('publish_id, views')
        .in('publish_id', publishIds)
        .gte('snapshot_date', previousStartDate.toISOString().split('T')[0])
        .lte('snapshot_date', previousEndDate.toISOString().split('T')[0])
        .order('snapshot_date', { ascending: false });

    // Aggregate by language (current period)
    const languageStats = new Map<
        string,
        {
            views: number;
            likes: number;
            comments: number;
            shares: number;
            revenueCents: number;
            publishIds: Set<string>;
        }
    >();

    // Get latest per publish for current period
    const latestByPublish = new Map<
        string,
        {
            views: number;
            likes: number;
            comments: number;
            shares: number;
            revenueCents: number;
        }
    >();
    for (const a of currentAnalytics || []) {
        if (!latestByPublish.has(a.publish_id)) {
            latestByPublish.set(a.publish_id, {
                views: a.views || 0,
                likes: a.likes || 0,
                comments: a.comments || 0,
                shares: a.shares || 0,
                revenueCents: a.revenue_cents || 0,
            });
        }
    }

    // Aggregate by language
    for (const [publishId, stats] of latestByPublish) {
        const language = publishLanguageMap.get(publishId) || 'en';
        const current = languageStats.get(language) || {
            views: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            revenueCents: 0,
            publishIds: new Set<string>(),
        };

        current.views += stats.views;
        current.likes += stats.likes;
        current.comments += stats.comments;
        current.shares += stats.shares;
        current.revenueCents += stats.revenueCents;
        current.publishIds.add(publishId);

        languageStats.set(language, current);
    }

    // Previous period views by language
    const previousViewsByLanguage = new Map<string, number>();
    const previousLatestByPublish = new Map<string, number>();
    for (const a of previousAnalytics || []) {
        if (!previousLatestByPublish.has(a.publish_id)) {
            previousLatestByPublish.set(a.publish_id, a.views || 0);
        }
    }
    for (const [publishId, views] of previousLatestByPublish) {
        const language = publishLanguageMap.get(publishId) || 'en';
        previousViewsByLanguage.set(
            language,
            (previousViewsByLanguage.get(language) || 0) + views,
        );
    }

    // Build result
    const results: LanguagePerformance[] = [];
    for (const [language, stats] of languageStats) {
        const previousViews = previousViewsByLanguage.get(language) || 0;
        const viewsChange =
            previousViews > 0
                ? ((stats.views - previousViews) / previousViews) * 100
                : stats.views > 0
                    ? 100
                    : 0;

        const engagement =
            stats.views > 0
                ? ((stats.likes + stats.comments + stats.shares) / stats.views) * 100
                : 0;

        results.push({
            language,
            views: stats.views,
            viewsChange,
            likes: stats.likes,
            comments: stats.comments,
            shares: stats.shares,
            engagement,
            revenueCents: stats.revenueCents,
            contentCount: stats.publishIds.size,
        });
    }

    // Sort by views descending
    return results.sort((a, b) => b.views - a.views);
}

/**
 * Get platform × language performance matrix
 */
export async function getPlatformLanguageMatrix(
    projectId: string,
    options?: { startDate?: Date; endDate?: Date },
): Promise<PlatformLanguageEntry[]> {
    const client = getSupabaseServerClient();

    const endDate = options?.endDate || new Date();
    const startDate =
        options?.startDate ||
        new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get project structure
    const { data: seasons } = await client
        .from('seasons')
        .select('id')
        .eq('project_id', projectId)
        .is('deleted_at', null);

    if (!seasons || seasons.length === 0) return [];

    const seasonIds = seasons.map((s) => s.id);

    const { data: episodes } = await client
        .from('episodes')
        .select('id')
        .in('season_id', seasonIds)
        .is('deleted_at', null);

    if (!episodes || episodes.length === 0) return [];

    const episodeIds = episodes.map((e) => e.id);

    // Get publishes with platform - language inferred from platform_connection
    const { data: publishes } = await client
        .from('publishes')
        .select('id, platform, platform_connection_id')
        .in('episode_id', episodeIds);

    if (!publishes || publishes.length === 0) return [];

    const publishIds = publishes.map((p) => p.id);

    // Get platform connections with language
    const connectionIds = [...new Set(publishes.map((p) => p.platform_connection_id).filter(Boolean))];
    const languageByConnection = new Map<string, string>();

    if (connectionIds.length > 0) {
        const { data: connections } = await client
            .from('platform_connections')
            .select('id, language')
            .in('id', connectionIds as string[]);

        for (const conn of connections || []) {
            const c = conn as unknown as { id: string; language?: string };
            languageByConnection.set(c.id, c.language || 'en');
        }
    }

    // Create maps
    const publishInfoMap = new Map<
        string,
        { platform: string; language: string }
    >();
    for (const p of publishes) {
        const connId = p.platform_connection_id;
        const language = connId ? (languageByConnection.get(connId) || 'en') : 'en';
        publishInfoMap.set(p.id, {
            platform: p.platform,
            language,
        });
    }

    // Get analytics
    const { data: analytics } = await client
        .from('content_analytics')
        .select(
            'publish_id, views, likes, comments, shares, revenue_cents',
        )
        .in('publish_id', publishIds)
        .gte('snapshot_date', startDate.toISOString().split('T')[0])
        .lte('snapshot_date', endDate.toISOString().split('T')[0])
        .order('snapshot_date', { ascending: false });

    // Aggregate by platform-language
    const matrix = new Map<
        string,
        {
            platform: string;
            language: string;
            views: number;
            likes: number;
            comments: number;
            shares: number;
            revenueCents: number;
            publishIds: Set<string>;
        }
    >();

    // Get latest per publish
    const latestByPublish = new Map<
        string,
        {
            views: number;
            likes: number;
            comments: number;
            shares: number;
            revenueCents: number;
        }
    >();
    for (const a of analytics || []) {
        if (!latestByPublish.has(a.publish_id)) {
            latestByPublish.set(a.publish_id, {
                views: a.views || 0,
                likes: a.likes || 0,
                comments: a.comments || 0,
                shares: a.shares || 0,
                revenueCents: a.revenue_cents || 0,
            });
        }
    }

    // Aggregate
    for (const [publishId, stats] of latestByPublish) {
        const info = publishInfoMap.get(publishId);
        if (!info) continue;

        const key = `${info.platform}:${info.language}`;
        const current = matrix.get(key) || {
            platform: info.platform,
            language: info.language,
            views: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            revenueCents: 0,
            publishIds: new Set<string>(),
        };

        current.views += stats.views;
        current.likes += stats.likes;
        current.comments += stats.comments;
        current.shares += stats.shares;
        current.revenueCents += stats.revenueCents;
        current.publishIds.add(publishId);

        matrix.set(key, current);
    }

    // Build result
    const results: PlatformLanguageEntry[] = [];
    for (const entry of matrix.values()) {
        const engagementRate =
            entry.views > 0
                ? ((entry.likes + entry.comments + entry.shares) / entry.views) * 100
                : 0;

        results.push({
            platform: entry.platform,
            language: entry.language,
            views: entry.views,
            likes: entry.likes,
            comments: entry.comments,
            shares: entry.shares,
            engagementRate,
            revenueCents: entry.revenueCents,
            contentCount: entry.publishIds.size,
        });
    }

    // Sort by views
    return results.sort((a, b) => b.views - a.views);
}

/**
 * Get content type comparison (shorts vs long-form)
 */
export async function getContentTypeComparison(
    projectId: string,
    options?: { startDate?: Date; endDate?: Date },
): Promise<ContentTypeComparison> {
    const client = getSupabaseServerClient();

    const endDate = options?.endDate || new Date();
    const startDate =
        options?.startDate ||
        new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get project structure
    const { data: seasons } = await client
        .from('seasons')
        .select('id')
        .eq('project_id', projectId)
        .is('deleted_at', null);

    if (!seasons || seasons.length === 0) {
        return getEmptyComparison();
    }

    const seasonIds = seasons.map((s) => s.id);

    const { data: episodes } = await client
        .from('episodes')
        .select('id')
        .in('season_id', seasonIds)
        .is('deleted_at', null);

    if (!episodes || episodes.length === 0) {
        return getEmptyComparison();
    }

    const episodeIds = episodes.map((e) => e.id);

    // Get publishes with content_type
    const { data: publishes } = await client
        .from('publishes')
        .select('id, content_type')
        .in('episode_id', episodeIds);

    if (!publishes || publishes.length === 0) {
        return getEmptyComparison();
    }

    const publishIds = publishes.map((p) => p.id);

    // Create content type map
    const publishContentTypeMap = new Map<string, string>();
    for (const p of publishes) {
        publishContentTypeMap.set(p.id, p.content_type || 'full');
    }

    // Get analytics
    const { data: analytics } = await client
        .from('content_analytics')
        .select(
            'publish_id, views, likes, comments, shares, revenue_cents, subscribers_gained',
        )
        .in('publish_id', publishIds)
        .gte('snapshot_date', startDate.toISOString().split('T')[0])
        .lte('snapshot_date', endDate.toISOString().split('T')[0])
        .order('snapshot_date', { ascending: false });

    // Aggregate by content type
    const longForm = {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        revenueCents: 0,
        subscribersGained: 0,
        publishIds: new Set<string>(),
    };
    const shorts = {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        revenueCents: 0,
        subscribersGained: 0,
        publishIds: new Set<string>(),
    };

    // Get latest per publish
    const latestByPublish = new Map<
        string,
        {
            views: number;
            likes: number;
            comments: number;
            shares: number;
            revenueCents: number;
            subscribersGained: number;
        }
    >();
    for (const a of analytics || []) {
        if (!latestByPublish.has(a.publish_id)) {
            latestByPublish.set(a.publish_id, {
                views: a.views || 0,
                likes: a.likes || 0,
                comments: a.comments || 0,
                shares: a.shares || 0,
                revenueCents: a.revenue_cents || 0,
                subscribersGained: a.subscribers_gained || 0,
            });
        }
    }

    // Aggregate
    for (const [publishId, stats] of latestByPublish) {
        const contentType = publishContentTypeMap.get(publishId) || 'full';
        const isShort = contentType === 'short' || contentType === 'teaser';
        const target = isShort ? shorts : longForm;

        target.views += stats.views;
        target.likes += stats.likes;
        target.comments += stats.comments;
        target.shares += stats.shares;
        target.revenueCents += stats.revenueCents;
        target.subscribersGained += stats.subscribersGained;
        target.publishIds.add(publishId);
    }

    return {
        longForm: {
            views: longForm.views,
            likes: longForm.likes,
            comments: longForm.comments,
            shares: longForm.shares,
            engagement:
                longForm.views > 0
                    ? ((longForm.likes + longForm.comments + longForm.shares) /
                        longForm.views) *
                    100
                    : 0,
            revenueCents: longForm.revenueCents,
            subscribersGained: longForm.subscribersGained,
            contentCount: longForm.publishIds.size,
        },
        shorts: {
            views: shorts.views,
            likes: shorts.likes,
            comments: shorts.comments,
            shares: shorts.shares,
            engagement:
                shorts.views > 0
                    ? ((shorts.likes + shorts.comments + shorts.shares) / shorts.views) *
                    100
                    : 0,
            revenueCents: shorts.revenueCents,
            subscribersGained: shorts.subscribersGained,
            contentCount: shorts.publishIds.size,
        },
    };
}

function getEmptyComparison(): ContentTypeComparison {
    return {
        longForm: {
            views: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            engagement: 0,
            revenueCents: 0,
            subscribersGained: 0,
            contentCount: 0,
        },
        shorts: {
            views: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            engagement: 0,
            revenueCents: 0,
            subscribersGained: 0,
            contentCount: 0,
        },
    };
}

// =============================================================================
// Phase 3: Shorts Source Performance
// =============================================================================

/**
 * Shorts performance with source episode info
 */
export interface ShortsSourcePerformance {
    publishId: string;
    publishTitle: string;
    sourceEpisodeId: string | null;
    sourceEpisodeTitle: string | null;
    sourceShotId: string | null;
    language: string;
    platform: string;
    views: number;
    likes: number;
    comments: number;
    engagement: number;
}

/**
 * Get shorts performance with source episode/shot tracing
 * Shows which clips perform best across languages and platforms
 */
export async function getShortsSourcePerformance(
    projectId: string,
    options?: { startDate?: Date; endDate?: Date; limit?: number },
): Promise<ShortsSourcePerformance[]> {
    const client = getSupabaseServerClient();

    const endDate = options?.endDate || new Date();
    const startDate =
        options?.startDate ||
        new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const limit = options?.limit || 10;

    // Get project structure
    const { data: seasons } = await client
        .from('seasons')
        .select('id')
        .eq('project_id', projectId)
        .is('deleted_at', null);

    if (!seasons || seasons.length === 0) return [];

    const seasonIds = seasons.map((s) => s.id);

    const { data: episodes } = await client
        .from('episodes')
        .select('id, title')
        .in('season_id', seasonIds)
        .is('deleted_at', null);

    if (!episodes || episodes.length === 0) return [];

    const episodeIds = episodes.map((e) => e.id);
    const episodeTitleMap = new Map<string, string>();
    for (const ep of episodes) {
        episodeTitleMap.set(ep.id, ep.title);
    }

    // Get shorts publishes
    const { data: publishes } = await client
        .from('publishes')
        .select('id, title, platform, platform_connection_id, episode_id, content_type')
        .in('episode_id', episodeIds)
        .eq('content_type', 'short');

    if (!publishes || publishes.length === 0) return [];

    const publishIds = publishes.map((p) => p.id);

    // Get language from platform connections
    const connectionIds = [...new Set(publishes.map((p) => p.platform_connection_id).filter(Boolean))];
    const languageByConnection = new Map<string, string>();

    if (connectionIds.length > 0) {
        const { data: connections } = await client
            .from('platform_connections')
            .select('id, language')
            .in('id', connectionIds as string[]);

        for (const conn of connections || []) {
            const c = conn as unknown as { id: string; language?: string };
            languageByConnection.set(c.id, c.language || 'en');
        }
    }

    // Get analytics for these publishes
    const { data: analytics } = await client
        .from('content_analytics')
        .select('publish_id, views, likes, comments')
        .in('publish_id', publishIds)
        .gte('snapshot_date', startDate.toISOString().split('T')[0])
        .lte('snapshot_date', endDate.toISOString().split('T')[0])
        .order('snapshot_date', { ascending: false });

    // Get latest analytics per publish
    const latestByPublish = new Map<string, { views: number; likes: number; comments: number }>();
    for (const a of analytics || []) {
        if (!latestByPublish.has(a.publish_id)) {
            latestByPublish.set(a.publish_id, {
                views: a.views || 0,
                likes: a.likes || 0,
                comments: a.comments || 0,
            });
        }
    }

    // Build results
    const results: ShortsSourcePerformance[] = [];
    for (const pub of publishes) {
        const stats = latestByPublish.get(pub.id);
        if (!stats) continue;

        const connId = pub.platform_connection_id;
        const language = connId ? (languageByConnection.get(connId) || 'en') : 'en';
        const engagement = stats.views > 0
            ? ((stats.likes + stats.comments) / stats.views) * 100
            : 0;

        results.push({
            publishId: pub.id,
            publishTitle: pub.title || 'Untitled Short',
            sourceEpisodeId: pub.episode_id,
            sourceEpisodeTitle: pub.episode_id ? episodeTitleMap.get(pub.episode_id) || null : null,
            sourceShotId: null, // Will be available after migration
            language,
            platform: pub.platform,
            views: stats.views,
            likes: stats.likes,
            comments: stats.comments,
            engagement,
        });
    }

    // Sort by views and limit
    return results
        .sort((a, b) => b.views - a.views)
        .slice(0, limit);
}

// =============================================================================
// Phase 4: Geography by Language
// =============================================================================

/**
 * Geography breakdown for a language
 */
export interface GeographyByLanguage {
    language: string;
    countries: {
        country: string;
        views: number;
        percentage: number;
    }[];
}

/**
 * Get geographic distribution of views by language
 * Extracts country data from content_analytics.raw_data JSONB field
 */
export async function getGeographyByLanguage(
    projectId: string,
    options?: { startDate?: Date; endDate?: Date },
): Promise<GeographyByLanguage[]> {
    const client = getSupabaseServerClient();

    const endDate = options?.endDate || new Date();
    const startDate =
        options?.startDate ||
        new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get project structure
    const { data: seasons } = await client
        .from('seasons')
        .select('id')
        .eq('project_id', projectId)
        .is('deleted_at', null);

    if (!seasons || seasons.length === 0) return [];

    const seasonIds = seasons.map((s) => s.id);

    const { data: episodes } = await client
        .from('episodes')
        .select('id')
        .in('season_id', seasonIds)
        .is('deleted_at', null);

    if (!episodes || episodes.length === 0) return [];

    const episodeIds = episodes.map((e) => e.id);

    // Get publishes with language info
    const { data: publishes } = await client
        .from('publishes')
        .select('id, platform_connection_id')
        .in('episode_id', episodeIds);

    if (!publishes || publishes.length === 0) return [];

    const publishIds = publishes.map((p) => p.id);

    // Get language from platform connections
    const connectionIds = [...new Set(publishes.map((p) => p.platform_connection_id).filter(Boolean))];
    const languageByConnection = new Map<string, string>();

    if (connectionIds.length > 0) {
        const { data: connections } = await client
            .from('platform_connections')
            .select('id, language')
            .in('id', connectionIds as string[]);

        for (const conn of connections || []) {
            const c = conn as unknown as { id: string; language?: string };
            languageByConnection.set(c.id, c.language || 'en');
        }
    }

    // Create publish -> language map
    const publishLanguageMap = new Map<string, string>();
    for (const pub of publishes) {
        const connId = pub.platform_connection_id;
        const language = connId ? (languageByConnection.get(connId) || 'en') : 'en';
        publishLanguageMap.set(pub.id, language);
    }

    // Get analytics with raw_data that contains geography
    const { data: analytics } = await client
        .from('content_analytics')
        .select('publish_id, views, raw_data')
        .in('publish_id', publishIds)
        .gte('snapshot_date', startDate.toISOString().split('T')[0])
        .lte('snapshot_date', endDate.toISOString().split('T')[0])
        .order('snapshot_date', { ascending: false });

    // Aggregate geography by language
    const geographyByLang = new Map<string, Map<string, number>>();
    const totalViewsByLang = new Map<string, number>();

    // Process latest analytics per publish
    const processedPublishes = new Set<string>();
    for (const a of analytics || []) {
        if (processedPublishes.has(a.publish_id)) continue;
        processedPublishes.add(a.publish_id);

        const language = publishLanguageMap.get(a.publish_id) || 'en';

        // Extract geography from raw_data if available
        const rawData = a.raw_data as { geography?: Record<string, number> } | null;
        const geography = rawData?.geography || {};

        if (!geographyByLang.has(language)) {
            geographyByLang.set(language, new Map());
        }

        const langGeo = geographyByLang.get(language)!;

        // If no geography data, use views as "Unknown"
        if (Object.keys(geography).length === 0) {
            langGeo.set('Unknown', (langGeo.get('Unknown') || 0) + (a.views || 0));
        } else {
            for (const [country, views] of Object.entries(geography)) {
                langGeo.set(country, (langGeo.get(country) || 0) + views);
            }
        }

        totalViewsByLang.set(
            language,
            (totalViewsByLang.get(language) || 0) + (a.views || 0),
        );
    }

    // Build results
    const results: GeographyByLanguage[] = [];
    for (const [language, countryMap] of geographyByLang) {
        const totalViews = totalViewsByLang.get(language) || 0;
        const countries = Array.from(countryMap.entries())
            .map(([country, views]) => ({
                country,
                views,
                percentage: totalViews > 0 ? (views / totalViews) * 100 : 0,
            }))
            .sort((a, b) => b.views - a.views)
            .slice(0, 10);

        results.push({ language, countries });
    }

    // Sort by total views
    return results.sort((a, b) => {
        const aTotal = a.countries.reduce((sum, c) => sum + c.views, 0);
        const bTotal = b.countries.reduce((sum, c) => sum + c.views, 0);
        return bTotal - aTotal;
    });
}
