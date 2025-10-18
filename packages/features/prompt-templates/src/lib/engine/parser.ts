/**
 * Template Parser
 *
 * Parses template strings with {{variable}} placeholders and extracts:
 * - Variable names and their positions
 * - Conditional blocks
 * - Special directives
 *
 * Syntax:
 * - {{variable}} - Simple variable substitution
 * - {{variable:default_value}} - Variable with default
 * - {{#if variable}}...{{/if}} - Conditional blocks
 * - {{#each items}}...{{/each}} - Iteration blocks
 */

export interface ParsedVariable {
  name: string;
  defaultValue?: string;
  position: number;
  length: number;
}

export interface ParsedConditional {
  variable: string;
  startPosition: number;
  endPosition: number;
  content: string;
}

export interface ParsedTemplate {
  raw: string;
  variables: ParsedVariable[];
  conditionals: ParsedConditional[];
  hasErrors: boolean;
  errors: string[];
}

/**
 * Parse a template string and extract all variables and conditionals
 */
export function parseTemplate(template: string): ParsedTemplate {
  const variables: ParsedVariable[] = [];
  const conditionals: ParsedConditional[] = [];
  const errors: string[] = [];

  // Match {{variable}} or {{variable:default}}
  const variablePattern = /\{\{([a-zA-Z0-9_]+)(?::([^}]+))?\}\}/g;
  let match: RegExpExecArray | null;

  while ((match = variablePattern.exec(template)) !== null) {
    const fullMatch = match[0];
    const varName = match[1] ?? '';
    const defaultValue = match[2];

    variables.push({
      name: varName,
      defaultValue,
      position: match.index,
      length: fullMatch.length,
    });
  }

  // Match {{#if variable}}...{{/if}}
  const conditionalPattern =
    /\{\{#if\s+([a-zA-Z0-9_]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;

  while ((match = conditionalPattern.exec(template)) !== null) {
    const fullMatch = match[0];
    const varName = match[1] ?? '';
    const content = match[2] ?? '';

    conditionals.push({
      variable: varName,
      startPosition: match.index,
      endPosition: match.index + fullMatch.length,
      content,
    });

    // Check if the conditional variable is defined
    const varExists = variables.some((v) => v.name === varName);
    if (!varExists) {
      errors.push(
        `Conditional uses undefined variable: ${varName} at position ${match.index}`,
      );
    }
  }

  // Check for unclosed conditionals
  const openIfs = (template.match(/\{\{#if/g) || []).length;
  const closeIfs = (template.match(/\{\{\/if\}\}/g) || []).length;

  if (openIfs !== closeIfs) {
    errors.push(
      `Mismatched conditional blocks: ${openIfs} opening, ${closeIfs} closing`,
    );
  }

  return {
    raw: template,
    variables,
    conditionals,
    hasErrors: errors.length > 0,
    errors,
  };
}

/**
 * Extract unique variable names from parsed template
 */
export function getVariableNames(parsed: ParsedTemplate): string[] {
  const names = new Set<string>();

  for (const variable of parsed.variables) {
    names.add(variable.name);
  }

  for (const conditional of parsed.conditionals) {
    names.add(conditional.variable);
  }

  return Array.from(names).sort();
}

/**
 * Check if a template has required variables
 */
export function hasVariable(
  parsed: ParsedTemplate,
  variableName: string,
): boolean {
  return (
    parsed.variables.some((v) => v.name === variableName) ||
    parsed.conditionals.some((c) => c.variable === variableName)
  );
}

/**
 * Get default values for variables
 */
export function getDefaultValues(
  parsed: ParsedTemplate,
): Record<string, string> {
  const defaults: Record<string, string> = {};

  for (const variable of parsed.variables) {
    if (variable.defaultValue !== undefined) {
      defaults[variable.name] = variable.defaultValue;
    }
  }

  return defaults;
}

/**
 * Validate template syntax without rendering
 */
export function validateTemplateSyntax(template: string): {
  valid: boolean;
  errors: string[];
} {
  const parsed = parseTemplate(template);

  return {
    valid: !parsed.hasErrors,
    errors: parsed.errors,
  };
}
