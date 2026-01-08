'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { TemplateCategorySchema } from '@kit/film-studio-schemas';
import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import type { Json } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type {
  CreateProjectFromTemplateResponse,
  GetTemplatesResponse,
  ProjectTemplate,
  ProjectTemplateRow,
  SaveProjectAsTemplateResponse,
} from '../lib/types/template.types';
import { mapRowToTemplate } from '../lib/types/template.types';

// Inline schemas for server actions to avoid enhanceAction type issues
const GetTemplatesSchema = z.object({
  accountId: z.string().uuid().optional(),
  category: TemplateCategorySchema.optional(),
  includeSystem: z.boolean().optional(),
  includeCustom: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

const GetTemplateSchema = z.object({
  templateId: z.string().uuid(),
});

const DeleteTemplateSchema = z.object({
  templateId: z.string().uuid(),
});

const CreateProjectFromTemplateSchema = z.object({
  templateId: z.string().uuid(),
  accountSlug: z.string().min(1),
  projectName: z.string().min(1).max(255),
  projectDescription: z.string().max(1000).optional(),
});

const SaveProjectAsTemplateSchema = z.object({
  projectId: z.string().uuid(),
  accountId: z.string().uuid(),
  templateName: z.string().min(1).max(255),
  templateDescription: z.string().max(2000).optional(),
  category: TemplateCategorySchema,
  genre: z.string().max(50).optional(),
  isPublic: z.boolean().optional(),
  includeCharacters: z.boolean().optional(),
  includeLocations: z.boolean().optional(),
});

/**
 * Get templates with optional filtering and pagination
 */
export const getTemplatesAction = enhanceAction(
  async (data, user): Promise<GetTemplatesResponse> => {
    const logger = await getLogger();
    const ctx = {
      name: 'templates.get',
      category: data.category,
      userId: user.id,
    };

    logger.info(ctx, 'Fetching templates');

    const client = getSupabaseServerClient();

    const limit = data.limit ?? 50;
    const offset = data.offset ?? 0;

    // Use type assertion for project_templates table (not in generated types yet)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (client as any)
      .from('project_templates')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      .order('usage_count', { ascending: false })
      .range(offset, offset + limit - 1);

    // Filter by category if provided
    if (data.category) {
      query = query.eq('category', data.category);
    }

    // Build OR conditions for template visibility
    const orConditions: string[] = [];
    const includeSystem = data.includeSystem ?? true;
    const includeCustom = data.includeCustom ?? true;

    if (includeSystem) {
      orConditions.push('is_system.eq.true');
    }

    if (includeCustom && data.accountId) {
      orConditions.push(`account_id.eq.${data.accountId}`);
    }

    if (orConditions.length > 0) {
      query = query.or(orConditions.join(','));
    }

    const { data: templates, error, count } = await query;

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch templates');
      throw new Error(`Failed to fetch templates: ${error.message}`);
    }

    const mappedTemplates = (templates as ProjectTemplateRow[]).map(
      mapRowToTemplate,
    );
    const total = count ?? 0;

    logger.info(
      { ...ctx, count: mappedTemplates.length, total },
      'Templates fetched',
    );

    return {
      templates: mappedTemplates,
      total,
      hasMore: total > offset + limit,
    };
  },
  {
    schema: GetTemplatesSchema,
    auth: true,
  },
);

/**
 * Get a single template by ID
 */
export const getTemplateAction = enhanceAction(
  async (data, user): Promise<ProjectTemplate> => {
    const logger = await getLogger();
    const ctx = {
      name: 'templates.getOne',
      templateId: data.templateId,
      userId: user.id,
    };

    logger.info(ctx, 'Fetching template');

    const client = getSupabaseServerClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: template, error } = await (client as any)
      .from('project_templates')
      .select(`
        id, account_id, name, description, category, genre, tags,
        is_system, is_public, usage_count, thumbnail_url, preview_url,
        template_data, created_at, updated_at, deleted_at
      `)
      .eq('id', data.templateId)
      .is('deleted_at', null)
      .single();

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to fetch template');
      throw new Error(`Failed to fetch template: ${error.message}`);
    }

    return mapRowToTemplate(template as ProjectTemplateRow);
  },
  {
    schema: GetTemplateSchema,
    auth: true,
  },
);

