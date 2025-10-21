/**
 * Template Parser Tests
 *
 * Comprehensive test suite for the prompt template parser covering:
 * - Variable extraction and parsing
 * - Default value handling
 * - Conditional block parsing
 * - Error detection (unclosed blocks, undefined variables)
 * - Helper functions (getVariableNames, hasVariable, getDefaultValues)
 * - Template validation
 */
import { describe, expect, it } from 'vitest';

import {
  getDefaultValues,
  getVariableNames,
  hasVariable,
  parseTemplate,
  validateTemplateSyntax,
} from '../src/lib/engine/parser';

describe('Template Parser', () => {
  describe('parseTemplate', () => {
    describe('variable extraction', () => {
      it('should parse simple variables', () => {
        const template = 'Hello {{name}}!';
        const parsed = parseTemplate(template);

        expect(parsed.variables).toHaveLength(1);
        expect(parsed.variables[0]).toEqual({
          name: 'name',
          defaultValue: undefined,
          position: 6,
          length: 8,
        });
        expect(parsed.hasErrors).toBe(false);
      });

      it('should parse multiple variables', () => {
        const template = 'Hello {{firstName}} {{lastName}}!';
        const parsed = parseTemplate(template);

        expect(parsed.variables).toHaveLength(2);
        expect(parsed.variables[0]?.name).toBe('firstName');
        expect(parsed.variables[1]?.name).toBe('lastName');
        expect(parsed.hasErrors).toBe(false);
      });

      it('should parse variables with default values', () => {
        const template = 'Hello {{name:World}}!';
        const parsed = parseTemplate(template);

        expect(parsed.variables).toHaveLength(1);
        expect(parsed.variables[0]).toEqual({
          name: 'name',
          defaultValue: 'World',
          position: 6,
          length: 14,
        });
      });

      it('should parse variables with complex default values', () => {
        const template = 'API: {{endpoint:https://api.example.com/v1}}';
        const parsed = parseTemplate(template);

        expect(parsed.variables[0]?.defaultValue).toBe(
          'https://api.example.com/v1',
        );
      });

      it('should handle variables with underscores and numbers', () => {
        const template = '{{user_id_123}} {{API_KEY2}}';
        const parsed = parseTemplate(template);

        expect(parsed.variables).toHaveLength(2);
        expect(parsed.variables[0]?.name).toBe('user_id_123');
        expect(parsed.variables[1]?.name).toBe('API_KEY2');
      });

      it('should handle multiple occurrences of same variable', () => {
        const template = '{{name}} says hello to {{name}}';
        const parsed = parseTemplate(template);

        expect(parsed.variables).toHaveLength(2);
        expect(parsed.variables[0]?.name).toBe('name');
        expect(parsed.variables[1]?.name).toBe('name');
        expect(parsed.variables[0]?.position).toBe(0);
        expect(parsed.variables[1]?.position).toBe(23); // Position is 23, not 24
      });

      it('should handle empty template', () => {
        const template = '';
        const parsed = parseTemplate(template);

        expect(parsed.variables).toHaveLength(0);
        expect(parsed.conditionals).toHaveLength(0);
        expect(parsed.hasErrors).toBe(false);
      });

      it('should handle template without variables', () => {
        const template = 'Hello World!';
        const parsed = parseTemplate(template);

        expect(parsed.variables).toHaveLength(0);
        expect(parsed.conditionals).toHaveLength(0);
        expect(parsed.hasErrors).toBe(false);
      });
    });

    describe('conditional block parsing', () => {
      it('should parse simple conditional', () => {
        const template = '{{#if isActive}}Active{{/if}}';
        const parsed = parseTemplate(template);

        expect(parsed.conditionals).toHaveLength(1);
        expect(parsed.conditionals[0]).toEqual({
          variable: 'isActive',
          startPosition: 0,
          endPosition: 29, // Template length is 29
          content: 'Active',
        });
      });

      it('should parse conditional with nested content', () => {
        const template =
          'Status: {{#if isPremium}}Premium Member{{/if}}';
        const parsed = parseTemplate(template);

        expect(parsed.conditionals[0]?.content).toBe('Premium Member');
      });

      it('should parse multiple conditionals', () => {
        const template =
          '{{#if user}}Hello {{user}}{{/if}} {{#if admin}}Admin{{/if}}';
        const parsed = parseTemplate(template);

        expect(parsed.conditionals).toHaveLength(2);
        expect(parsed.conditionals[0]?.variable).toBe('user');
        expect(parsed.conditionals[1]?.variable).toBe('admin');
      });

      it('should parse conditional with multiline content', () => {
        const template = `{{#if showDetails}}
Name: {{name}}
Email: {{email}}
{{/if}}`;
        const parsed = parseTemplate(template);

        expect(parsed.conditionals).toHaveLength(1);
        expect(parsed.conditionals[0]?.content).toContain('Name: {{name}}');
        expect(parsed.conditionals[0]?.content).toContain('Email: {{email}}');
      });

      it('should error when conditional uses undefined variable', () => {
        const template = '{{#if undefinedVar}}Content{{/if}}';
        const parsed = parseTemplate(template);

        expect(parsed.hasErrors).toBe(true);
        expect(parsed.errors).toHaveLength(1);
        expect(parsed.errors[0]).toContain('undefined variable');
        expect(parsed.errors[0]).toContain('undefinedVar');
      });

      it('should not error when conditional variable is defined', () => {
        const template = '{{isActive}}{{#if isActive}}Active{{/if}}';
        const parsed = parseTemplate(template);

        expect(parsed.hasErrors).toBe(false);
        expect(parsed.errors).toHaveLength(0);
      });

      it('should detect unclosed conditional blocks', () => {
        const template = '{{#if user}}Hello {{user}}';
        const parsed = parseTemplate(template);

        expect(parsed.hasErrors).toBe(true);
        expect(parsed.errors).toHaveLength(1);
        expect(parsed.errors[0]).toContain('Mismatched conditional blocks');
        expect(parsed.errors[0]).toContain('1 opening, 0 closing');
      });

      it('should detect extra closing blocks', () => {
        const template = 'Hello{{/if}}';
        const parsed = parseTemplate(template);

        expect(parsed.hasErrors).toBe(true);
        expect(parsed.errors[0]).toContain('0 opening, 1 closing');
      });

      it('should handle nested errors', () => {
        const template = '{{outer}}{{#if outer}}{{#if inner}}Content{{/if}}';
        const parsed = parseTemplate(template);

        expect(parsed.hasErrors).toBe(true);
        // Should have mismatched conditionals error (2 open, 1 close)
        expect(parsed.errors.some((e) => e.includes('Mismatched'))).toBe(true);
      });
    });

    describe('complex scenarios', () => {
      it('should parse template with variables and conditionals', () => {
        const template = `Hello {{name}}!
{{#if isPremium}}
You are a premium member with {{points}} points.
{{/if}}`;
        const parsed = parseTemplate(template);

        expect(parsed.variables).toHaveLength(2);
        expect(parsed.variables.map((v) => v.name)).toContain('name');
        expect(parsed.variables.map((v) => v.name)).toContain('points');
        expect(parsed.conditionals).toHaveLength(1);
        expect(parsed.conditionals[0]?.variable).toBe('isPremium');
      });

      it('should handle real-world prompt template', () => {
        const template = `You are {{role:a helpful assistant}}.

User Query: {{query}}

{{#if context}}
Context: {{context}}
{{/if}}

{{#if examples}}
Examples:
{{examples}}
{{/if}}

Please provide a {{tone:professional}} response.`;

        const parsed = parseTemplate(template);

        expect(parsed.variables.map((v) => v.name)).toContain('role');
        expect(parsed.variables.map((v) => v.name)).toContain('query');
        expect(parsed.variables.map((v) => v.name)).toContain('context');
        expect(parsed.variables.map((v) => v.name)).toContain('examples');
        expect(parsed.variables.map((v) => v.name)).toContain('tone');

        expect(parsed.conditionals).toHaveLength(2);
        expect(parsed.hasErrors).toBe(false);
      });

      it('should preserve original template', () => {
        const template = 'Original {{var}} template';
        const parsed = parseTemplate(template);

        expect(parsed.raw).toBe(template);
      });
    });

    describe('edge cases', () => {
      it('should handle template with only whitespace', () => {
        const template = '   \n\t  ';
        const parsed = parseTemplate(template);

        expect(parsed.variables).toHaveLength(0);
        expect(parsed.conditionals).toHaveLength(0);
        expect(parsed.hasErrors).toBe(false);
      });

      it('should handle malformed variable syntax (not parsed)', () => {
        const template = '{name} {{{name}}}';
        const parsed = parseTemplate(template);

        // {{{name}}} contains {{name}} which matches the pattern
        // So we expect 1 variable to be found
        expect(parsed.variables).toHaveLength(1);
        expect(parsed.variables[0]?.name).toBe('name');
      });

      it('should handle conditional with empty content', () => {
        const template = '{{#if empty}}{{/if}}';
        const parsed = parseTemplate(template);

        expect(parsed.conditionals).toHaveLength(1);
        expect(parsed.conditionals[0]?.content).toBe('');
      });

      it('should handle special characters in default values', () => {
        const template = '{{msg:Hello, "World"!}}';
        const parsed = parseTemplate(template);

        expect(parsed.variables[0]?.defaultValue).toBe('Hello, "World"!');
      });
    });
  });

  describe('getVariableNames', () => {
    it('should return unique variable names', () => {
      const template = '{{name}} and {{name}} and {{age}}';
      const parsed = parseTemplate(template);
      const names = getVariableNames(parsed);

      expect(names).toHaveLength(2);
      expect(names).toContain('name');
      expect(names).toContain('age');
    });

    it('should include conditional variable names', () => {
      const template = '{{user}}{{#if showDetails}}Details{{/if}}';
      const parsed = parseTemplate(template);
      const names = getVariableNames(parsed);

      expect(names).toHaveLength(2);
      expect(names).toContain('user');
      expect(names).toContain('showDetails');
    });

    it('should return sorted names', () => {
      const template = '{{zebra}} {{apple}} {{banana}}';
      const parsed = parseTemplate(template);
      const names = getVariableNames(parsed);

      expect(names).toEqual(['apple', 'banana', 'zebra']);
    });

    it('should return empty array for template without variables', () => {
      const template = 'No variables here';
      const parsed = parseTemplate(template);
      const names = getVariableNames(parsed);

      expect(names).toHaveLength(0);
    });
  });

  describe('hasVariable', () => {
    it('should return true when variable exists', () => {
      const template = 'Hello {{name}}!';
      const parsed = parseTemplate(template);

      expect(hasVariable(parsed, 'name')).toBe(true);
    });

    it('should return false when variable does not exist', () => {
      const template = 'Hello {{name}}!';
      const parsed = parseTemplate(template);

      expect(hasVariable(parsed, 'age')).toBe(false);
    });

    it('should find variables in conditionals', () => {
      const template = '{{#if isActive}}Active{{/if}}';
      const parsed = parseTemplate(template);

      expect(hasVariable(parsed, 'isActive')).toBe(true);
    });

    it('should be case sensitive', () => {
      const template = '{{Name}}';
      const parsed = parseTemplate(template);

      expect(hasVariable(parsed, 'Name')).toBe(true);
      expect(hasVariable(parsed, 'name')).toBe(false);
    });
  });

  describe('getDefaultValues', () => {
    it('should extract default values', () => {
      const template = '{{name:John}} {{age:25}}';
      const parsed = parseTemplate(template);
      const defaults = getDefaultValues(parsed);

      expect(defaults).toEqual({
        name: 'John',
        age: '25',
      });
    });

    it('should return empty object when no defaults', () => {
      const template = '{{name}} {{age}}';
      const parsed = parseTemplate(template);
      const defaults = getDefaultValues(parsed);

      expect(defaults).toEqual({});
    });

    it('should handle mix of variables with and without defaults', () => {
      const template = '{{name:John}} {{age}} {{city:NYC}}';
      const parsed = parseTemplate(template);
      const defaults = getDefaultValues(parsed);

      expect(defaults).toEqual({
        name: 'John',
        city: 'NYC',
      });
      expect(defaults.age).toBeUndefined();
    });

    it('should use last default value for duplicate variables', () => {
      const template = '{{name:John}} {{name:Jane}}';
      const parsed = parseTemplate(template);
      const defaults = getDefaultValues(parsed);

      // Should use the last occurrence
      expect(defaults.name).toBe('Jane');
    });
  });

  describe('validateTemplateSyntax', () => {
    it('should return valid for correct template', () => {
      const template = 'Hello {{name}}!';
      const result = validateTemplateSyntax(template);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return invalid for unclosed conditional', () => {
      const template = '{{#if user}}Hello';
      const result = validateTemplateSyntax(template);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Mismatched');
    });

    it('should return invalid for undefined conditional variable', () => {
      const template = '{{#if undefinedVar}}Content{{/if}}';
      const result = validateTemplateSyntax(template);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('undefined variable');
    });

    it('should accumulate multiple errors', () => {
      const template = '{{#if undefined1}}A{{/if}} {{#if undefined2}}B';
      const result = validateTemplateSyntax(template);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate complex template correctly', () => {
      const template = `{{role:assistant}}
{{query}}
{{#if context}}Context: {{context}}{{/if}}
{{#if examples}}Examples: {{examples}}{{/if}}`;

      const result = validateTemplateSyntax(template);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('position tracking', () => {
    it('should track correct positions for variables', () => {
      const template = '0123{{var}}456';
      const parsed = parseTemplate(template);

      expect(parsed.variables[0]?.position).toBe(4);
      expect(parsed.variables[0]?.length).toBe(7);
    });

    it('should track positions for multiple variables', () => {
      const template = '{{first}} middle {{second}}';
      const parsed = parseTemplate(template);

      expect(parsed.variables[0]?.position).toBe(0);
      expect(parsed.variables[1]?.position).toBe(17);
    });

    it('should track conditional block positions', () => {
      const template = 'Start {{#if var}}content{{/if}} End';
      const parsed = parseTemplate(template);

      expect(parsed.conditionals[0]?.startPosition).toBe(6);
      expect(parsed.conditionals[0]?.endPosition).toBe(31);
    });
  });
});
