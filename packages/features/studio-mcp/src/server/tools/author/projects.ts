import 'server-only';

import { z } from 'zod';

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

export const updateProjectTool = defineTool({
  name: 'update_project',
  title: 'Update project',
  description:
    'Changes a project: its name, description, slug or status (active, archived), and the series settings the studio settings page keeps (target audience, genre, video style, content style, default episode duration 60-7200s, content rating, language, recurring elements, aesthetic style). Only the fields given change; settings merge into the existing ones.',
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

    if (
      Object.keys(settings).length === 0 &&
      Object.keys(columns).length === 0
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

    const result = await updateProjectRow(
      client,
      parseWith(UpdateProjectSchema, {
        id: input.projectId,
        ...columns,
        ...(metadata ? { metadata } : {}),
      }),
    );

    if (!result.ok) {
      throw refused(result.refusal, result.field);
    }

    const project = projectSummary(result.data);

    return {
      text: `Updated project "${project.name}": ${[...Object.keys(columns), ...Object.keys(settings)].join(', ')}.`,
      structuredContent: { project },
    };
  },
});
