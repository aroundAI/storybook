/**
 * Skills Index
 *
 * Re-exports standalone built-in skills.
 * Episode-specific skills (continuity, news-production) live in @kit/episodes
 * to avoid circular dependencies.
 *
 * @example
 * ```typescript
 * import { qualityEvaluationSkill } from '@kit/agent/skills';
 * import { continuitySkill } from '@kit/episodes/skills';
 * ```
 */

export { qualityEvaluationSkill } from './quality-evaluation-skill';
export { contentGenerationSkill } from './content-generation-skill';
