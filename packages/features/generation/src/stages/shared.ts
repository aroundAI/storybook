/**
 * What the episode stages have in common: loading the episode's context
 * through the caller's seam, reading the row's version, and the season
 * line every episode prompt opens with.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { z } from 'zod';

import {
  type ProjectType,
  ProjectTypeSchema,
} from '@kit/film-studio-schemas/project';
import type { Database } from '@kit/supabase/database';

import type { CheckError, Ctx, EpisodeContextSnapshot } from '../types';

export const uuid = z.string().uuid();

export async function loadEpisodeContext(
  ctx: Ctx,
  episodeId: string,
  options: { semanticQuery?: string } = {},
): Promise<EpisodeContextSnapshot> {
  if (!ctx.episodeContext) {
    throw new Error(
      'This stage needs ctx.episodeContext: the caller supplies the episode context loader',
    );
  }

  return ctx.episodeContext(episodeId, options);
}

export interface EpisodeRow {
  id: string;
  version: number | null;
  status: string;
  deleted_at: string | null;
  metadata: unknown;
}

/** The episode's row, or null when it is gone (deleted or never existed). */
export async function readEpisode(
  client: SupabaseClient<Database>,
  episodeId: string,
): Promise<EpisodeRow | null> {
  const { data, error } = await client
    .from('episodes')
    .select('id, version, status, deleted_at, metadata')
    .eq('id', episodeId)
    .single();

  if (error || !data) return null;

  return data as EpisodeRow;
}

/** "This is Episode N of Season M. Season Premise: …", or '' */
export function seasonLine(snapshot: EpisodeContextSnapshot): string {
  return snapshot.seasonPremise
    ? `This is Episode ${snapshot.episodeNumber}${snapshot.seasonNumber ? ` of Season ${snapshot.seasonNumber}` : ''}. Season Premise: ${snapshot.seasonPremise}`
    : '';
}

/** The snapshot's project type, when it names a known one. */
export function projectTypeOf(
  snapshot: EpisodeContextSnapshot,
): ProjectType | undefined {
  const parsed = ProjectTypeSchema.safeParse(snapshot.projectType);
  return parsed.success ? parsed.data : undefined;
}

export function directionNotes(snapshot: EpisodeContextSnapshot): string {
  return snapshot.seasonDirectionNotes
    ? `\n\n## SEASON CREATIVE DIRECTION (apply to this episode):\n${snapshot.seasonDirectionNotes}`
    : '';
}

export function checkError(
  path: string,
  code: string,
  message: string,
): CheckError {
  return { path, code, message };
}

/** The names a project knows under one asset type, lower-cased. */
export async function projectAssetNames(
  client: SupabaseClient<Database>,
  projectId: string,
  type: 'character' | 'location',
): Promise<Set<string>> {
  const { data } = await client
    .from('assets')
    .select('name')
    .eq('project_id', projectId)
    .eq('type', type)
    .is('deleted_at', null);

  return new Set(
    ((data ?? []) as Array<{ name: string }>).map((row) =>
      row.name.toLowerCase(),
    ),
  );
}

/** Project text on its way to a prompt, defused (KB-101). */
export function projectMetadataOf(
  project: { metadata: unknown } | null | undefined,
): Record<string, unknown> {
  return (project?.metadata as Record<string, unknown>) ?? {};
}

export const ASSET_NAME_MAX = 255;
export const EPISODE_TITLE_MAX = 255;
