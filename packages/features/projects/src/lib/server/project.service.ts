import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { z } from 'zod';

import type { Database, Json } from '@kit/supabase/database';

import type {
  CreateProjectSchema,
  UpdateProjectSchema,
} from '../schemas/project.schema';
import type { UpdateStudioSettingsSchema } from '../schemas/studio-settings.schema';
import { TEAM_ONLY, TEAM_ONLY_CODE } from '../team-only';

/**
 * The project writes, with the rules a user can break, callable with any
 * Supabase client: the web's server actions call them with the cookie
 * session's client, the MCP author tools (FILM-1905) with the principal's
 * RLS-scoped one. Authorisation is the database's (RLS) either way.
 *
 * A write the user caused to fail comes back as `{ ok: false, refusal }`,
 * worded for them; a database failure throws.
 */
export type ProjectRow = Database['public']['Tables']['projects']['Row'];

export type ProjectWriteResult =
  | { ok: true; data: ProjectRow }
  | { ok: false; refusal: string; field?: 'slug' | 'account' };

/** Postgres `unique_violation`: the one insert/update failure a user causes. */
export const UNIQUE_VIOLATION = '23505';

export const SLUG_TAKEN =
  'A project with this slug already exists in this workspace. Choose a different slug.';

export async function insertProject(
  client: SupabaseClient<Database>,
  data: z.infer<typeof CreateProjectSchema>,
): Promise<ProjectWriteResult> {
  const { data: project, error } = await client
    .from('projects')
    .insert({
      account_id: data.account_id,
      name: data.name,
      description: data.description,
      slug: data.slug,
      metadata: (data.metadata as Json) || ({} as Json),
    })
    .select()
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { ok: false, refusal: SLUG_TAKEN, field: 'slug' };
    }

    // A personal account (KB-99): the database refuses it, and says why.
    if (error.code === TEAM_ONLY_CODE) {
      return { ok: false, refusal: TEAM_ONLY, field: 'account' };
    }

    throw new Error(`Failed to create project: ${error.message}`);
  }

  return { ok: true, data: project };
}

export async function updateProjectRow(
  client: SupabaseClient<Database>,
  data: z.infer<typeof UpdateProjectSchema>,
): Promise<ProjectWriteResult> {
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.slug !== undefined) updateData.slug = data.slug;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.metadata !== undefined) updateData.metadata = data.metadata as Json;

  const { data: project, error } = await client
    .from('projects')
    .update(updateData)
    .eq('id', data.id)
    .select()
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { ok: false, refusal: SLUG_TAKEN, field: 'slug' };
    }

    throw new Error(`Failed to update project: ${error.message}`);
  }

  return { ok: true, data: project };
}

/**
 * The studio settings page writes its fields into `projects.metadata`, one
 * key each, leaving the rest of the object alone. The same merge for the
 * page and for `update_project` over MCP.
 */
export function mergeStudioSettings(
  existingMetadata: Record<string, unknown> | null | undefined,
  data: Omit<z.infer<typeof UpdateStudioSettingsSchema>, 'projectId'>,
): Record<string, unknown> {
  const updatedMetadata: Record<string, unknown> = {
    ...(existingMetadata ?? {}),
  };

  if (data.targetAudience !== undefined) {
    updatedMetadata.targetAudience = data.targetAudience;
  }
  if (data.genre !== undefined) {
    updatedMetadata.genre = data.genre;
  }
  if (data.videoStyle !== undefined) {
    updatedMetadata.videoStyle = data.videoStyle;
  }
  if (data.contentStyle !== undefined) {
    updatedMetadata.contentStyle = data.contentStyle;
  }
  if (data.defaultEpisodeDuration !== undefined) {
    updatedMetadata.defaultEpisodeDuration = data.defaultEpisodeDuration;
  }
  if (data.contentRating !== undefined) {
    updatedMetadata.contentRating = data.contentRating;
  }
  if (data.language !== undefined) {
    updatedMetadata.language = data.language;
  }
  if (data.recurringElements !== undefined) {
    updatedMetadata.recurringElements = data.recurringElements;
    // Clean up old singular key if it exists (migration compat)
    delete updatedMetadata.recurringElement;
  }
  if (data.projectAestheticStyle !== undefined) {
    updatedMetadata.projectAestheticStyle = data.projectAestheticStyle;
  }

  return updatedMetadata;
}

/** The settings keys `mergeStudioSettings` writes, read back for a project view. */
export const STUDIO_SETTINGS_KEYS = [
  'targetAudience',
  'genre',
  'videoStyle',
  'contentStyle',
  'defaultEpisodeDuration',
  'contentRating',
  'language',
  'recurringElements',
  'projectAestheticStyle',
] as const;
