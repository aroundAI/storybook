/**
 * Structural Match Cache Strategy
 *
 * Matches based on abstract structural patterns rather than specific content.
 * Building block for cross-domain caching and analogical reasoning.
 *
 * Features:
 * - Abstracts domain-specific terms
 * - Identifies structural similarities
 * - Enables cross-domain transfer
 *
 * Best for:
 * - Multi-tenant SaaS with similar use cases across domains
 * - Code generation across different languages
 * - Business analytics across different industries
 *
 * Example Use Cases:
 * - Cricket coaching app → Baseball coaching app (same metrics, different sport)
 * - React code generation → Vue code generation (same patterns, different framework)
 * - E-commerce analytics → SaaS analytics (same KPIs, different business)
 *
 * @example
 * ```typescript
 * class CustomStructuralStrategy extends StructuralMatchStrategy {
 *   protected extractPattern(request: ChatCompletionRequest) {
 *     // Custom pattern extraction for your domain
 *     return {
 *       inputType: 'metrics_analysis',
 *       outputType: 'recommendations',
 *       metricTypes: ['retention', 'engagement', 'churn']
 *     };
 *   }
 * }
 * ```
 */
import type {
  CachedEntry,
  CacheMatchResult,
  CacheMatchStrategy,
} from '../types';
import type { ChatCompletionRequest } from '../../types';

/**
 * Structural pattern representation
 */
export interface StructuralPattern {
  /**
   * Type of input (e.g., 'metrics', 'code', 'query')
   */
  inputType: string;

  /**
   * Type of output (e.g., 'recommendations', 'code', 'answer')
   */
  outputType: string;

  /**
   * Key features extracted from content
   */
  features: string[];

  /**
   * Metadata about the pattern
   */
  metadata?: Record<string, unknown>;
}

export class StructuralMatchStrategy implements CacheMatchStrategy {
  /**
   * Configurable pattern match threshold
   * Default: 0.75 (75% structural similarity)
   */
  protected structuralThreshold: number;

  constructor(options?: { structuralThreshold?: number }) {
    this.structuralThreshold = options?.structuralThreshold ?? 0.75;
  }

  matches(
    request: ChatCompletionRequest,
    cached: CachedEntry,
    options: { threshold: number; accountId: string },
  ): CacheMatchResult {
    // Extract structural patterns
    const currentPattern = this.extractPattern(request);
    const cachedPattern = this.extractPattern(cached.request);

    // Calculate structural similarity
    const similarity = this.calculateStructuralSimilarity(
      currentPattern,
      cachedPattern,
    );

    const isMatch = similarity >= this.structuralThreshold;

    return {
      isMatch,
      confidence: similarity,
      metadata: {
        matchType: 'structural',
        currentPattern,
        cachedPattern,
        similarity,
      },
    };
  }

  /**
   * Extract structural pattern from request
   *
   * Apps should override this to define their own patterns.
   * Default implementation provides basic structure.
   *
   * @param request - LLM request
   * @returns Structural pattern
   */
  protected extractPattern(request: ChatCompletionRequest): StructuralPattern {
    const content = this.getMessageContent(request);

    // Default: extract basic structural features
    return {
      inputType: this.detectInputType(content),
      outputType: this.detectOutputType(content),
      features: this.extractFeatures(content),
    };
  }

  /**
   * Calculate similarity between two structural patterns
   */
  protected calculateStructuralSimilarity(
    pattern1: StructuralPattern,
    pattern2: StructuralPattern,
  ): number {
    let score = 0;

    // Same input type? (40% weight)
    if (pattern1.inputType === pattern2.inputType) {
      score += 0.4;
    }

    // Same output type? (30% weight)
    if (pattern1.outputType === pattern2.outputType) {
      score += 0.3;
    }

    // Feature overlap (30% weight)
    const featureOverlap = this.calculateFeatureOverlap(
      pattern1.features,
      pattern2.features,
    );
    score += featureOverlap * 0.3;

    return score;
  }

  /**
   * Calculate feature overlap using Jaccard similarity
   */
  private calculateFeatureOverlap(
    features1: string[],
    features2: string[],
  ): number {
    if (features1.length === 0 && features2.length === 0) {
      return 1.0;
    }

    if (features1.length === 0 || features2.length === 0) {
      return 0.0;
    }

    const set1 = new Set(features1);
    const set2 = new Set(features2);

    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  }

  /**
   * Get concatenated message content
   */
  private getMessageContent(request: ChatCompletionRequest): string {
    return request.messages.map((m) => m.content).join(' ');
  }

  /**
   * Detect input type from content
   * Apps can override to add custom detection
   */
  protected detectInputType(content: string): string {
    // Default: simple keyword-based detection
    if (
      content.match(/\b(metrics|statistics|data|numbers|kpis?)\b/i)
    ) {
      return 'metrics';
    }

    if (content.match(/\b(code|function|class|implement|write)\b/i)) {
      return 'code';
    }

    if (content.match(/\b(explain|what is|how does|describe)\b/i)) {
      return 'explanation';
    }

    return 'general';
  }

  /**
   * Detect output type from content
   * Apps can override to add custom detection
   */
  protected detectOutputType(content: string): string {
    // Default: simple keyword-based detection
    if (
      content.match(
        /\b(recommend|suggestion|advice|should|strategy)\b/i,
      )
    ) {
      return 'recommendations';
    }

    if (content.match(/\b(code|function|implementation)\b/i)) {
      return 'code';
    }

    if (content.match(/\b(answer|explanation|summary)\b/i)) {
      return 'explanation';
    }

    return 'general';
  }

  /**
   * Extract key features from content
   * Apps can override to extract domain-specific features
   */
  protected extractFeatures(content: string): string[] {
    // Default: extract common business/technical terms
    const features: string[] = [];

    // Extract numbers (could be metrics)
    const numbers = content.match(/\b\d+(\.\d+)?%?\b/g);
    if (numbers) {
      features.push('has_numbers');
    }

    // Extract question words
    const questionWords = [
      'what',
      'how',
      'why',
      'when',
      'where',
      'which',
      'who',
    ];
    for (const word of questionWords) {
      if (content.toLowerCase().includes(word)) {
        features.push(`question_${word}`);
      }
    }

    // Extract common domain indicators
    const domains = {
      business: ['revenue', 'profit', 'growth', 'customer', 'market'],
      technical: ['code', 'api', 'database', 'server', 'function'],
      analytics: ['metrics', 'kpi', 'performance', 'data', 'statistics'],
    };

    for (const [domain, keywords] of Object.entries(domains)) {
      for (const keyword of keywords) {
        if (content.toLowerCase().includes(keyword)) {
          features.push(`domain_${domain}`);
          break; // Only add domain once
        }
      }
    }

    return [...new Set(features)]; // Remove duplicates
  }
}
