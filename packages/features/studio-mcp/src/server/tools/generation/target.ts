import 'server-only';

import type {
  AnyStageDefinition,
  CheckError,
  TargetType,
} from '@kit/generation';

import { McpToolError } from '../../../errors';
import type { McpPrincipal } from '../../../principal';
import {
  requireEpisodeInAccount,
  requireProjectInAccount,
} from '../read/scope';
import type { OpenRunTarget } from './run-api';

type Client = McpPrincipal['supabase'];

export interface StartTargetInput {
  episodeId?: string;
  projectId?: string;
  assetId?: string;
  sceneNumber?: number;
  options?: Record<string, unknown>;
}

interface EpisodeForTarget {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  version: number | null;
  target_duration_seconds: number | null;
  metadata: unknown;
  project: {
    id: string;
    account_id: string;
    name: string;
    slug: string | null;
  };
}

const EPISODE_COLUMNS =
  'id, project_id, title, description, version, target_duration_seconds, metadata';

/**
 * What an episode already holds that a stage's target names, in the names
 * the stages' target schemas use: the logline is the episode description,
 * and the wizard's creative direction is in metadata (FILM-1905).
 */
function episodeDefaults(episode: EpisodeForTarget): Record<string, unknown> {
  const metadata =
    episode.metadata && typeof episode.metadata === 'object'
      ? (episode.metadata as Record<string, unknown>)
      : {};

  const defaults: Record<string, unknown> = {
    episodeId: episode.id,
    projectId: episode.project_id,
    title: episode.title,
    logline: episode.description ?? '',
  };

  const duration =
    episode.target_duration_seconds ??
    (typeof metadata.target_duration === 'number'
      ? metadata.target_duration
      : undefined);

  if (duration) defaults.targetDuration = duration;

  if (typeof metadata.content_style === 'string') {
    defaults.contentStyle = metadata.content_style;
  }

  if (episode.version !== null) defaults.version = episode.version;

  return defaults;
}

function targetIdFor(
  type: TargetType,
  ids: { episodeId?: string; projectId?: string; assetId?: string },
): string | undefined {
  switch (type) {
    case 'episode':
    case 'scene':
      return ids.episodeId;
    case 'project':
    case 'season':
      return ids.projectId;
    case 'asset':
      return ids.assetId;
    // The titles are the caller's own text; the run locks their episode, as
    // the web's server-mode run does (FILM-1909)
    case 'publish':
      return ids.episodeId;
    default:
      return undefined;
  }
}

const TARGET_ARG: Partial<Record<TargetType, string>> = {
  episode: 'episodeId',
  scene: 'episodeId',
  project: 'projectId',
  season: 'projectId',
  asset: 'assetId',
  publish: 'episodeId',
};

/**
 * The run target for a stage, from the tool's flat input. Every stage is
 * served the same way: what the episode (or project) holds, then the
 * caller's ids, then `options`, parsed by the stage's own target schema.
 * Its refusals come back field by field, so the agent supplies what is
 * missing in `options`; a stage needs no code here to be startable.
 */
export async function resolveStageTarget(
  client: Client,
  caller: { accountId: string; userId: string },
  stage: AnyStageDefinition,
  input: StartTargetInput,
): Promise<{ target: unknown; runTarget: OpenRunTarget }> {
  const { accountId } = caller;
  const argName = TARGET_ARG[stage.targetType as TargetType];

  if (!argName) {
    throw new McpToolError(
      'VALIDATION_FAILED',
      `The ${stage.key} stage works on a ${stage.targetType}, which the MCP tools cannot start yet.`,
      {
        details: {
          errors: [
            {
              path: 'stage',
              code: 'unsupported_target',
              message: `${stage.targetType} targets are not served over MCP`,
            },
          ],
        },
      },
    );
  }

  let candidate: Record<string, unknown> = {};
  let projectId = input.projectId;
  let version: number | null = null;

  if (input.episodeId) {
    const episode = await requireEpisodeInAccount<EpisodeForTarget>(
      client,
      accountId,
      input.episodeId,
      EPISODE_COLUMNS,
    );

    candidate = episodeDefaults(episode);
    projectId = episode.project_id;
    version = episode.version;
  } else if (projectId) {
    await requireProjectInAccount(client, accountId, projectId);
    candidate.projectId = projectId;
  }

  if (input.assetId) {
    const { data: asset, error } = await client
      .from('assets')
      .select('id, project_id, project:projects!inner(account_id)')
      .eq('id', input.assetId)
      .eq('project.account_id', accountId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      throw new McpToolError('INTERNAL', 'Could not read the asset.');
    }

    if (!asset) {
      throw new McpToolError(
        'NOT_FOUND',
        'No asset with this id in your team.',
        {
          details: { assetId: input.assetId },
        },
      );
    }

    candidate.assetId = input.assetId;
    projectId ??= asset.project_id;
  }
  if (input.sceneNumber !== undefined)
    candidate.sceneNumber = input.sceneNumber;

  const ids = {
    episodeId: input.episodeId,
    projectId,
    assetId: input.assetId,
  };
  const targetId = targetIdFor(stage.targetType as TargetType, ids);

  if (!targetId) {
    throw new McpToolError(
      'VALIDATION_FAILED',
      `The ${stage.key} stage needs ${argName}.`,
      {
        details: {
          errors: [
            {
              path: argName,
              code: 'required',
              message: `${argName} is required`,
            },
          ],
        },
      },
    );
  }

  // Who the work is for is the caller, never an option: a stage that names
  // its account or user (shots, audio_cues) gets the MCP principal's
  const parsed = stage.targetSchema.safeParse({
    ...candidate,
    ...(input.options ?? {}),
    accountId,
    userId: caller.userId,
  });

  if (!parsed.success) {
    const errors: CheckError[] = parsed.error.issues.map((issue) => ({
      path: ['options', ...issue.path.map(String)].join('.'),
      code: issue.code,
      message: issue.message,
    }));

    throw new McpToolError(
      'VALIDATION_FAILED',
      `The ${stage.key} stage needs more than the target holds; give the missing fields in options.`,
      { details: { errors } },
    );
  }

  return {
    target: parsed.data,
    runTarget: {
      type:
        stage.targetType === 'publish'
          ? 'episode'
          : (stage.targetType as TargetType),
      id: targetId,
      accountId,
      projectId: projectId ?? null,
      input: { kind: 'stage', target: parsed.data },
      targetVersion: version,
    },
  };
}
