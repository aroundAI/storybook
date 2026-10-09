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
  '3. `list_seasons` → `list_episodes` → `get_episode`: a project holds seasons (which can be empty) and episodes, in a season or Unsorted. An episode carries a status and seven stages; `get_episode` says which stage is done, empty or skipped, what each generator still needs, and the publishReadiness, and shows the story and a screenplay summary. `get_screenplay`, `get_shots`, `get_dialogue` page the full content by scene. `list_assets` lists the characters and locations.',
  '',
  '## Authoring (studio:write)',
  '',
  'What a person writes by hand: `create_project` and `update_project` (name, description, slug, status, series settings), `create_episode` and `update_episode` (title, logline as description, target duration, content style, visual tone, tone notes; `update_episode` needs the version from `get_episode`), `upsert_asset` (characters and locations with their details), `link_assets_to_episode` (the characters and locations an episode uses). The screenplay, shots and audio stages read their cast from those links: link every existing character who speaks and every location a scene uses before you start the screenplay, or the check refuses them as unknown. These never write a story, screenplay, shots, dialogue or audio cues.',
  '',
  '## Seasons (studio:write; FILM-2204)',
  '',
  '`create_season(projectId, name)` makes an empty season; add episodes with `create_episode(seasonId)`, or move one with `update_episode(seasonId)` (null for Unsorted; the episode keeps its number). `update_season`, `reorder_seasons` (every season once) and `delete_season` (its episodes move to Unsorted, none is deleted) are for a project owner or admin and take the version `list_seasons` returned.',
  '',
  '## Three ways to start an episode',
  '',
  '- **From an idea**: `create_episode`, then generate the story, screenplay and shots in order.',
  '- **From a script**: `create_episode`, mark ideation and story skipped with `set_stage_skipped`, then write the screenplay through `start_generation(stage: screenplay)` and `submit_generation`.',
  '- **From a finished video**: `create_episode`, then `request_episode_video_upload`, PUT the file, `finalize_episode_video`; or `link_published_video` for one already on a platform. Skip the stages you will not do.',
  '',
  '## Stages',
  '',
  'Every stage is optional. A generator needs the stages it reads: when they are missing, `start_generation` refuses with MISSING_INPUTS and names them (details.missing). Mark a stage you will not do with `set_stage_skipped`.',
  '',
  ...STAGE_ORDER.map(
    (stage, index) =>
      `${index + 1}. **${stage.label}** (${stage.key}): ${stage.needs}`,
  ),
  '',
  `Episode status follows: ${EPISODE_STATUS_ORDER.join(' → ')}. Attaching a video moves an episode to ready unless it is published.`,
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
  '## Editing one piece (studio:write; FILM-1909)',
  '',
  '`edit_scene`, `edit_shot` and `edit_dialogue_line` change one scene, shot or English line without a new run of the stage. Pass the version from `get_episode`; the edit is checked as the stage checks its output, committed in one transaction with a snapshot to restore from, and fails with TARGET_CHANGED if the episode moved.',
  '',
  'Media stays vendor-rendered: voice, music and SFX are started with `start_voice_render` and `start_audio_render` (studio:render), and `get_render_progress` says where they stand. Video is not rendered in the app; `get_veo_manifest` returns the prompts for an external video tool. Publishing to a platform is a web action: attach the video (`request_episode_video_upload`) or link one already published (`link_published_video`), and `get_episode` publishReadiness says what the web publish will have.',
  '',
  '## Editing in StorybookStudio (studio:read; FILM-2001)',
  '',
  '`get_edit_package(episodeId)` returns everything the desktop editor needs to open an episode as a rough cut, with every media file as a signed download valid for an hour. Pass the `etag` you hold as `ifNoneMatch` to learn cheaply whether anything changed.',
  '',
  '## Errors',
  '',
  'Every failure is a tool result with isError and structuredContent {code, message, retryable, details}. Codes: UNAUTHORIZED, FORBIDDEN, NOT_FOUND (a row outside your team reads as not found), VALIDATION_FAILED (details.errors[] by field), MISSING_INPUTS (details.missing: the stages a generator reads that the episode lacks), RUN_IN_PROGRESS, TARGET_CHANGED (re-read and retry with the new version), RUN_EXPIRED, RATE_LIMITED (details.retry_after_s), INTERNAL.',
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
    openWorldHint: false,
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
          'link_assets_to_episode',
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