/**
 * Soft delete a custom template
 */
export const deleteTemplateAction = enhanceAction(
  async (data, user): Promise<{ success: boolean }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'templates.delete',
      templateId: data.templateId,
      userId: user.id,
    };

    logger.info(ctx, 'Deleting template');

    const client = getSupabaseServerClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (client as any)
      .from('project_templates')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', data.templateId)
      .eq('is_system', false) // Cannot delete system templates
      .is('deleted_at', null);

    if (error) {
      logger.error({ ...ctx, error }, 'Failed to delete template');
      throw new Error(`Failed to delete template: ${error.message}`);
    }

    logger.info(ctx, 'Template deleted');

    revalidatePath('/home/[account]/studio/templates', 'page');

    return { success: true };
  },
  {
    schema: DeleteTemplateSchema,
    auth: true,
  },
);

/**
 * Create a new project from a template
 * Uses server-side redirect after successful creation
 */
export const createProjectFromTemplateAction = enhanceAction(
  async (data, user): Promise<CreateProjectFromTemplateResponse> => {
    const logger = await getLogger();
    const ctx = {
      name: 'templates.createProject',
      templateId: data.templateId,
      userId: user.id,
    };

    logger.info(ctx, 'Creating project from template');

    const client = getSupabaseServerClient();

    // Get the template
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: template, error: templateError } = await (client as any)
      .from('project_templates')
      .select(`
        id, account_id, name, description, category, genre, tags,
        is_system, is_public, usage_count, thumbnail_url, preview_url,
        template_data, created_at, updated_at, deleted_at
      `)
      .eq('id', data.templateId)
      .is('deleted_at', null)
      .single();

    if (templateError || !template) {
      throw new Error('Template not found');
    }

    const templateRow = template as ProjectTemplateRow;

    // Get account ID from slug
    const { data: account, error: accountError } = await client
      .from('accounts')
      .select('id')
      .eq('slug', data.accountSlug)
      .single();

    if (accountError || !account) {
      throw new Error('Account not found');
    }

    const templateData = templateRow.template_data as Record<string, unknown>;
    const projectSettings = templateData.projectSettings as Record<
      string,
      unknown
    >;

    // Create the project with template settings
    const { data: project, error: projectError } = await client
      .from('projects')
      .insert({
        account_id: account.id,
        name: data.projectName,
        description: data.projectDescription ?? null,
        metadata: projectSettings as Json,
        status: 'active',
      })
      .select()
      .single();

    if (projectError || !project) {
      logger.error({ ...ctx, error: projectError }, 'Failed to create project');
      throw new Error(
        `Failed to create project: ${projectError?.message ?? 'Unknown error'}`,
      );
    }

    let charactersCreated = 0;
    let locationsCreated = 0;

    // Create sample characters from template
    const sampleCharacters = (templateData.sampleCharacters ?? []) as Array<
      Record<string, unknown>
    >;
    for (const character of sampleCharacters) {
      const { error: charError } = await client.from('assets').insert({
        project_id: project.id,
        type: 'character',
        name: character.name as string,
        description: (character.description as string) ?? null,
        metadata: {
          physicalAttributes: character.physicalAttributes,
          personality: character.personality,
          role: character.role,
        } as Json,
      });

      if (!charError) {
        charactersCreated++;
      }
    }

    // Create sample locations from template
    const sampleLocations = (templateData.sampleLocations ?? []) as Array<
      Record<string, unknown>
    >;
    for (const location of sampleLocations) {
      const { error: locError } = await client.from('assets').insert({
        project_id: project.id,
        type: 'location',
        name: location.name as string,
        description: (location.description as string) ?? null,
        metadata: {
          visualStyle: location.visualStyle,
          timeOfDay: location.timeOfDay,
          weather: location.weather,
        } as Json,
      });

      if (!locError) {
        locationsCreated++;
      }
    }

    // Increment template usage count atomically using the database function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any).rpc('increment_template_usage', {
      template_id: data.templateId,
    });

    logger.info(
      {
        ...ctx,
        projectId: project.id,
        charactersCreated,
        locationsCreated,
      },
      'Project created from template',
    );

    revalidatePath('/home/[account]/studio', 'page');
    revalidatePath('/home/[account]/studio/templates', 'page');

    // Return the response - client will handle redirect
    return {
      success: true,
      projectId: project.id,
      projectSlug: project.slug ?? project.id,
      assetsCreated: {
        characters: charactersCreated,
        locations: locationsCreated,
      },
    };
  },
  {
    schema: CreateProjectFromTemplateSchema,
    auth: true,
  },
);

