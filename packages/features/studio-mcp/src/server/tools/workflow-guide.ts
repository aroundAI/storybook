import 'server-only';

import { defineTool } from '../../registry';
import { EPISODE_STATUS_ORDER, STAGE_ORDER } from './read/stage-status';

/**
 * How to drive StoryBook over MCP, from an empty team to a published
 * episode (FILM-1905). The same text is the `workflow_guide` prompt, so a
 * client that prefers prompts reads it there.
 */
export const WORKFLOW_GUIDE_TEXT = [
  '# StoryBook workflow over MCP',
  '',
  'StoryBook is the system of record, the validator and the analyzer. Over MCP you write the creative work yourself; the app makes no model call of its own for it.',
  '',
  '## Orientation',
  '',
  '1. `whoami`: the user, the team this connection is bound to, and your scopes (studio:read, studio:write, studio:render).',
  '2. `list_projects` → `get_project`: a project is a series, with its settings (genre, audience, video and content style, default episode duration, language, aesthetic style).',
  '3. `list_episodes` → `get_episode`: an episode carries a status and six stages; `get_episode` says which stage is locked, available or done, and shows the story and a screenplay summary. `get_screenplay`, `get_shots`, `get_dialogue` page the full content by scene. `list_assets` lists the characters and locations.',
  '',
  '## Authoring (studio:write)',
  '',
  'What a person writes by hand: `create_project` and `update_project` (name, description, slug, status, series settings), `create_episode` and `update_episode` (title, logline as description, target duration, content style, visual tone, tone notes; `update_episode` needs the version from `get_episode`), `upsert_asset` (characters and locations with their details). These never write a story, screenplay, shots, dialogue or audio cues.',
  '',
  '## Stages, in order',
  '',
  ...STAGE_ORDER.map(
    (stage, index) =>
      `${index + 1}. **${stage.label}** (${stage.key}): ${stage.needs}`,
  ),
  '',
  `Episode status follows: ${EPISODE_STATUS_ORDER.join(' → ')}. A stage unlocks when the one before it has data.`,
  '',
  '## Generating a stage (studio:write; FILM-1908)',
  '',
  'Generated content goes through a run, never through the author tools:',
  '',
  '1. `start_generation(stage, episodeId)` opens a run in external mode and returns the brief: instructions, context (project settings, characters, locations, the earlier stages), the output JSON Schema, constraints and the quality rubric. The run holds a lease on the episode; a second run on the same target is refused with RUN_IN_PROGRESS.',
  '2. Write the content from the brief. For long stages the brief is split into parts (for shots, one per scene); `get_brief(runId, partKey)` returns one part.',
  '3. `submit_generation(runId, partKey, output)` validates one part against the schema and stores it in the run, not in the episode. A rejection lists the errors field by field; fix and resubmit the same part. Acceptance names the next part to do and returns its brief; a single-part stage (story) is committed on acceptance, so there is nothing to finalize.',
  '4. `finalize_generation(runId)` commits every part in one transaction with the same commit the server mode uses, stamps the origin on what it wrote, and opens any chained run (shots chain audio cues) in the same mode.',
  '5. If you stop, the lease expires, the run is marked expired and nothing half-written reaches the episode. `get_run` inspects a run; `cancel_generation` releases it.',
  '',
  'Media stays vendor-rendered: voice, music and SFX are started with the render tools (studio:render). Video is not rendered in the app; `get_veo_manifest` returns the prompts for an external video tool. Publishing is a web action in this phase.',
  '',
  '## Errors',
  '',
  'Every failure is a tool result with isError and structuredContent {code, message, retryable, details}. Codes: UNAUTHORIZED, FORBIDDEN, NOT_FOUND (a row outside your team reads as not found), VALIDATION_FAILED (details.errors[] by field), RUN_IN_PROGRESS, TARGET_CHANGED (re-read and retry with the new version), RUN_EXPIRED, RATE_LIMITED (details.retry_after_s), INTERNAL.',
].join('\n');

export const getWorkflowGuideTool = defineTool({
  name: 'get_workflow_guide',
  title: 'Workflow guide',
  description:
    'How to drive StoryBook over MCP: the stage order, what each stage needs, which tools author the hand-written inputs, and how a generated stage goes through start_generation, submit_generation and finalize_generation. Read it once per session; it is also the workflow_guide prompt.',
  inputSchema: {},
  scope: 'studio:read',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  async handler() {
    return {
      text: WORKFLOW_GUIDE_TEXT,
      structuredContent: {
        stages: STAGE_ORDER.map((stage) => ({
          key: stage.key,
          label: stage.label,
          needs: stage.needs,
        })),
        statusOrder: EPISODE_STATUS_ORDER,
        authorTools: [
          'create_project',
          'update_project',
          'create_episode',
          'update_episode',
          'upsert_asset',
        ],
        generationTools: [
          'start_generation',
          'get_brief',
          'submit_generation',
          'finalize_generation',
          'get_run',
          'cancel_generation',
        ],
        guide: WORKFLOW_GUIDE_TEXT,
      },
    };
  },
});
