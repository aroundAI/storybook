/**
 * Template Validator
 *
 * Validates template variables against their schema definitions:
 * - Type checking
 * - Required field validation
 * - Range/pattern validation
 * - Enum validation
 */

import type {
  TemplateVariable,
  TemplateVariables,
} from '../types';

export interface ValidationError {
  variable: string;
  message: string;
  code: 'MISSING_REQUIRED' | 'INVALID_TYPE' | 'OUT_OF_RANGE' | 'INVALID_FORMAT' | 'NOT_IN_ENUM';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

/**
 * Validate variables against template schema
 */
export function validateVariables(
  variables: Record<string, unknown>,
  schema: TemplateVariables,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  // Check all required variables are present
  for (const [name, def] of Object.entries(schema)) {
    if (def.required && !(name in variables)) {
      errors.push({
        variable: name,
        message: `Required variable '${name}' is missing`,
        code: 'MISSING_REQUIRED',
      });
    }
  }

  // Validate each provided variable
  for (const [name, value] of Object.entries(variables)) {
    const def = schema[name];

    // Warn about undefined variables
    if (!def) {
      warnings.push(`Variable '${name}' is not defined in template schema`);
      continue;
    }

    // Type validation
    const typeError = validateType(name, value, def.type);
    if (typeError) {
      errors.push(typeError);
      continue; // Skip further validation if type is wrong
    }

    // Range validation
    if (def.validation) {
      const rangeError = validateRange(name, value, def.validation);
      if (rangeError) {
        errors.push(rangeError);
      }

      // Pattern validation
      if (def.validation.pattern && typeof value === 'string') {
        const patternError = validatePattern(name, value, def.validation.pattern);
        if (patternError) {
          errors.push(patternError);
        }
      }

      // Enum validation
      if (def.validation.enum) {
        const enumError = validateEnum(name, value, def.validation.enum);
        if (enumError) {
          errors.push(enumError);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate variable type
 */
function validateType(
  name: string,
  value: unknown,
  expectedType: TemplateVariable['type'],
): ValidationError | null {
  let actualType: string;

  if (value === null || value === undefined) {
    actualType = 'null';
  } else if (Array.isArray(value)) {
    actualType = 'array';
  } else {
    actualType = typeof value;
  }

  const typeMap: Record<string, string[]> = {
    text: ['string'],
    number: ['number'],
    boolean: ['boolean'],
    array: ['array'],
    object: ['object'],
    markdown: ['string'],
    json: ['object', 'array'],
    context: ['object'],
  };

  const validTypes = typeMap[expectedType] || [];

  if (!validTypes.includes(actualType)) {
    return {
      variable: name,
      message: `Variable '${name}' expected type '${expectedType}' but got '${actualType}'`,
      code: 'INVALID_TYPE',
    };
  }

  return null;
}

/**
 * Validate numeric range
 */
function validateRange(
  name: string,
  value: unknown,
  validation: NonNullable<TemplateVariable['validation']>,
): ValidationError | null {
  if (typeof value !== 'number') {
    return null; // Only validate numbers
  }

  if (validation.min !== undefined && value < validation.min) {
    return {
      variable: name,
      message: `Variable '${name}' must be at least ${validation.min}`,
      code: 'OUT_OF_RANGE',
    };
  }

  if (validation.max !== undefined && value > validation.max) {
    return {
      variable: name,
      message: `Variable '${name}' must be at most ${validation.max}`,
      code: 'OUT_OF_RANGE',
    };
  }

  return null;
}

/**
 * Validate string pattern
 */
function validatePattern(
  name: string,
  value: string,
  pattern: string,
): ValidationError | null {
  try {
    const regex = new RegExp(pattern);
    if (!regex.test(value)) {
      return {
        variable: name,
        message: `Variable '${name}' does not match pattern: ${pattern}`,
        code: 'INVALID_FORMAT',
      };
    }
  } catch (error) {
    return {
      variable: name,
      message: `Invalid pattern for '${name}': ${pattern}`,
      code: 'INVALID_FORMAT',
    };
  }

  return null;
}

/**
 * Validate enum values
 */
function validateEnum(
  name: string,
  value: unknown,
  enumValues: unknown[],
): ValidationError | null {
  if (!enumValues.includes(value)) {
    return {
      variable: name,
      message: `Variable '${name}' must be one of: ${enumValues.join(', ')}`,
      code: 'NOT_IN_ENUM',
    };
  }

  return null;
}

/**
 * Apply default values for missing optional variables
 */
export function applyDefaults(
  variables: Record<string, unknown>,
  schema: TemplateVariables,
): Record<string, unknown> {
  const result = { ...variables };

  for (const [name, def] of Object.entries(schema)) {
    if (!(name in result) && def.default !== undefined) {
      result[name] = def.default;
    }
  }

  return result;
}

/**
 * Get missing required variables
 */
export function getMissingRequired(
  variables: Record<string, unknown>,
  schema: TemplateVariables,
): string[] {
  const missing: string[] = [];

  for (const [name, def] of Object.entries(schema)) {
    if (def.required && !(name in variables)) {
      missing.push(name);
    }
  }

  return missing;
}
