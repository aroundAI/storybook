/**
 * Continuity Checker Types
 *
 * Type definitions for the AI-powered continuity checking feature.
 * Detects inconsistencies in story, screenplay, and shot lists.
 */

/**
 * Severity levels for continuity issues
 * - error: Critical issues that must be fixed
 * - warning: Significant issues that should be addressed
 * - suggestion: Minor improvements or best practices
 */
export type ContinuityIssueSeverity = 'error' | 'warning' | 'suggestion';

/**
 * Types of continuity issues that can be detected
 */
export type ContinuityIssueType =
  | 'character_location' // Character in wrong place
  | 'character_knowledge' // Character knows something they shouldn't
  | 'timeline_inconsistency' // Events out of order
  | 'prop_continuity' // Prop appears/disappears incorrectly
  | 'setting_change' // Location details changed
  | 'dialogue_reference' // Reference to non-existent event
  | 'visual_continuity' // Visual description mismatch
  | 'costume_change' // Unexplained costume change
  | 'time_of_day'; // Lighting/time inconsistency

/**
 * Location where a continuity issue was found
 */
export interface IssueLocation {
  /** Type of content where the issue was found */
  type: 'story' | 'screenplay' | 'shot';
  /** Scene number (if applicable) */
  sceneNumber?: number;
  /** Shot number (if applicable) */
  shotNumber?: number;
  /** Line number in the content (if applicable) */
  lineNumber?: number;
  /** Excerpt of text showing the issue */
  excerpt: string;
}

/**
 * A detected continuity issue
 */
export interface ContinuityIssue {
  /** Unique identifier for the issue */
  id: string;
  /** Category of the issue */
  type: ContinuityIssueType;
  /** How severe the issue is */
  severity: ContinuityIssueSeverity;
  /** Brief title describing the issue */
  title: string;
  /** Detailed explanation of the issue */
  description: string;
  /** Locations where the issue was found */
  locations: IssueLocation[];
  /** Suggested fix for the issue */
  suggestion?: string;
  /** Whether this issue can be auto-fixed */
  autoFixable: boolean;
}

/**
 * Result from a continuity check
 */
export interface ContinuityCheckResult {
  /** List of detected issues */
  issues: ContinuityIssue[];
  /** When the check was performed */
  checkedAt: string;
  /** Episode that was checked */
  episodeId: string;
}
