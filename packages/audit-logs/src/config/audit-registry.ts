import type { AuditTransformer } from '../types';
import { ConfigBasedTransformer } from '../transformers/config-based-transformer';
import { getObjectConfig } from './audit-config';

/**
 * Global registry for audit transformers
 * Maps object type to transformer implementation
 */
const transformerRegistry = new Map<string, AuditTransformer>();

/**
 * Register a custom transformer for an object type
 *
 * @param objectType - The type of object (e.g., 'user', 'project')
 * @param transformer - The transformer implementation
 *
 * @example
 * registerTransformer('user', userTransformer);
 */
export function registerTransformer(
  objectType: string,
  transformer: AuditTransformer,
): void {
  transformerRegistry.set(objectType, transformer);
}

/**
 * Get the transformer for a specific object type
 *
 * Priority:
 * 1. Custom transformer in config
 * 2. Registered transformer
 * 3. Config-based transformer (fallback)
 *
 * @param objectType - The type of object
 * @returns Transformer instance or null if no config exists
 */
export function getTransformer(objectType: string): AuditTransformer | null {
  // Check if config has a custom transformer
  const config = getObjectConfig(objectType);

  if (config?.transformer) {
    return config.transformer;
  }

  // Check registered transformers
  if (transformerRegistry.has(objectType)) {
    return transformerRegistry.get(objectType)!;
  }

  // Return config-based transformer as fallback
  if (config) {
    return new ConfigBasedTransformer(config);
  }

  return null;
}

/**
 * Check if a transformer is registered for an object type
 *
 * @param objectType - The type of object
 * @returns true if transformer is registered or config exists
 */
export function hasTransformer(objectType: string): boolean {
  const config = getObjectConfig(objectType);

  return (
    (config?.transformer !== undefined) || transformerRegistry.has(objectType)
  );
}

/**
 * Clear all registered transformers (useful for testing)
 */
export function clearTransformerRegistry(): void {
  transformerRegistry.clear();
}

/**
 * Get all registered object types with transformers
 *
 * @returns Array of object type names
 */
export function getRegisteredObjectTypes(): string[] {
  return Array.from(transformerRegistry.keys());
}
