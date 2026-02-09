/**
 * Canon Management System
 * Phase 10: FILM-1001 to FILM-1006
 *
 * Re-exports all canon types, services, and utilities.
 * NOTE: Server-only exports (buildMemoryContext, runRolePipeline) are in server/index.ts
 */

// Types (client-safe)
export * from './types';
export type * from '../../types/act-context';
export type {
    ParentContext,
    ParentImmutableEvent,
    ParentCharacterState,
    ParentResolvedThread,
    ParentWorldFact,
    CharacterVisualRef,
    LocationRef,
} from './sequel-system';

// Client-safe validation functions
export {
    validatePlotSkeleton,
    validateSceneBlocks,
    getRulesForCheckpoint,
} from './continuity-validator';

// Verified facts types (FILM-1120)
export type * from '../../types/verified-facts';
export { generateAPACitation } from '../../types/verified-facts';

// Documentary module types (FILM-1122, FILM-1123)
export type {
    ResearchClaim,
    ResearchResult,
    FactCheckIssue,
    FactCheckResult,
} from '../documentary';
export { shouldBlockContent } from '../documentary';

// Constants (client-safe) - duplicated here to avoid server-only import
export const DEFAULT_TOKEN_BUDGET_MAX = 6000;
