/**
 * Act Context Extraction Skill
 *
 * Wraps the movie/act-context-extraction prompt as an agent-callable tool.
 * Extracts precise continuity data at act boundaries for multi-act movies,
 * capturing character states, open/resolved threads, tone vectors, and
 * carry-forward context for the next act.
 *
 * Called after completing each act to produce a continuity bridge
 * that informs the next act's generation.
 */
import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolError, toolSuccess } from '@kit/agent';

interface CharacterState {
  name: string;
  isAlive: boolean;
  emotionalState: string;
  location: string;
}

interface ActContextBridge {
  characterStates: CharacterState[];
  openThreads: string[];
  resolvedThreads: string[];
  promises: string[];
  currentLocation: {
    name: string;
    presentCharacters: string[];
  };
  toneVector: Record<string, number>;
  stakesLevel: number;
  tensionLevel: number;
  carryForwardContext: string;
}

interface ActContextResult {
  bridge: ActContextBridge;
}

const extractActContextTool = createTool({
  name: 'extractActContext',
  description:
    'Extracts continuity bridge data from a completed act in a multi-act movie. Returns character states (alive/dead, emotional state, location), open/resolved narrative threads, promises to the audience, tone vector, stakes/tension levels, and carry-forward context for the next act. Call after completing each act.',
  parameters: z.object({
    actNumber: z.number().describe('Which act number (1, 2, or 3)'),
    actContent: z.string().describe('The full text of the completed act'),
  }),
  execute: async ({ actNumber, actContent }, context) => {
    try {
      const { executeLLM } = await import('@kit/ai-gateway');

      const result = await executeLLM<ActContextResult>({
        templateSlug: 'movie/act-context-extraction',
        variables: {
          act_number: actNumber.toString(),
          act_content: actContent,
        },
        context: {
          name: 'agent.actContext.extractActContext',
          accountId: context.accountId,
        },
      });

      return toolSuccess(result.data.bridge);
    } catch (error) {
      return toolError(
        `Act context extraction failed: ${(error as Error).message}`,
      );
    }
  },

  // OPT-2: Keep counts + levels + carry-forward, drop per-character and per-thread details
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as unknown as Record<string, unknown>;
    const characters = d.characterStates as CharacterState[] | undefined;
    const openThreads = d.openThreads as string[] | undefined;
    const resolvedThreads = d.resolvedThreads as string[] | undefined;
    return {
      success: true,
      characterCount: characters?.length ?? 0,
      openThreadsCount: openThreads?.length ?? 0,
      resolvedThreadsCount: resolvedThreads?.length ?? 0,
      stakesLevel: d.stakesLevel,
      tensionLevel: d.tensionLevel,
      carryForwardContext: d.carryForwardContext,
    };
  },
});

export const actContextSkill: Skill = {
  name: 'act-context',
  description:
    'Extracts precise continuity data at act boundaries for multi-act movies. Produces a bridge containing character states, narrative threads, tone vectors, and carry-forward context for seamless act transitions.',
  tools: [extractActContextTool],
  contextPrompt: `You have access to an Act Context Extractor for multi-act movie content.

At each act boundary, it captures:
- characterStates: Who is alive/dead, their emotional state, and current location
- openThreads: Narrative threads that remain unresolved and must continue
- resolvedThreads: Threads that were closed in this act
- promises: Setups made to the audience that MUST pay off later
- currentLocation: Where the story ends geographically
- toneVector: Emotional dimensions (tension, humor, drama, etc.) as 0-1 scores
- stakesLevel / tensionLevel: 1-10 scales for pacing calibration
- carryForwardContext: A concise prose summary of everything the next act must know

This data ensures seamless continuity across act boundaries — no dropped threads, no contradictions.`,
  instructions: `1. Call extractActContext after completing each act to capture the continuity bridge
2. Pass the bridge data as context input when generating the next act
3. Ensure openThreads from previous acts are addressed in subsequent acts
4. Use stakesLevel and tensionLevel to calibrate pacing escalation (Act 2 > Act 1, Act 3 > Act 2)
5. Verify promises are tracked — every setup must have a payoff by the final act`,
};
