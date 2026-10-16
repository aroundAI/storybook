import { describe, expect, it } from 'vitest';

import { defaultPrompts } from '../../src/server/prompts';
import { analyticsTools } from '../../src/server/tools/analytics';
import { defaultTools } from '../../src/server/tools/index';
import {
  WORKFLOW_GUIDE_TEXT,
  getWorkflowGuideTool,
} from '../../src/server/tools/workflow-guide';
import { createFakeClient, fakeContext } from '../helpers/fake-supabase';

describe('get_workflow_guide', () => {
  it('is a studio:read tool that returns the stage order and the brief/submit/finalize path', async () => {
    expect(getWorkflowGuideTool.scope).toBe('studio:read');
    expect(getWorkflowGuideTool.annotations.readOnlyHint).toBe(true);

    const fake = createFakeClient();
    const result = await getWorkflowGuideTool.handler(
      {},
      fakeContext(fake.client),
    );

    expect(fake.calls).toHaveLength(0);

    const stages = result.structuredContent.stages as Array<{ key: string }>;
    expect(stages.map((s) => s.key)).toEqual([
      'ideation',
      'story',
      'screenplay',
      'shots',
      'audio',
      'video',
      'publish',
    ]);

    expect(result.text).toBe(WORKFLOW_GUIDE_TEXT);
    for (const tool of [
      'start_generation',
      'submit_generation',
      'finalize_generation',
      'create_project',
      'create_episode',
      'upsert_asset',
      'get_episode',
      // FILM-2204
      'create_season',
      'set_stage_skipped',
      'import_screenplay',
      'request_episode_video_upload',
      'finalize_episode_video',
      'link_published_video',
      // Shorts groups and scheduling (FILM-2207)
      'upsert_shorts_group',
      'delete_shorts_group',
      'list_episode_publishes',
      'schedule_publish',
      'cancel_scheduled_publish',
      'studio:publish',
      'MISSING_INPUTS',
    ]) {
      expect(WORKFLOW_GUIDE_TEXT).toContain(tool);
    }
    // No stage is locked any more (FILM-2204)
    expect(WORKFLOW_GUIDE_TEXT).not.toMatch(/unlock/);
    expect(WORKFLOW_GUIDE_TEXT).toMatch(/draft/);
    expect(WORKFLOW_GUIDE_TEXT).toMatch(/published/);
  });

  it('names only tools that exist, in backticks', () => {
    const named = [
      ...WORKFLOW_GUIDE_TEXT.matchAll(/`([a-z]+(?:_[a-z]+)+)(?:\(|`)/g),
    ]
      .map((match) => match[1]!)
      .filter((name) => !['startFrom', 'followUpOf'].includes(name));
    const tools = new Set(defaultTools.map((tool) => tool.name));

    expect(named.filter((name) => !tools.has(name))).toEqual([]);
  });

  it('is offered as an MCP prompt with the same text', async () => {
    const prompt = defaultPrompts.find((p) => p.name === 'workflow_guide');
    expect(prompt).toBeDefined();

    const messages = await prompt!.messages({});
    expect(messages[0]?.content.text).toBe(WORKFLOW_GUIDE_TEXT);
  });
});

describe('the default tool list', () => {
  it('holds whoami, the guide, the eight read tools, the six author tools, the analytics tools, the seven generation tools, the four render tools, the three edit tools, the Studio tools and the five publish tools, each name once', () => {
    const names = defaultTools.map((tool) => tool.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual(
      [
        'whoami',
        'get_workflow_guide',
        'list_projects',
        'get_project',
        'list_episodes',
        'get_episode',
        'get_screenplay',
        'get_shots',
        'get_dialogue',
        'list_assets',
        'create_project',
        'update_project',
        // FILM-2204's seasons, skipped stages and finished videos
        'list_seasons',
        'create_season',
        'update_season',
        'reorder_seasons',
        'delete_season',
        'set_stage_skipped',
        'import_screenplay',
        'request_episode_video_upload',
        'finalize_episode_video',
        'link_published_video',
        'create_episode',
        'update_episode',
        'upsert_asset',
        'link_assets_to_episode',
        // FILM-1909's render tools
        'start_voice_render',
        'start_audio_render',
        'get_render_progress',
        'get_veo_manifest',
        // FILM-1909's edit tools
        'edit_scene',
        'edit_shot',
        'edit_dialogue_line',
        // FILM-2002's StorybookStudio session tools
        'open_edit_session',
        'record_edit_events',
        'close_edit_session',
        // FILM-2003's StorybookStudio delivery tools
        'request_render_upload',
        'finalize_render',
        'deliver_edit',
        // FILM-1906's list, pinned by name in analytics-catalogue.test.ts.
        ...analyticsTools.map((tool) => tool.name),
        'start_generation',
        'get_brief',
        'submit_generation',
        'finalize_generation',
        'get_run',
        'cancel_generation',
        'get_generation_history',
        // FILM-2001's edit package
        'get_edit_package',
        'regenerate_shots',
        'localize_episode',
        // Scheduling publishes (owner, 2026-10-10)
        'list_episode_publishes',
        'upsert_shorts_group',
        'delete_shorts_group',
        'schedule_publish',
        'cancel_scheduled_publish',
      ].sort(),
    );
  });
});
