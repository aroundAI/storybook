/**
 * Server-side exports for prompt templates
 *
 * This module re-exports all server actions (mutations) and queries
 * for easier importing in server components and API routes.
 */

// Export all mutations
export {
  createPromptTemplateAction,
  updatePromptTemplateAction,
  deletePromptTemplateAction,
  createSystemPromptAction,
  updateSystemPromptAction,
  deleteSystemPromptAction,
  linkSystemPromptAction,
  unlinkSystemPromptAction,
  createVariantAction,
  updateVariantAction,
  deleteVariantAction,
  assignVariantToAccountAction,
  unassignVariantFromAccountAction,
  createExperimentAction,
  updateExperimentAction,
  logExecutionAction,
} from './prompt.mutations';

// Export all queries
export {
  getAllTemplates,
  getTemplate,
  resolveTemplate,
  getTemplateWithSystemPrompts,
  getSystemPromptsForTemplate,
  getSystemPromptsByScope,
  composeSystemPromptsForTemplate,
  getTemplateVariants,
  selectVariant,
  getVariantAssignments,
  getAccountAssignedVariant,
  resolveVariantForAccount,
  getAccountVariantAssignments,
  getActiveExperiments,
  getExperimentResults,
  getCompositionPerformance,
  getBestComposition,
  getExecutionLogs,
  calculateAttributionScores,
} from './prompt.queries';
