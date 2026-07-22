'use server';

import 'server-only';
import { z } from 'zod';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { createHash } from 'crypto';

const logger = getLogger();

export const createTemplateVersionAction = enhanceAction(
  async (params) => {
    logger.info({ params }, 'Creating template version');
    const client = getSupabaseServerClient();

    const templateHash = createHash('sha256')
      .update(JSON.stringify(params.templateContent))
      .digest('hex');

    const { data: currentVersions, error: versionError } = await client
      .from('template_versions')
      .select('version_number')
      .eq('account_id', params.accountId)
      .eq('template_name', params.templateName)
      .order('version_number', { ascending: false })
      .limit(1);

    if (versionError) {
      throw new Error(`Failed to fetch current versions: ${versionError.message}`);
    }

    const versionNumber = currentVersions && currentVersions.length > 0 
      ? currentVersions[0].version_number + 1 
      : 1;

    await client
      .from('template_versions')
      .update({ is_active: false })
      .eq('account_id', params.accountId)
      .eq('template_name', params.templateName)
      .eq('is_active', true);

    const { data, error } = await client
      .from('template_versions')
      .insert({
        account_id: params.accountId,
        project_id: params.projectId || null,
        template_name: params.templateName,
        version_number: versionNumber,
        version_label: params.versionLabel || null,
        template_content: params.templateContent,
        template_hash: templateHash,
        notes: params.notes || null,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create template version: ${error.message}`);
    }

    return data;
  },
  {
    auth: true,
    schema: z.object({
      accountId: z.string().uuid(),
      projectId: z.string().uuid().optional(),
      templateName: z.string().min(1),
      templateContent: z.record(z.any()),
      versionLabel: z.string().optional(),
      notes: z.string().optional(),
    }),
  }
);

export const getTemplateVersionsAction = enhanceAction(
  async (params) => {
    const client = getSupabaseServerClient();
    
    let query = client
      .from('template_versions')
      .select('*')
      .eq('account_id', params.accountId)
      .eq('template_name', params.templateName)
      .order('version_number', { ascending: false });

    if (params.projectId) {
      query = query.eq('project_id', params.projectId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch template versions: ${error.message}`);
    }

    return data;
  },
  {
    auth: true,
    schema: z.object({
      accountId: z.string().uuid(),
      templateName: z.string().min(1),
      projectId: z.string().uuid().optional(),
    }),
  }
);

export const getTemplatePerformanceComparisonAction = enhanceAction(
  async (params) => {
    const client = getSupabaseServerClient();
    
    const { data, error } = await client
      .from('template_versions')
      .select('id, version_number, version_label, performance_aggregate')
      .eq('account_id', params.accountId)
      .eq('template_name', params.templateName)
      .order('version_number', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch performance comparison: ${error.message}`);
    }

    return data.map(version => ({
      versionId: version.id,
      versionLabel: version.version_label,
      versionNumber: version.version_number,
      ...((version.performance_aggregate as Record<string, any>) || {
        avgViews: 0,
        avgLikes: 0,
        avgWatchTime: 0,
        avgRetention: 0,
        episodeCount: 0,
        avgRevenue: 0
      })
    }));
  },
  {
    auth: true,
    schema: z.object({
      accountId: z.string().uuid(),
      templateName: z.string().min(1),
    }),
  }
);

export const linkEpisodeToTemplateAction = enhanceAction(
  async (params) => {
    const client = getSupabaseServerClient();
    
    const { data, error } = await client
      .from('episode_template_versions')
      .insert({
        episode_id: params.episodeId,
        template_version_id: params.templateVersionId,
        stage: params.stage,
        generation_params: params.generationParams || {},
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to link episode to template: ${error.message}`);
    }
    
    return data;
  },
  {
    auth: true,
    schema: z.object({
      episodeId: z.string().uuid(),
      templateVersionId: z.string().uuid(),
      stage: z.enum(['story', 'screenplay', 'shot_list', 'dialogue', 'music', 'custom']),
      generationParams: z.record(z.any()).optional(),
    }),
  }
);

export const recalculateTemplatePerformanceAction = enhanceAction(
  async (params) => {
    logger.info({ params }, 'Recalculating template performance');
    return { success: true };
  },
  {
    auth: true,
    schema: z.object({
      accountId: z.string().uuid(),
      templateName: z.string().min(1),
    }),
  }
);
