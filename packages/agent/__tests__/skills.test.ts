import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { applySkills, createSkill } from '../src/skills';
import { createTool } from '../src/tool';
import type { AgentConfig, Skill } from '../src/types';

function makeBaseConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    name: 'test-agent',
    systemPrompt: 'You are a test agent.',
    tools: [],
    maxSteps: 5,
    budgetLimits: {
      maxTotalTokens: 10000,
      maxCostUSD: 1.0,
      maxLatencyMs: 60000,
    },
    ...overrides,
  };
}

function makeTool(name: string) {
  return createTool({
    name,
    description: `Test tool: ${name}`,
    parameters: z.object({ input: z.string() }),
    execute: async ({ input }) => ({ success: true, data: input }),
  });
}

function makeSkill(
  name: string,
  toolNames: string[],
  options?: Partial<Skill>,
): Skill {
  return createSkill({
    name,
    description: `Test skill: ${name}`,
    tools: toolNames.map(makeTool),
    ...options,
  });
}

describe('Skills System', () => {
  describe('applySkills', () => {
    it('should merge skill tools into config', () => {
      const config = makeBaseConfig();
      const skill = makeSkill('test-skill', ['tool-a', 'tool-b']);

      const result = applySkills(config, [skill]);

      expect(result.tools).toHaveLength(2);
      expect(result.tools.map((t) => t.name)).toEqual(['tool-a', 'tool-b']);
    });

    it('should preserve existing config tools', () => {
      const config = makeBaseConfig({
        tools: [makeTool('existing-tool')],
      });
      const skill = makeSkill('test-skill', ['new-tool']);

      const result = applySkills(config, [skill]);

      expect(result.tools).toHaveLength(2);
      expect(result.tools.map((t) => t.name)).toEqual([
        'existing-tool',
        'new-tool',
      ]);
    });

    it('should deduplicate tools by name', () => {
      const config = makeBaseConfig({
        tools: [makeTool('shared-tool')],
      });
      const skill = makeSkill('test-skill', ['shared-tool', 'unique-tool']);

      const result = applySkills(config, [skill]);

      expect(result.tools).toHaveLength(2);
      expect(result.tools.map((t) => t.name)).toEqual([
        'shared-tool',
        'unique-tool',
      ]);
    });

    it('should deduplicate across multiple skills', () => {
      const config = makeBaseConfig();
      const skill1 = makeSkill('skill-1', ['tool-a', 'tool-b']);
      const skill2 = makeSkill('skill-2', ['tool-b', 'tool-c']);

      const result = applySkills(config, [skill1, skill2]);

      expect(result.tools).toHaveLength(3);
      expect(result.tools.map((t) => t.name)).toEqual([
        'tool-a',
        'tool-b',
        'tool-c',
      ]);
    });

    it('should append context prompts to system prompt', () => {
      const config = makeBaseConfig({
        systemPrompt: 'Base prompt.',
      });
      const skill = makeSkill('continuity', [], {
        contextPrompt: 'Check canon before generating.',
      });

      const result = applySkills(config, [skill]);

      expect(result.systemPrompt).toContain('Base prompt.');
      expect(result.systemPrompt).toContain('Check canon before generating.');
      expect(result.systemPrompt).toContain('Skill: continuity');
    });

    it('should append instructions to system prompt', () => {
      const config = makeBaseConfig();
      const skill = makeSkill('quality', [], {
        instructions: '1. Evaluate quality\n2. Revise if needed',
      });

      const result = applySkills(config, [skill]);

      expect(result.systemPrompt).toContain('1. Evaluate quality');
      expect(result.systemPrompt).toContain('quality — Instructions');
    });

    it('should not modify original config', () => {
      const config = makeBaseConfig({ tools: [makeTool('original')] });
      const skill = makeSkill('test', ['new-tool']);

      applySkills(config, [skill]);

      expect(config.tools).toHaveLength(1);
      expect(config.tools[0]!.name).toBe('original');
    });

    it('should handle empty skills array', () => {
      const config = makeBaseConfig({ tools: [makeTool('tool-a')] });

      const result = applySkills(config, []);

      expect(result.tools).toHaveLength(1);
      expect(result.systemPrompt).toBe(config.systemPrompt);
    });

    it('should handle skills with no context or instructions', () => {
      const config = makeBaseConfig();
      const skill = makeSkill('bare-skill', ['tool-x']);

      const result = applySkills(config, [skill]);

      expect(result.tools).toHaveLength(1);
      // No extra context should be appended
      expect(result.systemPrompt).toBe(config.systemPrompt);
    });
  });

  describe('createSkill', () => {
    it('should return the skill definition as-is', () => {
      const skill = createSkill({
        name: 'test',
        description: 'A test skill',
        tools: [],
      });

      expect(skill.name).toBe('test');
      expect(skill.description).toBe('A test skill');
      expect(skill.tools).toEqual([]);
    });
  });
});
