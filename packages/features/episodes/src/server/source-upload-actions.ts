'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import { SOURCE_CATEGORIES } from '../types/external-context';

// =============================================================================
// SCHEMAS
// =============================================================================

const UploadSourceSchema = z.object({
    name: z.string().min(1).max(200),
    content: z.string().min(1),
    category: z.enum(SOURCE_CATEGORIES),
    projectId: z.string().uuid(),
    sourceUrl: z.string().url().optional(),
});

const FetchUrlSchema = z.object({
    url: z.string().url(),
});

const ExtractFactsSchema = z.object({
    content: z.string().min(1),
    projectId: z.string().uuid(),
    sourceTitle: z.string().min(1),
    sourceCitation: z.string().optional(),
});

// =============================================================================
// ACTIONS
// =============================================================================

/**
 * Upload source content and create an external_content entry.
 * Creates a source if needed, then caches the content.
 * Requires account membership for authorization.
 */
export const uploadSourceContentAction = enhanceAction(
    async (data: z.infer<typeof UploadSourceSchema>) => {
        // Authorization: verify user has at least one account membership
        const userClient = getSupabaseServerClient();
        const { data: { user } } = await userClient.auth.getUser();

        if (!user) {
            throw new Error('Authentication required');
        }

        const { count } = await userClient
            .from('accounts_memberships')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);

        if (!count || count === 0) {
            throw new Error('You must be a member of an account to upload sources');
        }

        const admin = getSupabaseServerAdminClient();

        // Generate slug from name
        const slug = data.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 100);

        // Check if source already exists
        const { data: existingSource } = await admin
            .from('external_sources')
            .select('id')
            .eq('slug', slug)
            .single();

        let sourceId: string;

        if (existingSource) {
            sourceId = existingSource.id;
        } else {
            // Create new source
            const { data: newSource, error: sourceError } = await admin
                .from('external_sources')
                .insert({
                    name: data.name,
                    slug,
                    category: data.category,
                    provider_type: 'manual',
                    credibility_tier: 'tier_3',
                    website_url: data.sourceUrl ?? null,
                })
                .select('id')
                .single();

            if (sourceError || !newSource) {
                throw new Error(`Failed to create source: ${sourceError?.message}`);
            }

            sourceId = newSource.id;
        }

        // Create external content entry
        const externalId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { data: content, error: contentError } = await admin
            .from('external_content')
            .insert({
                external_id: externalId,
                source_id: sourceId,
                title: data.name,
                content: data.content,
                url: data.sourceUrl ?? `manual://${slug}`,
                category: data.category,
            })
            .select('id')
            .single();

        if (contentError) {
            throw new Error(`Failed to store content: ${contentError.message}`);
        }

        return { sourceId, contentId: content?.id ?? null };
    },
    {
        auth: true,
        schema: UploadSourceSchema,
    },
);

/**
 * Fetch content from a URL (basic text extraction).
 * Returns the extracted text for preview / fact extraction.
 */
export const fetchUrlContentAction = enhanceAction(
    async (data: z.infer<typeof FetchUrlSchema>) => {
        // SSRF mitigation: block private/internal URLs
        const blockedPatterns = [
            /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i,
            /^https?:\/\/169\.254\./,  // AWS metadata
            /^https?:\/\/(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/,  // RFC 1918
        ];
        if (blockedPatterns.some((p) => p.test(data.url))) {
            throw new Error('URL points to a private or internal address');
        }

        const response = await fetch(data.url, {
            headers: { 'User-Agent': 'StoryBook-Research/1.0' },
            signal: AbortSignal.timeout(15000),
            redirect: 'manual',
        });

        // Block redirects — attacker could redirect to internal services
        if (response.status >= 300 && response.status < 400) {
            throw new Error('URL returned a redirect, which is not allowed for security reasons');
        }

        if (!response.ok) {
            throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') ?? '';
        const isHtml = contentType.includes('text/html');

        const text = await response.text();

        // Basic HTML → text stripping
        const stripped = isHtml
            ? text
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
            : text;

        // Truncate to reasonable length
        const MAX_CONTENT_LENGTH = 50000;
        const truncated = stripped.length > MAX_CONTENT_LENGTH
            ? stripped.slice(0, MAX_CONTENT_LENGTH) + '...'
            : stripped;

        return {
            content: truncated,
            title: data.url,
            contentType,
            length: stripped.length,
        };
    },
    {
        auth: true,
        schema: FetchUrlSchema,
    },
);

/**
 * Extract facts from content using LLM.
 * Creates verified_facts entries for each extracted fact.
 *
 * TODO(FILM-NEXT): Replace regex heuristics with LLM-based extraction using
 * the prompt-engine. The current regex approach produces low-quality facts
 * (any sentence with a number or proper noun). Track in Phase 12 backlog.
 */
export const extractFactsFromContentAction = enhanceAction(
    async (data: z.infer<typeof ExtractFactsSchema>) => {
        const supabase = getSupabaseServerClient();

        // Simple regex-based extraction as a baseline (LLM integration TBD)
        // Split into sentences and filter for fact-like statements
        const sentences = data.content
            .split(/[.!?]\s+/)
            .filter((s) => s.length > 20 && s.length < 500)
            .slice(0, 20); // Max 20 facts per extraction

        const facts: Array<{ claim: string; citation: string }> = sentences
            .filter((s) => {
                // Basic heuristics for fact-like sentences
                const hasNumbers = /\d/.test(s);
                const hasProperNouns = /[A-Z][a-z]/.test(s);
                return hasNumbers || hasProperNouns;
            })
            .slice(0, 10)
            .map((s) => ({
                claim: s.trim(),
                citation: data.sourceCitation ?? data.sourceTitle,
            }));

        if (facts.length === 0) {
            return { extractedCount: 0, facts: [] };
        }

        // Batch insert into verified_facts
        const inserts = facts.map((f) => ({
            project_id: data.projectId,
            claim: f.claim,
            simplified_claim: f.claim.slice(0, 100),
            source_type: 'other' as const,
            source_citation: f.citation,
            verification_status: 'unverified' as const,
        }));

        const { error } = await supabase
            .from('verified_facts')
            .insert(inserts);

        if (error) {
            throw new Error(`Failed to insert facts: ${error.message}`);
        }

        return { extractedCount: facts.length, facts };
    },
    {
        auth: true,
        schema: ExtractFactsSchema,
    },
);
