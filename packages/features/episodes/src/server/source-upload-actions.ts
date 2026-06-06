'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

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
 * Requires account owner role for authorization.
 */
export const uploadSourceContentAction = enhanceAction(
  async (data: z.infer<typeof UploadSourceSchema>) => {
    // Authorization: verify user is an owner of at least one account
    const userClient = getSupabaseServerClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user) {
      throw new Error('Authentication required');
    }

    const { count } = await userClient
      .from('accounts_memberships')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('account_role', 'owner');

    if (!count || count === 0) {
      throw new Error('Only account owners can upload sources');
    }

    const admin = getSupabaseServerAdminClient();

    // Generate slug from name
    const slug = data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100);

    // Upsert source to prevent race condition on concurrent uploads
    const { data: source, error: sourceError } = await admin
      .from('external_sources')
      .upsert(
        {
          name: data.name,
          slug,
          category: data.category,
          provider_type: 'manual',
          credibility_tier: 'tier_3',
          website_url: data.sourceUrl ?? null,
        },
        { onConflict: 'slug' },
      )
      .select('id')
      .single();

    if (sourceError || !source) {
      throw new Error(`Failed to create source: ${sourceError?.message}`);
    }

    const sourceId = source.id;

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
    // SSRF mitigation: resolve hostname and validate IP against private ranges
    const { hostname } = new URL(data.url);

    // Block obvious private hostnames before DNS
    const blockedHostnames = ['localhost', '0.0.0.0', '[::1]'];
    if (blockedHostnames.includes(hostname.toLowerCase())) {
      throw new Error('URL points to a private or internal address');
    }

    // Resolve DNS and validate the actual IP address
    const { resolve4 } = await import('node:dns/promises');
    let resolvedIps: string[];
    try {
      resolvedIps = await resolve4(hostname);
    } catch {
      throw new Error(`Unable to resolve hostname: ${hostname}`);
    }

    const isPrivateIp = (ip: string): boolean => {
      const parts = ip.split('.').map(Number);
      if (parts.length !== 4) return true; // non-IPv4 → block
      const [a, b] = parts;
      return (
        a === 10 || // 10.0.0.0/8
        a === 127 || // 127.0.0.0/8 (loopback)
        (a === 172 && b! >= 16 && b! <= 31) || // 172.16.0.0/12
        (a === 192 && b === 168) || // 192.168.0.0/16
        (a === 169 && b === 254) || // 169.254.0.0/16 (link-local / AWS metadata)
        a === 0 // 0.0.0.0/8
      );
    };

    if (resolvedIps.some(isPrivateIp)) {
      throw new Error('URL resolves to a private or internal address');
    }

    const response = await fetch(data.url, {
      headers: { 'User-Agent': 'StoryBook-Research/1.0' },
      signal: AbortSignal.timeout(15000),
      redirect: 'manual',
    });

    // Block redirects — attacker could redirect to internal services
    if (response.status >= 300 && response.status < 400) {
      throw new Error(
        'URL returned a redirect, which is not allowed for security reasons',
      );
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch URL: ${response.status} ${response.statusText}`,
      );
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
    const truncated =
      stripped.length > MAX_CONTENT_LENGTH
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
 * For content over 500 chars: queues an LLM-based extraction job via SQS.
 * For short content: uses a quick regex-based heuristic as a fast fallback.
 */
export const extractFactsFromContentAction = enhanceAction(
  async (data: z.infer<typeof ExtractFactsSchema>) => {
    const supabase = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(supabase);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // Verify user has access to the project (RLS enforced)
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('id', data.projectId)
      .single();

    if (projectError || !project) {
      throw new Error('Project not found or access denied');
    }

    // For substantial content, use LLM-based extraction via Lambda
    if (data.content.length > 500) {
      const { chunkTextForExtraction } = await import(
        '../lib/server/pdf-extractor'
      );
      const { queueLlmJob } = await import('@kit/prompt-engine/server');

      const chunks = chunkTextForExtraction(data.content);

      for (const chunk of chunks) {
        await queueLlmJob({
          jobType: 'fact-extraction',
          userId: user.id,
          payload: {
            content: chunk,
            projectId: data.projectId,
            sourceTitle: data.sourceTitle,
            sourceCitation: data.sourceCitation ?? data.sourceTitle,
            userId: user.id,
          },
        });
      }

      return {
        extractedCount: 0,
        queued: true,
        chunkCount: chunks.length,
        message: `Queued ${chunks.length} chunk(s) for LLM-based fact extraction. Facts will appear in your library shortly.`,
      };
    }

    // Fast fallback for very short content: regex-based extraction
    const sentences = data.content
      .split(/[.!?]\s+/)
      .filter((s) => s.length > 20 && s.length < 500)
      .slice(0, 20);

    const facts: Array<{ claim: string; citation: string }> = sentences
      .filter((s) => {
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

    const { error } = await supabase.from('verified_facts').insert(inserts);

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
