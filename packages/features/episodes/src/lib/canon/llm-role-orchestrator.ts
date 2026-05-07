/**
 * LLM Role Orchestrator
 * Phase 10: FILM-1006
 *
 * Orchestrates multi-role LLM pipeline: Planner → Writer → Editor → Stylist
 * Each role has specific permissions and constraints.
 */
import { executeLLM } from '@kit/prompt-engine/server';

import { validatePlotSkeleton } from './continuity-validator';
import type {
  ContinuityValidationResult,
  LLMRole,
  MemoryContext,
  PlotSkeleton,
  RoleExecutionContext,
  RoleExecutionResult,
} from './types';

/** Maximum retries per role when validation failures occur */
const MAX_ROLE_RETRIES = 2;

// =============================================================================
// TYPES
// =============================================================================

export interface RolePipelineInput {
  projectId: string;
  episodeId: string;
  memoryContext: MemoryContext;
  userPrompt: string;
  targetDuration?: number;
}

export interface RolePipelineResult {
  success: boolean;
  finalOutput: string;
  plotSkeleton?: PlotSkeleton;
  roleResults: RoleExecutionResult[];
  totalTokens: number;
  executionTimeMs: number;
}

// =============================================================================
// ROLE PROMPTS
// =============================================================================

const ROLE_PROMPT_TEMPLATES: Record<LLMRole, string> = {
  planner: 'planner-role',
  writer: 'writer-role',
  editor: 'editor-role',
  stylist: 'stylist-role',
};

// =============================================================================
// ORCHESTRATOR
// =============================================================================

/**
 * Runs the full LLM role pipeline.
 * Planner → Writer → Editor → Stylist
 *
 * Each role receives the output of the previous role and the shared memory context.
 * Validation occurs after each role.
 */
