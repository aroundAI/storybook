import { describe, expect, it } from 'vitest';

import {
  validatePromptTemplate,
  validateVariablePlaceholders,
  validateZodSchemaCompilation,
  validateExampleOutput,
} from '../src/lib/validation';

describe('Prompt Template Validation', () => {
  describe('validatePromptTemplate', () => {
    it('should validate a minimal valid template', () => {
      const template = {
        slug: 'test-template',
        name: 'Test Template',
        version: 1,
        category: 'test',
        description: 'A test template',
        exported_at: '2025-01-01T00:00:00.000Z',
        llm: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          max_tokens: 500,
          temperature: 0.5,
        },
        system_prompts: [
          {
            slug: 'role',
            name: 'Role',
            content: 'You are a helpful assistant.',
            layer_type: 'role',
            scope: 'template',
            order: 1,
          },
        ],
        user_prompt: 'Hello {{name}}!',
        variables: {
          name: {
            type: 'text',
            required: true,
            description: 'User name',
          },
        },
        output: {
          type: 'object',
          schema: {
            type: 'zod',
            definition: 'z.object({ message: z.string() })',
          },
          schema_for_llm: 'Return JSON: { "message": "your response" }',
        },
      };

      const result = validatePromptTemplate(template);
      expect(result).toBeDefined();
      expect(result.slug).toBe('test-template');
    });

    it('should reject invalid template with missing required fields', () => {
      const invalidTemplate = {
        slug: 'test',
        // missing name, version, etc.
      };

      expect(() => validatePromptTemplate(invalidTemplate)).toThrow();
    });
  });

  describe('validateVariablePlaceholders', () => {
    it('should return empty array for valid variables', () => {
      const template = {
        slug: 'test',
        name: 'Test',
        version: 1,
        category: 'test',
        description: 'Test',
        exported_at: '2025-01-01T00:00:00.000Z',
        llm: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          max_tokens: 500,
          temperature: 0.5,
        },
        system_prompts: [],
        user_prompt: 'Hello {{name}}!',
        variables: {
          name: { type: 'string', required: true, description: 'Name' },
        },
        output: {
          type: 'object',
          schema: { type: 'zod', definition: 'z.object({})' },
        },
      };

      const errors = validateVariablePlaceholders(template as never);
      expect(errors).toHaveLength(0);
    });

    it('should detect undefined variables in user_prompt', () => {
      const template = {
        slug: 'test',
        name: 'Test',
        version: 1,
        category: 'test',
        description: 'Test',
        exported_at: '2025-01-01T00:00:00.000Z',
        llm: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          max_tokens: 500,
          temperature: 0.5,
        },
        system_prompts: [],
        user_prompt: 'Hello {{name}} from {{city}}!',
        variables: {
          name: { type: 'string', required: true, description: 'Name' },
          // 'city' is not defined
        },
        output: {
          type: 'object',
          schema: { type: 'zod', definition: 'z.object({})' },
        },
      };

      const errors = validateVariablePlaceholders(template as never);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes('city'))).toBe(true);
    });
  });

  describe('validateZodSchemaCompilation', () => {
    it('should compile valid Zod schema', () => {
      const result = validateZodSchemaCompilation(
        'z.object({ name: z.string() })',
      );
      expect(result.success).toBe(true);
    });

    it('should reject invalid Zod schema', () => {
      const result = validateZodSchemaCompilation('z.invalid()');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('validateExampleOutput', () => {
    it('should validate matching example output', () => {
      const template = {
        output: {
          type: 'object',
          schema: {
            type: 'zod',
            definition: 'z.object({ message: z.string() })',
          },
          example_output: {
            message: 'Hello world',
          },
        },
      };

      const result = validateExampleOutput(template as never);
      expect(result.success).toBe(true);
    });

    it('should reject non-matching example output', () => {
      const template = {
        output: {
          type: 'object',
          schema: {
            type: 'zod',
            definition: 'z.object({ message: z.string() })',
          },
          example_output: {
            wrongField: 123,
          },
        },
      };

      const result = validateExampleOutput(template as never);
      expect(result.success).toBe(false);
    });

    it('should handle templates without example_output', () => {
      const template = {
        output: {
          type: 'object',
          schema: {
            type: 'zod',
            definition: 'z.object({ message: z.string() })',
          },
        },
      };

      const result = validateExampleOutput(template as never);
      expect(result.success).toBe(true);
    });
  });
});
