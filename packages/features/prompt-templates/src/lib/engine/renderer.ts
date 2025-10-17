/**
 * Template Renderer
 *
 * Renders templates by substituting variables and evaluating conditionals.
 * Handles:
 * - Variable substitution with defaults
 * - Conditional blocks
 * - Escaping and formatting
 */

import { parseTemplate } from './parser';
import type { ParsedTemplate } from './parser';

export interface RenderOptions {
  strict?: boolean; // Throw on missing variables
  escapeHtml?: boolean; // Escape HTML in variables
  preserveWhitespace?: boolean; // Keep original whitespace
}

export interface RenderResult {
  rendered: string;
  missingVariables: string[];
  usedVariables: string[];
}

/**
 * Render a template with provided variables
 */
export function renderTemplate(
  template: string,
  variables: Record<string, unknown>,
  options: RenderOptions = {},
): RenderResult {
  const { strict = false, escapeHtml = false, preserveWhitespace = false } =
    options;

  const parsed = parseTemplate(template);
  const missingVariables: string[] = [];
  const usedVariables = new Set<string>();

  if (parsed.hasErrors) {
    throw new Error(
      `Template has syntax errors: ${parsed.errors.join(', ')}`,
    );
  }

  // Start with original template
  let rendered = template;

  // Process conditionals first (they may contain variables)
  rendered = processConditionals(parsed, variables, usedVariables);

  // Process variable substitutions
  rendered = processVariables(
    rendered,
    variables,
    usedVariables,
    missingVariables,
    { strict, escapeHtml },
  );

  // Clean up whitespace if requested
  if (!preserveWhitespace) {
    rendered = cleanWhitespace(rendered);
  }

  return {
    rendered,
    missingVariables,
    usedVariables: Array.from(usedVariables),
  };
}

/**
 * Process conditional blocks
 */
function processConditionals(
  parsed: ParsedTemplate,
  variables: Record<string, unknown>,
  usedVariables: Set<string>,
): string {
  let result = parsed.raw;

  // Process conditionals from end to start to preserve positions
  const sortedConditionals = [...parsed.conditionals].sort(
    (a, b) => b.startPosition - a.startPosition,
  );

  for (const conditional of sortedConditionals) {
    const { variable, startPosition, endPosition, content } = conditional;

    usedVariables.add(variable);

    // Evaluate condition
    const value = variables[variable];
    const condition = isTruthy(value);

    // Replace conditional block with content or empty string
    const replacement = condition ? content : '';

    result =
      result.slice(0, startPosition) + replacement + result.slice(endPosition);
  }

  return result;
}

/**
 * Process variable substitutions
 */
function processVariables(
  template: string,
  variables: Record<string, unknown>,
  usedVariables: Set<string>,
  missingVariables: string[],
  options: { strict: boolean; escapeHtml: boolean },
): string {
  const variablePattern = /\{\{([a-zA-Z0-9_]+)(?::([^}]+))?\}\}/g;

  return template.replace(variablePattern, (match, varName, defaultValue) => {
    usedVariables.add(varName);

    let value = variables[varName];

    // Use default if variable is missing
    if (value === undefined || value === null) {
      if (defaultValue !== undefined) {
        value = defaultValue;
      } else if (options.strict) {
        throw new Error(`Missing required variable: ${varName}`);
      } else {
        missingVariables.push(varName);
        return `{{${varName}}}`;
      }
    }

    // Convert value to string
    let stringValue = String(value);

    // Escape HTML if requested
    if (options.escapeHtml) {
      stringValue = escapeHtml(stringValue);
    }

    return stringValue;
  });
}

/**
 * Check if value is truthy for conditional evaluation
 */
function isTruthy(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }

  return Boolean(value);
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
}

/**
 * Clean up extra whitespace
 */
function cleanWhitespace(text: string): string {
  return (
    text
      // Remove multiple blank lines
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      // Remove trailing whitespace from lines
      .replace(/[ \t]+$/gm, '')
      // Trim start and end
      .trim()
  );
}

/**
 * Batch render multiple templates
 */
export function renderTemplates(
  templates: Record<string, string>,
  variables: Record<string, unknown>,
  options?: RenderOptions,
): Record<string, RenderResult> {
  const results: Record<string, RenderResult> = {};

  for (const [name, template] of Object.entries(templates)) {
    results[name] = renderTemplate(template, variables, options);
  }

  return results;
}

/**
 * Preview template with sample data (non-strict mode)
 */
export function previewTemplate(
  template: string,
  sampleVariables: Record<string, unknown> = {},
): string {
  const result = renderTemplate(template, sampleVariables, {
    strict: false,
    escapeHtml: false,
    preserveWhitespace: false,
  });

  return result.rendered;
}
