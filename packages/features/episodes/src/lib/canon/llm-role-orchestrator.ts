/**
 * LLM Role Orchestrator
 * Phase 10: FILM-1006
 *
 * Orchestrates multi-role LLM pipeline: Planner → Writer → Editor → Stylist
 * Each role has specific permissions and constraints.
 */

import type {
    LLMRole,
    MemoryContext,
    PlotSkeleton,
    RoleExecutionContext,
    RoleExecutionResult,
    ContinuityValidationResult,
} from './types';
import { ROLE_PERMISSIONS } from './types';
import { validatePlotSkeleton } from './continuity-validator';

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
    input: RolePipelineInput
): Promise<RolePipelineResult> {
    const startTime = Date.now();
    const roleResults: RoleExecutionResult[] = [];
    let totalTokens = 0;
    let currentOutput = '';
    let plotSkeleton: PlotSkeleton | undefined;

    const roles: LLMRole[] = ['planner', 'writer', 'editor', 'stylist'];

    for (const role of roles) {
        const context: RoleExecutionContext = {
            role,
            constraints: buildRoleConstraints(role, input.memoryContext),
            previousOutput: currentOutput || undefined,
            memoryContext: input.memoryContext,
        };

        try {
            const result = await executeRole(input, context);
            roleResults.push(result);
            totalTokens += result.tokenUsage;
            currentOutput = result.output;

            // Extract plot skeleton from planner output
            if (role === 'planner') {
                plotSkeleton = extractPlotSkeleton(result.output);
            }

            // Check for error-level violations
            const criticalFailures = result.validationResult.violations.filter(
                (v) => v.severity === 'error'
            );

            if (criticalFailures.length > 0) {
                return {
                    success: false,
                    finalOutput: currentOutput,
                    plotSkeleton,
                    roleResults,
                    totalTokens,
                    executionTimeMs: Date.now() - startTime,
                };
            }
        } catch (error) {
            console.error(`Role ${role} execution failed:`, error);
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
 * Executes a single role in the pipeline.
 * Note: This is a stub that should be connected to actual LLM execution.
 */
async function executeRole(
    input: RolePipelineInput,
    context: RoleExecutionContext
): Promise<RoleExecutionResult> {
    const _promptTemplate = ROLE_PROMPT_TEMPLATES[context.role];

    // Build LLM input with role-specific context
    const _llmInput = {
        user_prompt: input.userPrompt,
        previous_output: context.previousOutput ?? '',
        memory_context: formatContextForRole(context),
        constraints: context.constraints.join('\n'),
        permissions: ROLE_PERMISSIONS[context.role],
    };

    // TODO: Connect to actual LLM execution via @kit/prompt-engine
    // const response = await executeLLM({
    //     promptKey: `story-generation/${promptTemplate}`,
    //     input: llmInput,
    // });

    // Stub response for now
    const response = {
        result: context.previousOutput ?? 'Generated content placeholder',
        usage: { totalTokens: 100 },
    };

    // Validate output
    const validationResult = await validateRoleOutput(
        context.role,
        response.result,
        context.memoryContext
    );

    return {
        role: context.role,
        output: response.result,
        validationResult,
        tokenUsage: response.usage?.totalTokens ?? 0,
        executedAt: new Date().toISOString(),
    };
}

/**
 * Builds role-specific constraints from memory context.
 */
function buildRoleConstraints(
    role: LLMRole,
    memoryContext: MemoryContext
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
                constraints.push(`Active thread: ${thread.threadName} - ${thread.status}`);
            }
            break;

        case 'writer':
            constraints.push('Expand scenes with dialogue and action');
            constraints.push('Maintain character voices established in prior episodes');
            for (const charState of memoryContext.characterStates) {
                constraints.push(
                    `${charState.characterName}: ${charState.constraints.join(', ')}`
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
                sections.push(`- ${state.characterName}: ${state.arc ?? 'unknown arc'}`);
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
    memoryContext: MemoryContext
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
            violations: [{
                code: 'CANON_010',
                severity: 'error',
                message: 'Could not extract plot skeleton from planner output',
                suggestion: 'The planner output must contain a valid JSON plot skeleton',
            }],
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