export async function runRolePipeline(
  input: RolePipelineInput,
): Promise<RolePipelineResult> {
  const startTime = Date.now();
  const roleResults: RoleExecutionResult[] = [];
  let totalTokens = 0;
  let currentOutput = '';
  let plotSkeleton: PlotSkeleton | undefined;

  const roles: LLMRole[] = ['planner', 'writer', 'editor', 'stylist'];

  for (const role of roles) {
    const baseConstraints = buildRoleConstraints(role, input.memoryContext);
    const context: RoleExecutionContext = {
      role,
      constraints: [...baseConstraints],
      previousOutput: currentOutput || undefined,
      memoryContext: input.memoryContext,
    };

    let lastResult: RoleExecutionResult | undefined;
    let retries = 0;

    while (retries <= MAX_ROLE_RETRIES) {
      try {
        const result = await executeRole(input, context);
        lastResult = result;
        roleResults.push(result);
        totalTokens += result.tokenUsage;
        currentOutput = result.output;

        // Extract plot skeleton from planner output
        if (role === 'planner') {
          plotSkeleton = extractPlotSkeleton(result.output);
        }

        // Check for error-level violations
        const criticalFailures = result.validationResult.violations.filter(
          (v) => v.severity === 'error',
        );

        if (criticalFailures.length === 0) {
          // Role passed validation — move to next role
          break;
        }

        if (retries >= MAX_ROLE_RETRIES) {
          // Give up after max retries
          return {
            success: false,
            finalOutput: currentOutput,
            plotSkeleton,
            roleResults,
            totalTokens,
            executionTimeMs: Date.now() - startTime,
          };
        }

        // Feed violations back as constraints for the next retry
        retries++;
        context.previousOutput = result.output;
        context.constraints = [
          ...baseConstraints,
          ...criticalFailures.map(
            (v) =>
              `MUST FIX (${v.code}): ${v.message}. Suggestion: ${v.suggestion}`,
          ),
        ];
      } catch (error) {
        console.error(
          `Role ${role} execution failed (attempt ${retries + 1}):`,
          error,
        );
        return {
          success: false,
          finalOutput: currentOutput,
          plotSkeleton,
          roleResults,
          totalTokens,
          executionTimeMs: Date.now() - startTime,
        };
      }
    }

    void lastResult; // suppress unused variable warning
  }

  return {
    success: true,
    finalOutput: currentOutput,
    plotSkeleton,
    roleResults,
    totalTokens,
    executionTimeMs: Date.now() - startTime,
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Executes a single role in the pipeline via executeLLM.
 * Uses role-aware variable mapping to match each template's declared variables.
 */
async function executeRole(
  input: RolePipelineInput,
  context: RoleExecutionContext,
): Promise<RoleExecutionResult> {
  const promptTemplate = ROLE_PROMPT_TEMPLATES[context.role];
  const memoryContext = formatContextForRole(context);

  const variables = buildRoleVariables(context.role, {
    userPrompt: input.userPrompt,
    previousOutput: context.previousOutput ?? '',
    memoryContext,
    constraints: context.constraints.join('\n'),
    targetDuration: input.targetDuration ?? 300,
  });

  const response = await executeLLM({
    templateSlug: `canon-roles/${promptTemplate}`,
    variables,
    context: {
      name: `canon-orchestrator.${context.role}`,
      accountId: input.projectId,
    },
  });

  const output =
    typeof response.data === 'string'
      ? response.data
      : JSON.stringify(response.data);

  const validationResult = await validateRoleOutput(
    context.role,
    output,
    context.memoryContext,
  );

  return {
    role: context.role,
    output,
    validationResult,
    tokenUsage: response.metadata.tokens ?? 0,
    executedAt: new Date().toISOString(),
  };
}

/**
 * Builds role-specific variable maps matching each template's declared variable list.
 */
function buildRoleVariables(
  role: LLMRole,
  args: {
    userPrompt: string;
    previousOutput: string;
    memoryContext: string;
    constraints: string;
    targetDuration: number;
  },
): Record<string, string> {
  const {
    userPrompt,
    previousOutput,
    memoryContext,
    constraints,
    targetDuration,
  } = args;

  switch (role) {
    case 'planner':
      return {
        memoryContext,
        episodeNumber: '1',
        premise: userPrompt,
        targetDuration: String(Math.round(targetDuration / 60)),
        characterList: '',
        activeThreads: constraints,
      };
    case 'writer':
      return {
        memoryContext,
        plannerConstraints: constraints,
        sceneNumber: '1',
        sceneStructure: previousOutput,
        charactersPresent: '',
        scenePurpose: userPrompt,
        dialoguePlaceholder: '',
      };
    case 'editor':
      return {
        memoryContext,
        sceneNumber: '1',
        originalContent: previousOutput,
        characterVoices: '',
        focusAreas: constraints || 'clarity, consistency, emotional resonance',
      };
    case 'stylist':
      return {
        memoryContext,
        content: previousOutput,
        styleConstraints: constraints,
        targetTone: userPrompt,
      };
  }
}

/**
 * Builds role-specific constraints from memory context.
 */
function buildRoleConstraints(
  role: LLMRole,
  memoryContext: MemoryContext,
): string[] {
  const constraints: string[] = [];

  // Common constraints from immutable events
  for (const event of memoryContext.immutableEvents) {
    constraints.push(`IMMUTABLE: ${event.description}`);
  }

  // Role-specific constraints
  switch (role) {
    case 'planner':
      constraints.push('Focus on plot structure and scene breakdown');
      constraints.push('Ensure causal relationships between events');
      for (const thread of memoryContext.activeThreads) {
        constraints.push(
          `Active thread: ${thread.threadName} - ${thread.status}`,
        );
      }
      break;

    case 'writer':
      constraints.push('Expand scenes with dialogue and action');
      constraints.push(
        'Maintain character voices established in prior episodes',
      );
      for (const charState of memoryContext.characterStates) {
        constraints.push(
          `${charState.characterName}: ${charState.constraints.join(', ')}`,
        );
      }
      break;

    case 'editor':
      constraints.push('Polish for continuity and consistency');
      constraints.push('Do not change plot structure');
      break;

    case 'stylist':
      constraints.push('Apply consistent tone and style');
      constraints.push('Ensure voice matches series aesthetic');
      break;
  }

  return constraints;
}

/**
 * Formats memory context for LLM role consumption.
 */
function formatContextForRole(context: RoleExecutionContext): string {
  const { memoryContext, role } = context;
  const sections: string[] = [];

  // Always include immutable events (they're critical)
  if (memoryContext.immutableEvents.length > 0) {
    sections.push('## Immutable Facts');
    for (const event of memoryContext.immutableEvents) {
      sections.push(`- ${event.eventKey}: ${event.description}`);
    }
  }

  // Role-specific context
  if (role === 'planner' || role === 'writer') {
    if (memoryContext.activeThreads.length > 0) {
      sections.push('\n## Active Plot Threads');
      for (const thread of memoryContext.activeThreads) {
        sections.push(`- ${thread.threadName} (${thread.status})`);
      }
    }
  }

  if (role === 'writer' || role === 'editor') {
    if (memoryContext.characterStates.length > 0) {
      sections.push('\n## Character States');
      for (const state of memoryContext.characterStates) {
        sections.push(
          `- ${state.characterName}: ${state.arc ?? 'unknown arc'}`,
        );
      }
    }
  }

  if (memoryContext.recentSummaries.length > 0) {
    sections.push('\n## Recent Episode Summaries');
    for (const summary of memoryContext.recentSummaries.slice(0, 3)) {
      sections.push(`- ${summary.plotSummary}`);
    }
  }

  return sections.join('\n');
}

/**
 * Validates role output against canon rules.
 */
async function validateRoleOutput(
  role: LLMRole,
  output: string,
  memoryContext: MemoryContext,
): Promise<ContinuityValidationResult> {
  // For planner: validate plot skeleton
  if (role === 'planner') {
    const skeleton = extractPlotSkeleton(output);
    if (skeleton) {
      return validatePlotSkeleton(skeleton, memoryContext);
    }
    // Failed to parse plot skeleton - return validation failure
    return {
      valid: false,
      violations: [
        {
          code: 'CANON_010',
          severity: 'error',
          message: 'Could not extract plot skeleton from planner output',
          suggestion:
            'The planner output must contain a valid JSON plot skeleton',
        },
      ],
      passedRules: [],
      summary: { errors: 1, warnings: 0, infos: 0 },
      validatedAt: new Date().toISOString(),
    };
  }

  // For other roles: return valid result
  return {
    valid: true,
    violations: [],
    passedRules: [],
    summary: { errors: 0, warnings: 0, infos: 0 },
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Extracts PlotSkeleton from planner output.
 */
function extractPlotSkeleton(output: string): PlotSkeleton | undefined {
  try {
    // Try to parse JSON from output
    const jsonMatch = output.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch?.[1]) {
      return JSON.parse(jsonMatch[1]) as PlotSkeleton;
    }

    // Try direct JSON parse
    const parsed = JSON.parse(output);
    if (parsed.premise && parsed.scenes) {
      return parsed as PlotSkeleton;
    }
  } catch {
    // Could not extract skeleton - may need to parse differently
  }
  return undefined;
}
