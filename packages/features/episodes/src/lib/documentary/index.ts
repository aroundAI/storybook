/**
 * Documentary Module
 * Phase 11.3: FILM-1122 + FILM-1123
 *
 * Re-exports researcher and fact-checker types for use by other modules.
 * NOTE: Service functions (runResearchPhase, runFactCheck) are server-only
 * and should be imported directly from their respective modules.
 */

// Researcher types (client-safe)
export type { ResearchClaim, ResearchResult } from './researcher';

// Fact-checker types and pure functions (client-safe)
export type { FactCheckIssue, FactCheckResult } from './fact-checker';
export { shouldBlockContent } from './fact-checker';
