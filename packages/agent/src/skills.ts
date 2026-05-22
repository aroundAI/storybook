/**
 * Skills System
 *
 * Skills are composable bundles of tools + context + instructions
 * that extend an agent's capabilities with domain-specific knowledge.
 *
 * @example
 * ```typescript
 * const continuitySkill: Skill = {
 *   name: 'continuity-validation',
 *   description: 'Validates content against established canon',
 *   tools: [buildMemoryContextTool, checkContinuityTool],
 *   contextPrompt: 'You have access to a continuity validation system...',
 *   instructions: '1. Load memory context\n2. Check continuity after generating...',
 * };
 *
 * const config = applySkills(baseConfig, [continuitySkill, qualitySkill]);
 * ```
 */
import type { AgentConfig, AgentTool, Skill } from './types';

/**
 * Merges skills into an agent configuration.
 *
 * - Deduplicates tools by name (first occurrence wins)
 * - Appends context prompts and instructions to system prompt
 */
export function applySkills(config: AgentConfig, skills: Skill[]): AgentConfig {
  const seenTools = new Set(config.tools.map((t) => t.name));
  const mergedTools: AgentTool[] = [...config.tools];
  const contextBlocks: string[] = [];

  for (const skill of skills) {
    // Add tools (deduplicate by name)
    for (const tool of skill.tools) {
      if (!seenTools.has(tool.name)) {
        seenTools.add(tool.name);
        mergedTools.push(tool);
      }
    }

    // Collect context and instructions
    if (skill.contextPrompt) {
      contextBlocks.push(`## Skill: ${skill.name}\n${skill.contextPrompt}`);
    }

    if (skill.instructions) {
      contextBlocks.push(
        `### ${skill.name} — Instructions\n${skill.instructions}`,
      );
    }
  }

  const skillContext =
    contextBlocks.length > 0
      ? '\n\n# Active Skills\n\n' + contextBlocks.join('\n\n')
      : '';

  return {
    ...config,
    tools: mergedTools,
    systemPrompt: config.systemPrompt + skillContext,
  };
}

/**
 * Creates a skill from its components.
 * Convenience function for type-safe skill creation.
 */
export function createSkill(definition: Skill): Skill {
  return definition;
}