/**
 * Save an existing project as a custom template
 */
export const saveProjectAsTemplateAction = enhanceAction(
  async (data, user): Promise<SaveProjectAsTemplateResponse> => {
    const logger = await getLogger();
    const ctx = {
      name: 'templates.saveFromProject',
      projectId: data.projectId,
      userId: user.id,
    };

    logger.info(ctx, 'Saving project as template');

    const client = getSupabaseServerClient();

    // Get the project with its settings
    const { data: project, error: projectError } = await client
      .from('projects')
      .select(`
        id, name, slug, description, account_id, metadata, status, visibility,
        audio_settings, created_by, updated_by, public_slug, seo_metadata,
        created_at, updated_at
      `)
      .eq('id', data.projectId)
      .single();

    if (projectError || !project) {
      throw new Error('Project not found');
    }

    // Build template data
    const templateData: Record<string, unknown> = {
      projectSettings: project.metadata ?? {},
    };

    // Optionally include characters
    const includeCharacters = data.includeCharacters ?? true;
    if (includeCharacters) {
      const { data: characters } = await client
        .from('assets')
        .select('name, description, metadata')
        .eq('project_id', data.projectId)
        .eq('type', 'character')
        .is('deleted_at', null)
        .limit(10);

      if (characters && characters.length > 0) {
        templateData.sampleCharacters = characters.map((c) => ({
          name: c.name,
          description: c.description,
          physicalAttributes: (c.metadata as Record<string, unknown>)
            ?.physicalAttributes,
          personality: (c.metadata as Record<string, unknown>)?.personality,
          role: (c.metadata as Record<string, unknown>)?.role,
        }));
      }
    }

    // Optionally include locations
    const includeLocations = data.includeLocations ?? true;
    if (includeLocations) {
      const { data: locations } = await client
        .from('assets')
        .select('name, description, metadata')
        .eq('project_id', data.projectId)
        .eq('type', 'location')
        .is('deleted_at', null)
        .limit(10);

      if (locations && locations.length > 0) {
        templateData.sampleLocations = locations.map((l) => ({
          name: l.name,
          description: l.description,
          visualStyle: (l.metadata as Record<string, unknown>)?.visualStyle,
          timeOfDay: (l.metadata as Record<string, unknown>)?.timeOfDay,
          weather: (l.metadata as Record<string, unknown>)?.weather,
        }));
      }
    }

    // Create the template
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: templateResult, error: templateError } = await (client as any)
      .from('project_templates')
      .insert({
        account_id: data.accountId,
        name: data.templateName,
        description: data.templateDescription ?? null,
        category: data.category,
        genre: data.genre ?? null,
        is_system: false,
        is_public: data.isPublic ?? false,
        template_data: templateData as Json,
      })
      .select()
      .single();

    if (templateError) {
      logger.error({ ...ctx, error: templateError }, 'Failed to save template');
      throw new Error(`Failed to save template: ${templateError.message}`);
    }

    const templateRow = templateResult as ProjectTemplateRow;

    logger.info(
      { ...ctx, templateId: templateRow.id },
      'Project saved as template',
    );

    revalidatePath('/home/[account]/studio/templates', 'page');

    return {
      success: true,
      templateId: templateRow.id,
    };
  },
  {
    schema: SaveProjectAsTemplateSchema,
    auth: true,
  },
);
