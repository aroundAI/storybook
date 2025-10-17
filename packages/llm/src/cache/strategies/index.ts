/**
 * Cache Matching Strategies
 *
 * Pre-built strategies for different caching scenarios.
 * Apps can use these directly or extend them for custom behavior.
 */

export { SemanticCacheStrategy } from './semantic';
export { ExactMatchStrategy } from './exact';
export {
  StructuralMatchStrategy,
  type StructuralPattern,
} from './structural';
export {
  HybridCacheStrategy,
  type ParameterTolerance,
} from './hybrid';
