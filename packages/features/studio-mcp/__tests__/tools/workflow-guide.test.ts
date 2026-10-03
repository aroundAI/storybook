import { describe, expect, it } from 'vitest';

import { defaultPrompts } from '../../src/server/prompts';
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
    ]) {
      expect(WORKFLOW_GUIDE_TEXT).toContain(tool);
    }
    expect(WORKFLOW_GUIDE_TEXT).toMatch(/draft/);
    expect(WORKFLOW_GUIDE_TEXT).toMatch(/published/);
  });

  it('is offered as an MCP prompt with the same text', async () => {
    const prompt = defaultPrompts.find((p) => p.name === 'workflow_guide');
    expect(prompt).toBeDefined();

    const messages = await prompt!.messages({});
    expect(messages[0]?.content.text).toBe(WORKFLOW_GUIDE_TEXT);
  });
});

describe('the default tool list', () => {
  it('holds whoami, the guide, the eight read tools and the five author tools, each name once', () => {
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
        'create_episode',
        'update_episode',
        'upsert_asset',
      ].sort(),
    );
  });
});
