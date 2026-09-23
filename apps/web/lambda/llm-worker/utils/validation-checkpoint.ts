/**
 * Validation Checkpoint Utility
 * Phase 11.1: FILM-1104
 *
 * Runs continuity validation at generation checkpoints (STORY, SCREENPLAY).
 * Supports enforcement levels:
 *   - strict: errors block generation (throws)
 *   - flexible: errors are logged as warnings, generation continues
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  validatePlotSkeleton,
  validateSceneBlocks,
} from '@kit/episodes/lib/canon/continuity-validator';
import { buildMemoryContext } from '@kit/episodes/lib/canon/memory-context-builder';

// Re-export types consumers need
export type EnforcementLevel = 'strict' | 'flexible';

export interface ValidationCheckpointConfig {
  /** The checkpoint type (STORY or SCREENPLAY) */
  checkpoint: 'STORY' | 'SCREENPLAY';
  /** Whether validation errors should block (strict) or warn (flexible) */
  enforcement: EnforcementLevel;
  /** Project ID for loading canon context */
  projectId: string;
  /** Episode number for the memory context scope */
  episodeNumber: number;
  /** Supabase client for database access */
  supabase: SupabaseClient;
}

export interface ValidationCheckpointResult {
  /** Whether validation passed (no errors in strict mode, always true in flexible) */
  passed: boolean;
  /** Total violations found */
  totalViolations: number;
  /** Violations by severity */
  summary: { errors: number; warnings: number; infos: number };
  /** Human-readable validation messages */
  messages: string[];
  /** Whether canon data was available for validation */
  canonAvailable: boolean;
}

/**
 * Runs a continuity validation checkpoint during content generation.
 *
 * For STORY checkpoints: validates a plot skeleton (scenes, characters, themes).
 * For SCREENPLAY checkpoints: validates scene blocks (scene content).
 *
 * @param config - Checkpoint configuration
 * @param contentData - The content to validate
 * @returns Validation result with pass/fail status and messages
 */
export async function runValidationCheckpoint(
  config: ValidationCheckpointConfig,
  contentData: {
    /** For STORY: story output with scenes, characters, themes */
    plotSkeleton?: {
      premise: string;
      episodeNumber: number;
      scenes: Array<{
        sceneNumber: number;
        summary: string;
        charactersPresent: string[];
        keyEvents?: string[];
      }>;
      characters: Array<{
        characterId: string;
        name: string;
        role: string;
        emotionalArc?: string;
      }>;
    };
    /** For SCREENPLAY: scene blocks with content */
    sceneBlocks?: Array<{ sceneNumber: number; content: string }>;
  },
): Promise<ValidationCheckpointResult> {
  const emptyResult: ValidationCheckpointResult = {
    passed: true,
    totalViolations: 0,
    summary: { errors: 0, warnings: 0, infos: 0 },
    messages: [],
    canonAvailable: false,
  };

  try {
    // 1. Build memory context to get canon data
    const memoryCtx = await buildMemoryContext({
      projectId: config.projectId,
      episodeNumber: config.episodeNumber,
    });

    // 2. Run appropriate validation based on checkpoint type
    let validationResult;

    if (config.checkpoint === 'STORY' && contentData.plotSkeleton) {
      validationResult = validatePlotSkeleton(
        contentData.plotSkeleton,
        memoryCtx,
      );
    } else if (config.checkpoint === 'SCREENPLAY' && contentData.sceneBlocks) {
      validationResult = validateSceneBlocks(
        contentData.sceneBlocks,
        memoryCtx,
      );
    } else {
      console.warn(
        `[Validation Checkpoint] No matching content for checkpoint ${config.checkpoint}`,
      );
      return emptyResult;
    }

    // 4. Format results
    const messages: string[] = [];
    for (const violation of validationResult.violations) {
      const prefix =
        violation.severity === 'error'
          ? '❌'
          : violation.severity === 'warning'
            ? '⚠️'
            : 'ℹ️';
      messages.push(`${prefix} [${violation.code}] ${violation.message}`);
      if (violation.suggestion) {
        messages.push(`   → ${violation.suggestion}`);
      }
    }

    console.log(
      `[Validation Checkpoint] ${config.checkpoint}: ${validationResult.summary.errors} errors, ${validationResult.summary.warnings} warnings, ${validationResult.summary.infos} infos`,
    );

    // 5. Apply enforcement level
    const passed =
      config.enforcement === 'strict' ? validationResult.valid : true; // flexible always passes

    if (!passed) {
      const errorMessages = validationResult.violations
        .filter((v) => v.severity === 'error')
        .map((v) => `[${v.code}] ${v.message}`)
        .join('; ');
      throw new Error(
        `Canon validation failed at ${config.checkpoint}: ${errorMessages}`,
      );
    }

    return {
      passed,
      totalViolations: validationResult.violations.length,
      summary: validationResult.summary,
      messages,
      canonAvailable: true,
    };
  } catch (err) {
    // If it's a strict enforcement error, re-throw
    if (
      err instanceof Error &&
      err.message.startsWith('Canon validation failed')
    ) {
      throw err;
    }

    // Otherwise, validation infrastructure failed — non-fatal
    console.warn('[Validation Checkpoint] Validation failed, continuing:', err);
    return emptyResult;
  }
}
