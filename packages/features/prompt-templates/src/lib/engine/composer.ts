/**
 * System Prompt Composer
 *
 * Composes system prompts from multiple layers:
 * - compliance → role → context → brand_voice → format → standards → constraints → examples
 * - Handles conditional inclusion based on context
 * - Generates composition hash for performance tracking
 */

import type {
  PromptSystemPrompt,
  SystemPromptLayer,
  SystemPromptComposition,
} from '../types';
import { createHash } from 'crypto';

const LAYER_ORDER: SystemPromptLayer[] = [
  'compliance',
  'role',
  'context',
  'brand_voice',
  'format',
  'standards',
  'constraints',
  'examples',
];

export interface ComposerOptions {
  context?: Record<string, unknown>;
  includeHeaders?: boolean; // Include layer headers in output
  separator?: string; // Separator between layers
}

/**
 * Compose system prompts from multiple layers
 */
export function composeSystemPrompts(
  systemPrompts: PromptSystemPrompt[],
  options: ComposerOptions = {},
): SystemPromptComposition {
  const {
    context = {},
    includeHeaders = false,
    separator = '\n\n',
  } = options;

  // Filter prompts based on conditions
  const filteredPrompts = systemPrompts.filter((prompt) => {
    if (!prompt.condition_rules) {
      return true; // No conditions, always include
    }

    return evaluateConditions(prompt.condition_rules, context);
  });

  // Group by layer and sort by priority within each layer
  const byLayer = groupByLayer(filteredPrompts);

  // Compose in layer order
  const parts: string[] = [];
  const usedPrompts: Array<{
    id: string;
    slug: string;
    layer: SystemPromptLayer;
    content: string;
    priority: number;
  }> = [];

  for (const layer of LAYER_ORDER) {
    const layerPrompts = byLayer.get(layer) || [];

    if (layerPrompts.length === 0) {
      continue;
    }

    // Sort by priority (highest first)
    layerPrompts.sort((a, b) => b.priority - a.priority);

    // Add layer header if requested
    if (includeHeaders) {
      parts.push(`# ${layer.toUpperCase()}`);
    }

    // Add each prompt in the layer
    for (const prompt of layerPrompts) {
      parts.push(prompt.content);

      usedPrompts.push({
        id: prompt.id,
        slug: prompt.slug,
        layer: prompt.layer_type,
        content: prompt.content,
        priority: prompt.priority,
      });
    }
  }

  const composedContent = parts.join(separator);
  const compositionHash = generateCompositionHash(usedPrompts);

  return {
    template_id: '', // Will be set by caller
    system_prompts: usedPrompts,
    composition_hash: compositionHash,
  };
}

/**
 * Group prompts by layer
 */
function groupByLayer(
  prompts: PromptSystemPrompt[],
): Map<SystemPromptLayer, PromptSystemPrompt[]> {
  const byLayer = new Map<SystemPromptLayer, PromptSystemPrompt[]>();

  for (const prompt of prompts) {
    const existing = byLayer.get(prompt.layer_type) || [];
    existing.push(prompt);
    byLayer.set(prompt.layer_type, existing);
  }

  return byLayer;
}

/**
 * Evaluate condition rules against context
 */
function evaluateConditions(
  rules: unknown,
  context: Record<string, unknown>,
): boolean {
  // Handle null/undefined rules
  if (!rules || typeof rules !== 'object') {
    return true;
  }

  const rulesObj = rules as Record<string, unknown>;

  for (const [key, expectedValue] of Object.entries(rulesObj)) {
    const actualValue = context[key];

    // Support array of acceptable values
    if (Array.isArray(expectedValue)) {
      if (!expectedValue.includes(actualValue)) {
        return false;
      }
    } else if (actualValue !== expectedValue) {
      return false;
    }
  }

  return true;
}

/**
 * Generate hash for composition (for performance tracking)
 */
function generateCompositionHash(
  prompts: Array<{ id: string; layer: SystemPromptLayer }>,
): string {
  // Sort by layer order for consistent hashing
  const sortedPrompts = [...prompts].sort((a, b) => {
    return LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer);
  });

  // Create hash from IDs and layers
  const hashInput = sortedPrompts
    .map((p) => `${p.layer}:${p.id}`)
    .join('|');

  return createHash('sha256').update(hashInput).digest('hex').slice(0, 16);
}

/**
 * Merge system prompt composition with rendered user prompt
 */
export function mergePrompts(
  systemPrompt: string,
  userPrompt: string,
): { system: string; user: string } {
  return {
    system: systemPrompt.trim(),
    user: userPrompt.trim(),
  };
}

/**
 * Create composition for display/debugging
 */
export function formatCompositionForDisplay(
  composition: SystemPromptComposition,
): string {
  const parts: string[] = [
    '='.repeat(60),
    'System Prompt Composition',
    '='.repeat(60),
    '',
  ];

  let currentLayer: SystemPromptLayer | null = null;

  for (const prompt of composition.system_prompts) {
    // Add layer header when layer changes
    if (currentLayer !== prompt.layer) {
      if (currentLayer !== null) {
        parts.push(''); // Empty line between layers
      }
      parts.push(`## ${prompt.layer.toUpperCase()}`);
      parts.push('-'.repeat(60));
      currentLayer = prompt.layer;
    }

    parts.push(`### ${prompt.slug} (priority: ${prompt.priority})`);
    parts.push(prompt.content);
    parts.push('');
  }

  parts.push('='.repeat(60));
  parts.push(`Composition Hash: ${composition.composition_hash}`);
  parts.push('='.repeat(60));

  return parts.join('\n');
}

/**
 * Extract unique layer types from composition
 */
export function getUsedLayers(
  composition: SystemPromptComposition,
): SystemPromptLayer[] {
  const layers = new Set<SystemPromptLayer>();

  for (const prompt of composition.system_prompts) {
    layers.add(prompt.layer);
  }

  return Array.from(layers).sort(
    (a, b) => LAYER_ORDER.indexOf(a) - LAYER_ORDER.indexOf(b),
  );
}

/**
 * Compare two compositions for differences
 */
export function compareCompositions(
  a: SystemPromptComposition,
  b: SystemPromptComposition,
): {
  same: boolean;
  added: string[];
  removed: string[];
  changed: string[];
} {
  const aIds = new Set(a.system_prompts.map((p) => p.id));
  const bIds = new Set(b.system_prompts.map((p) => p.id));

  const added = b.system_prompts
    .filter((p) => !aIds.has(p.id))
    .map((p) => p.slug);

  const removed = a.system_prompts
    .filter((p) => !bIds.has(p.id))
    .map((p) => p.slug);

  const changed: string[] = [];

  for (const aPrompt of a.system_prompts) {
    const bPrompt = b.system_prompts.find((p) => p.id === aPrompt.id);

    if (bPrompt && bPrompt.content !== aPrompt.content) {
      changed.push(aPrompt.slug);
    }
  }

  return {
    same: a.composition_hash === b.composition_hash,
    added,
    removed,
    changed,
  };
}
