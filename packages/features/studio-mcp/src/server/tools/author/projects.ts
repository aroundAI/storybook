import 'server-only';

import { ZodError, z } from 'zod';

import {
  BrandPatchSchema,
  EditPolicyPatchSchema,
  applyBrandPatch,
  applyEditPolicyPatch,
  readStoredBrand,
  readStoredEditPolicy,
} from '@kit/desktop-integration';
import { findForeignBrandAssetIds } from '@kit/desktop-integration/server';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
} from '@kit/projects/schemas';
import { UpdateStudioSettingsSchema } from '@kit/projects/schemas/studio-settings';
import {
  insertProject,
  mergeStudioSettings,
  updateProjectRow,
} from '@kit/projects/service';

import { McpToolError } from '../../../errors';
import { defineTool } from '../../../registry';
import {
  PROJECT_COLUMNS,
  type ProjectRowLike,
  brandAndEditPolicy,
  projectSummary,
} from '../read/projects';
import { requireProjectInAccount } from '../read/scope';
import { compact, parseWith, refused } from '../validation';

const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/**
 * The fields the create-project form takes, minus the team: over MCP the
 * team is the connection's, never an argument.
 */
const { name, description, slug } = CreateProjectSchema.shape;

export const createProjectTool = defineTool({
  name: 'create_project',
  title: 'Create project',
  description:
    'Creates a project (a series) in the team this connection is bound to, validated as the web form is: name 1-255 characters, optional description up to 1000, optional slug of lowercase letters, digits and hyphens. Series settings are set afterwards with update_project.',
  inputSchema: { name, description, slug },
  scope: 'studio:write',
  annotations: WRITE,
  async handler(input, context) {
    const data = parseWith(CreateProjectSchema, {
      account_id: context.accountId,
      ...compact(input),
    });

    const result = await insertProject(context.principal.supabase, data);

    if (!result.ok) {
      if (result.field === 'account') {
        throw new McpToolError('FORBIDDEN', result.refusal);
      }

      throw refused(result.refusal, result.field);
    }

    const project = projectSummary(result.data);

    return {
      text: `Created project "${project.name}" (${project.id}).`,
      structuredContent: { project },
    };
  },
});

const {
  name: updateName,
  description: updateDescription,
  slug: updateSlug,
  status,
} = UpdateProjectSchema.shape;

const {
  targetAudience,
  genre,
  videoStyle,
  contentStyle,
  defaultEpisodeDuration,
  contentRating,
  language,
  recurringElements,
  projectAestheticStyle,
} = UpdateStudioSettingsSchema.shape;

