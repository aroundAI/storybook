import 'server-only';

import type { PromptMessage } from '@modelcontextprotocol/sdk/types.js';

import { WORKFLOW_GUIDE_TEXT } from './tools/workflow-guide';

/**
 * MCP prompts the server offers beside its tools. Tools carry the workflow
 * (EDD "Tools are the surface"); a prompt is a second way to read the same
 * text for clients that surface prompts to the user.
 */
export type McpPromptMessage = PromptMessage;

export interface McpPromptDefinition {
  name: string;
  title: string;
  description: string;
  messages(args: Record<string, string>): McpPromptMessage[];
}

export const workflowGuidePrompt: McpPromptDefinition = {
  name: 'workflow_guide',
  title: 'StoryBook workflow guide',
  description:
    'The stage order, what each stage needs, and how brief, submit and finalize work; the same text get_workflow_guide returns.',
  messages() {
    return [
      { role: 'user', content: { type: 'text', text: WORKFLOW_GUIDE_TEXT } },
    ];
  },
};

export const defaultPrompts: McpPromptDefinition[] = [workflowGuidePrompt];
