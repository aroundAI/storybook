import type { AuditTransformer } from '../types';
import { ConfigBasedTransformer } from '../transformers/config-based-transformer';
import { defaultTransformer } from '../transformers/default-transformer';
import { getObjectConfig } from './audit-config';
import { getLogger } from '@kit/shared/logger';

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
 * 3. Config-based transformer (if config exists)
 * 4. Default transformer (fallback - logs warning)
 *
 * IMPORTANT: This function ALWAYS returns a transformer (never null).
 * This ensures sensitive data is always processed before storage.
 *
 * @param objectType - The type of object
 * @returns Transformer instance (guaranteed non-null)
 */
export function getTransformer(objectType: string): AuditTransformer {
  // Check if config has a custom transformer
  const config = getObjectConfig(objectType);

  if (config?.transformer) {
    return config.transformer;
  }

  // Check registered transformers
  if (transformerRegistry.has(objectType)) {
    return transformerRegistry.get(objectType)!;
  }

  // Return config-based transformer if config exists
  if (config) {
    return new ConfigBasedTransformer(config);
  }

  // Fallback to default transformer with warning
  void getLogger().then((logger) => {
    logger.warn(
      {
        objectType,
        name: 'audit-registry',
      },
      `No transformer configuration found for object type "${objectType}". Using default transformer with security-first defaults. Consider adding proper configuration to AUDIT_CONFIG.`,
    );
  });

  return defaultTransformer;
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