const SETTINGS_KEYS = [
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

/**
 * A brand or policy patch merged onto the stored object and validated whole
 * (FILM-2004), with a refusal in the error contract, its paths under the
 * argument's name.
 */
function mergedOrRefused<T>(argument: string, merge: () => T): T {
  try {
    return merge();
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;

    throw new McpToolError('VALIDATION_FAILED', 'The input was refused.', {
      details: {
        errors: error.issues.map((issue) => ({
          path: [argument, ...issue.path],
          message: issue.message,
        })),
      },
    });
  }
}

export const updateProjectTool = defineTool({
  name: 'update_project',
  title: 'Update project',
  description:
    'Changes a project: its name, description, slug or status (active, archived), and the series settings the studio settings page keeps (target audience, genre, video style, content style, default episode duration 60-7200s, content rating, language, recurring elements, aesthetic style), and the brand and edit policy the StorybookStudio editor follows (FILM-2004). Only the fields given change; settings merge into the existing ones, and brand and editPolicy merge group by group (colors.captionText alone changes only that colour). get_project returns both with every default applied.',
  inputSchema: {
    projectId: z
      .string()
      .uuid()
      .describe('The project id (from list_projects).'),
    name: updateName,
    description: updateDescription,
    slug: updateSlug,
    status,
    targetAudience,
    genre,
    videoStyle,
    contentStyle,
    defaultEpisodeDuration,
    contentRating,
    language,
    recurringElements,
    projectAestheticStyle,
    brand: BrandPatchSchema.optional().describe(
      'Brand fields to change: fonts {heading, body}; colors {primary, secondary, background, captionText, captionBackground} as #RRGGBB or #RRGGBBAA; captionStyle {fontSize 12-200, position top|center|bottom, maxCharsPerLine 10-80, background none|box|outline, emphasis none|color|scale}; logo {assetId, position, opacity 0-1}; introAssetId; outroAssetId; transitionStyle cut|dissolve|dip; musicStyle tags.',
    ),
    editPolicy: EditPolicyPatchSchema.optional().describe(
      'Edit policy fields to change: targetDurationSeconds 60-7200 or null (the episode target); minShotLength and maxShotLength 0.5-30 s, min <= max; transitions {preferred of cut|dissolve|dip, maxDuration 0-2 s}; music {enabled, duckUnderDialogue, duckDb -40..0}; captions {enabled, style brand|plain}; visual {avoidRepeatedShots, avoidExtremeZoom}; loudnessTargetLufs -31..-5.',
    ),
  },
  scope: 'studio:write',
  annotations: { ...WRITE, idempotentHint: true },
  async handler(input, context) {
    const client = context.principal.supabase;
    const current = await requireProjectInAccount<ProjectRowLike>(
      client,
      context.accountId,
      input.projectId,
      PROJECT_COLUMNS,
    );

    const settings = compact(
      Object.fromEntries(SETTINGS_KEYS.map((key) => [key, input[key]])),
    );
    const columns = compact({
      name: input.name,
      description: input.description,
      slug: input.slug,
      status: input.status,
    });

    const { brand: brandPatch, editPolicy: policyPatch } = input;
    const brand = brandPatch
      ? mergedOrRefused('brand', () =>
          applyBrandPatch(readStoredBrand(current.brand).value, brandPatch),
        )
      : undefined;
    const editPolicy = policyPatch
      ? mergedOrRefused('editPolicy', () =>
          applyEditPolicyPatch(
            readStoredEditPolicy(current.edit_policy).value,
            policyPatch,
          ),
        )
      : undefined;
    const settingsColumns = compact({ brand, edit_policy: editPolicy });

    if (brand) {
      const foreign = await findForeignBrandAssetIds(
        client,
        input.projectId,
        brand,
      );

      if (foreign.length > 0) {
        throw refused(
          `The logo, intro and outro must be assets of this project: ${foreign.join(', ')} is not.`,
          'brand',
        );
      }
    }

    if (
      Object.keys(settings).length === 0 &&
      Object.keys(columns).length === 0 &&
      Object.keys(settingsColumns).length === 0
    ) {
      throw refused('Give at least one field to change.');
    }

    const metadata =
      Object.keys(settings).length > 0
        ? mergeStudioSettings(
            current.metadata as Record<string, unknown> | null,
            parseWith(UpdateStudioSettingsSchema, {
              projectId: input.projectId,
              ...settings,
            }),
          )
        : undefined;

    const result = await updateProjectRow(client, {
      ...parseWith(UpdateProjectSchema, {
        id: input.projectId,
        ...columns,
        ...(metadata ? { metadata } : {}),
      }),
      ...settingsColumns,
    });

    if (!result.ok) {
      throw refused(result.refusal, result.field);
    }

    const project = projectSummary(result.data);
    const changed = [
      ...Object.keys(columns),
      ...Object.keys(settings),
      ...(brand ? ['brand'] : []),
      ...(editPolicy ? ['editPolicy'] : []),
    ];

    return {
      text: `Updated project "${project.name}": ${changed.join(', ')}.`,
      structuredContent: {
        project,
        ...(brand || editPolicy ? brandAndEditPolicy(result.data) : {}),
      },
    };
  },
});
