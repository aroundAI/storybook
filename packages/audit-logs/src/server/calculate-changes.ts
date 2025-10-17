import type { ChangeDetail } from '../types';

/**
 * Calculate changes between two objects
 *
 * Returns an object mapping field names to their before/after values
 * Only includes fields that actually changed
 *
 * @param before - Object state before change
 * @param after - Object state after change
 * @returns Object with changes per field
 *
 * @example
 * ```typescript
 * const changes = calculateChanges(
 *   { name: 'Old Name', status: 'active' },
 *   { name: 'New Name', status: 'active' }
 * );
 * // { name: { before: 'Old Name', after: 'New Name' } }
 * ```
 */
export function calculateChanges(
  before: unknown,
  after: unknown,
): Record<string, ChangeDetail> {
  if (typeof before !== 'object' || typeof after !== 'object') {
    return {};
  }

  if (!before || !after) {
    return {};
  }

  const changes: Record<string, ChangeDetail> = {};
  const beforeObj = before as Record<string, unknown>;
  const afterObj = after as Record<string, unknown>;

  // Get all unique keys from both objects
  const allKeys = new Set([
    ...Object.keys(beforeObj),
    ...Object.keys(afterObj),
  ]);

  for (const key of allKeys) {
    const beforeValue = beforeObj[key];
    const afterValue = afterObj[key];

    // Skip if values are the same
    if (isEqual(beforeValue, afterValue)) {
      continue;
    }

    // Record the change
    changes[key] = {
      before: beforeValue,
      after: afterValue,
    };
  }

  return changes;
}

/**
 * Deep equality check for values
 * Handles primitives, dates, arrays, and objects
 */
function isEqual(a: unknown, b: unknown): boolean {
  // Same reference or both null/undefined
  if (a === b) return true;

  // One is null/undefined
  if (a == null || b == null) return false;

  // Different types
  if (typeof a !== typeof b) return false;

  // Dates
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  // Arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => isEqual(item, b[index]));
  }

  // Objects
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as object);
    const bKeys = Object.keys(b as object);

    if (aKeys.length !== bKeys.length) return false;

    return aKeys.every((key) => {
      const aObj = a as Record<string, unknown>;
      const bObj = b as Record<string, unknown>;
      return isEqual(aObj[key], bObj[key]);
    });
  }

  // Primitives
  return a === b;
}

/**
 * Format changes for display
 *
 * Converts change object to human-readable string
 *
 * @param changes - Changes object from calculateChanges
 * @returns Human-readable string describing changes
 *
 * @example
 * ```typescript
 * const formatted = formatChanges({
 *   name: { before: 'Old', after: 'New' },
 *   status: { before: 'active', after: 'archived' }
 * });
 * // "Changed name from 'Old' to 'New', status from 'active' to 'archived'"
 * ```
 */
export function formatChanges(
  changes: Record<string, ChangeDetail>,
): string {
  const parts: string[] = [];

  for (const [field, change] of Object.entries(changes)) {
    const before = formatValue(change.before);
    const after = formatValue(change.after);
    parts.push(`${field} from ${before} to ${after}`);
  }

  if (parts.length === 0) {
    return 'No changes';
  }

  return `Changed ${parts.join(', ')}`;
}

/**
 * Format a value for display in change description
 */
function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') return '[object]';
  return String(value);
}
