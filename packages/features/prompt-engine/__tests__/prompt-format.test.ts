import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Prompt Format Validation Tests
 *
 * Ensures all prompt JSON templates follow a single consistent format:
 * - Only {{variable}} interpolation (no Handlebars {{{triple}}}, {{#if}}, etc.)
 * - Valid LLM provider names (gemini, openai, anthropic, deepseek)
 * - Valid JSON with trailing newline
 * - Required fields present
 */

const PROMPTS_DIR = path.resolve(__dirname, '../src/prompts');

// All prompts standardized on Gemini as of FILM-1133 audit
const VALID_PROVIDERS = ['gemini'];

// Recursively find all .json files
function findJsonFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...findJsonFiles(fullPath));
    } else if (entry.name.endsWith('.json')) {
      results.push(fullPath);
    }
  }

  return results;
}

// Extract all prompt text fields from a template
// Handles two formats:
//   Standard: user_prompt, system_prompt, system_prompts[].content
//   Canon-role: userPrompt.template, systemPrompt.template
function extractPromptTexts(template: Record<string, unknown>): string[] {
  const texts: string[] = [];

  // Standard format
  if (typeof template.user_prompt === 'string') {
    texts.push(template.user_prompt);
  }

  if (typeof template.system_prompt === 'string') {
    texts.push(template.system_prompt);
  }

  if (Array.isArray(template.system_prompts)) {
    for (const sp of template.system_prompts) {
      if (
        typeof sp === 'object' &&
        sp !== null &&
        'content' in sp &&
        typeof sp.content === 'string'
      ) {
        texts.push(sp.content);
      }
    }
  }

  // Canon-role format (systemPrompt.template, userPrompt.template)
  const systemPrompt = template.systemPrompt as
    | Record<string, unknown>
    | undefined;
  if (systemPrompt && typeof systemPrompt.template === 'string') {
    texts.push(systemPrompt.template);
  }

  const userPrompt = template.userPrompt as Record<string, unknown> | undefined;
  if (userPrompt && typeof userPrompt.template === 'string') {
    texts.push(userPrompt.template);
  }

  return texts;
}

describe('Prompt Template Format Validation', () => {
  const jsonFiles = findJsonFiles(PROMPTS_DIR);

  it('should find prompt template files', () => {
    expect(jsonFiles.length).toBeGreaterThan(0);
  });

  describe.each(
    jsonFiles.map((f) => [path.relative(PROMPTS_DIR, f), f] as const),
  )('%s', (_relativePath, filePath) => {
    let content: string;
    let template: Record<string, unknown>;

    // Parse file in beforeAll so invalid JSON causes a clean test failure
    // with file name in output, rather than crashing the entire suite.
    beforeAll(() => {
      content = fs.readFileSync(filePath, 'utf-8');
      template = JSON.parse(content);
    });

    it('should be valid JSON', () => {
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('should end with a trailing newline', () => {
      expect(content.endsWith('\n')).toBe(true);
    });

    it('should not use triple-brace Handlebars syntax {{{var}}}', () => {
      const promptTexts = extractPromptTexts(template);

      for (const text of promptTexts) {
        expect(text).not.toMatch(/\{\{\{/);
      }
    });

    it('should not use Handlebars conditionals {{#if}}, {{/if}}, {{#each}}, etc.', () => {
      const promptTexts = extractPromptTexts(template);

      for (const text of promptTexts) {
        expect(text).not.toMatch(/\{\{#/);
        expect(text).not.toMatch(/\{\{\//);
      }
    });

    it('should not use Handlebars helpers {{else}}, {{> partial}}', () => {
      const promptTexts = extractPromptTexts(template);

      for (const text of promptTexts) {
        expect(text).not.toMatch(/\{\{else\}\}/);
        expect(text).not.toMatch(/\{\{>/);
      }
    });

    it('should have a complete LLM/model configuration block', () => {
      const llm = template.llm as Record<string, unknown> | undefined;
      const model = template.model as Record<string, unknown> | undefined;

      // Every prompt MUST have either an `llm` or `model` block
      expect(llm !== undefined || model !== undefined).toBe(true);

      const config = llm ?? model!;

      // Validate all config fields in one pass with descriptive errors
      const errors: string[] = [];

      if (
        typeof config.provider !== 'string' ||
        !VALID_PROVIDERS.includes(config.provider as string)
      ) {
        errors.push(
          `provider must be one of ${VALID_PROVIDERS.join(', ')}, got '${String(config.provider)}'`,
        );
      }

      if (
        typeof config.model !== 'string' ||
        (config.model as string).length === 0
      ) {
        errors.push(
          `model must be a non-empty string, got '${String(config.model)}'`,
        );
      }

      const temp = config.temperature;
      if (typeof temp !== 'number' || temp < 0 || temp > 1) {
        errors.push(`temperature must be 0–1, got ${String(temp)}`);
      }

      // Enforce max_tokens exclusively — maxTokens is not allowed
      if ('maxTokens' in config) {
        errors.push(
          `use "max_tokens" instead of "maxTokens" (found in ${String(template.slug ?? template.id)})`,
        );
      }

      const maxTokens = config.max_tokens;
      if (typeof maxTokens !== 'number' || maxTokens <= 0) {
        errors.push(`max_tokens must be > 0, got ${String(maxTokens)}`);
      }

      expect(errors).toEqual([]);
    });

    it('should have required fields: identifier and at least one prompt', () => {
      // All templates should have an identifier (slug or id)
      const hasSlug = typeof template.slug === 'string';
      const hasId = typeof template.id === 'string';
      expect(hasSlug || hasId).toBe(true);

      // All templates should have at least one prompt (standard or canon-role format)
      const hasUserPrompt = typeof template.user_prompt === 'string';
      const hasSystemPrompt = typeof template.system_prompt === 'string';
      const hasSystemPrompts =
        Array.isArray(template.system_prompts) &&
        template.system_prompts.length > 0;
      const sysPromptObj = template.systemPrompt as
        | Record<string, unknown>
        | undefined;
      const usrPromptObj = template.userPrompt as
        | Record<string, unknown>
        | undefined;
      const hasCanonUserPrompt = typeof usrPromptObj?.template === 'string';
      const hasCanonSystemPrompt = typeof sysPromptObj?.template === 'string';

      expect(
        hasUserPrompt ||
          hasSystemPrompt ||
          hasSystemPrompts ||
          hasCanonUserPrompt ||
          hasCanonSystemPrompt,
      ).toBe(true);
    });
    it('should only use {{variable}} format for interpolation in prompts', () => {
      const promptTexts = extractPromptTexts(template);

      for (const text of promptTexts) {
        // Find all {{ patterns and ensure they are simple {{variable_name}} format
        // Valid: {{variable}}, {{variable_name}}, {{variableName}}
        // Invalid: {{{triple}}}, {{#if}}, {{/if}}, {{> partial}}, {{else}}
        // NOTE: Dot-notation (e.g. {{object.property}}) is intentionally
        // unsupported — our interpolation uses simple string replacement.
        const allBracePatterns = text.match(/\{\{[^}]*\}\}/g) || [];

        for (const pattern of allBracePatterns) {
          // Each pattern should match {{simple_variable_name}}
          expect(pattern).toMatch(/^\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}$/);
        }
      }
    });
  });
});
