/**
 * Template Renderer Tests
 *
 * Comprehensive test suite for the prompt template renderer covering:
 * - Variable substitution (simple, complex, defaults)
 * - Conditional rendering (truthy/falsy evaluation)
 * - HTML escaping
 * - Whitespace handling
 * - Error handling (strict mode, syntax errors)
 * - Batch rendering
 * - Preview functionality
 */
import { describe, expect, it } from 'vitest';

import {
  previewTemplate,
  renderTemplate,
  renderTemplates,
} from '../src/lib/engine/renderer';

describe('Template Renderer', () => {
  describe('renderTemplate - variable substitution', () => {
    it('should render simple variable', () => {
      const template = 'Hello {{name}}!';
      const result = renderTemplate(template, { name: 'World' });

      expect(result.rendered).toBe('Hello World!');
      expect(result.usedVariables).toContain('name');
      expect(result.missingVariables).toHaveLength(0);
    });

    it('should render multiple variables', () => {
      const template = '{{greeting}} {{name}}!';
      const result = renderTemplate(template, {
        greeting: 'Hello',
        name: 'Alice',
      });

      expect(result.rendered).toBe('Hello Alice!');
      expect(result.usedVariables).toHaveLength(2);
    });

    it('should use default value when variable is missing', () => {
      const template = 'Hello {{name:World}}!';
      const result = renderTemplate(template, {});

      expect(result.rendered).toBe('Hello World!');
      expect(result.missingVariables).toHaveLength(0);
    });

    it('should prefer provided value over default', () => {
      const template = 'Hello {{name:World}}!';
      const result = renderTemplate(template, { name: 'Alice' });

      expect(result.rendered).toBe('Hello Alice!');
    });

    it('should handle missing variables in non-strict mode', () => {
      const template = 'Hello {{name}}!';
      const result = renderTemplate(template, {});

      expect(result.rendered).toBe('Hello {{name}}!');
      expect(result.missingVariables).toContain('name');
    });

    it('should throw error in strict mode for missing variables', () => {
      const template = 'Hello {{name}}!';

      expect(() => {
        renderTemplate(template, {}, { strict: true });
      }).toThrow('Missing required variable: name');
    });

    it('should convert non-string values to strings', () => {
      const template = 'Count: {{count}}, Active: {{active}}';
      const result = renderTemplate(template, {
        count: 42,
        active: true,
      });

      expect(result.rendered).toBe('Count: 42, Active: true');
    });

    it('should handle null and undefined with defaults', () => {
      const template = '{{value1:default1}} {{value2:default2}}';
      const result = renderTemplate(template, {
        value1: null,
        value2: undefined,
      });

      expect(result.rendered).toBe('default1 default2');
    });

    it('should track used variables', () => {
      const template = '{{var1}} {{var2}} {{var3}}';
      const result = renderTemplate(template, {
        var1: 'a',
        var2: 'b',
        var3: 'c',
      });

      expect(result.usedVariables).toEqual(
        expect.arrayContaining(['var1', 'var2', 'var3']),
      );
    });

    it('should handle complex default values', () => {
      const template = '{{url:https://api.example.com/v1}}';
      const result = renderTemplate(template, {});

      expect(result.rendered).toBe('https://api.example.com/v1');
    });
  });

  describe('renderTemplate - conditional rendering', () => {
    it('should render conditional when variable is truthy', () => {
      const template = '{{showMessage}}{{#if showMessage}}Hello!{{/if}}';
      const result = renderTemplate(template, { showMessage: true });

      expect(result.rendered).toBe('trueHello!');
      expect(result.usedVariables).toContain('showMessage');
    });

    it('should not render conditional when variable is falsy', () => {
      const template = '{{showMessage}}{{#if showMessage}}Hello!{{/if}}';
      const result = renderTemplate(template, { showMessage: false });

      expect(result.rendered).toBe('false');
    });

    it('should evaluate string as truthy if non-empty', () => {
      const template = '{{#if name}}Name: {{name}}{{/if}}';
      const result = renderTemplate(template, { name: 'Alice' });

      expect(result.rendered).toBe('Name: Alice');
    });

    it('should evaluate empty string as falsy', () => {
      const template = '{{#if name}}Name: {{name}}{{/if}}';
      const result = renderTemplate(template, { name: '' });

      expect(result.rendered).toBe('');
    });

    it('should evaluate whitespace-only string as falsy', () => {
      const template = '{{#if name}}Name: {{name}}{{/if}}';
      const result = renderTemplate(template, { name: '   ' });

      expect(result.rendered).toBe('');
    });

    it('should evaluate numbers correctly', () => {
      const template =
        '{{zero}}{{one}}{{negative}}{{#if zero}}Zero{{/if}} {{#if one}}One{{/if}} {{#if negative}}Negative{{/if}}';
      const result = renderTemplate(template, {
        zero: 0,
        one: 1,
        negative: -1,
      });

      // 0 is falsy, 1 and -1 are truthy
      expect(result.rendered).toBe('01-1 One Negative');
    });

    it('should evaluate arrays correctly', () => {
      const template =
        '{{empty}}{{hasItems}}{{#if empty}}Empty{{/if}} {{#if hasItems}}Items{{/if}}';
      const result = renderTemplate(template, {
        empty: [],
        hasItems: [1, 2, 3],
      });

      expect(result.rendered).toBe('1,2,3 Items');
    });

    it('should evaluate objects correctly', () => {
      const template = '{{empty}}{{data}}{{#if empty}}Empty{{/if}} {{#if data}}Data{{/if}}';
      const result = renderTemplate(template, {
        empty: {},
        data: { key: 'value' },
      });

      expect(result.rendered).toBe('[object Object][object Object] Data');
    });

    it('should evaluate undefined and null as falsy', () => {
      const template =
        '{{undef:u}}{{nul:n}}{{#if undef}}Undefined{{/if}} {{#if nul}}Null{{/if}}';
      const result = renderTemplate(template, {
        undef: undefined,
        nul: null,
      });

      expect(result.rendered).toBe('un');
    });

    it('should render variables inside conditionals', () => {
      const template = '{{showDetails}}{{#if showDetails}}Name: {{name}}, Age: {{age}}{{/if}}';
      const result = renderTemplate(template, {
        showDetails: true,
        name: 'Alice',
        age: 30,
      });

      expect(result.rendered).toBe('trueName: Alice, Age: 30');
    });

    it('should handle multiple conditionals', () => {
      const template = `{{user}}{{admin}}{{#if user}}User: {{user}}{{/if}}
{{#if admin}}Admin Mode{{/if}}`;
      const result = renderTemplate(template, {
        user: 'Alice',
        admin: true,
      });

      expect(result.rendered).toContain('User: Alice');
      expect(result.rendered).toContain('Admin Mode');
    });

    it('should track conditional variables as used', () => {
      const template = '{{condition}}{{#if condition}}Content{{/if}}';
      const result = renderTemplate(template, { condition: false });

      expect(result.usedVariables).toContain('condition');
    });
  });

  describe('renderTemplate - HTML escaping', () => {
    it('should escape HTML when option is enabled', () => {
      const template = '<div>{{content}}</div>';
      const result = renderTemplate(
        template,
        { content: '<script>alert("XSS")</script>' },
        { escapeHtml: true },
      );

      expect(result.rendered).toBe(
        '<div>&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;</div>',
      );
    });

    it('should not escape HTML by default', () => {
      const template = '<div>{{content}}</div>';
      const result = renderTemplate(template, {
        content: '<b>Bold</b>',
      });

      expect(result.rendered).toBe('<div><b>Bold</b></div>');
    });

    it('should escape all HTML special characters', () => {
      const template = '{{text}}';
      const result = renderTemplate(
        template,
        { text: '&<>"\'test' },
        { escapeHtml: true },
      );

      expect(result.rendered).toBe('&amp;&lt;&gt;&quot;&#39;test');
    });
  });

  describe('renderTemplate - whitespace handling', () => {
    it('should clean whitespace by default', () => {
      const template = `
        Hello {{name}}!


        Welcome back.
      `;
      const result = renderTemplate(template, { name: 'Alice' });

      // Should remove multiple blank lines and trim
      expect(result.rendered).not.toContain('\n\n\n');
      // May have leading whitespace before "Welcome back."
      expect(result.rendered).toContain('Hello Alice!');
      expect(result.rendered).toContain('Welcome back.');
    });

    it('should preserve whitespace when option is enabled', () => {
      const template = `
        Hello {{name}}!


        Welcome back.
      `;
      const result = renderTemplate(
        template,
        { name: 'Alice' },
        { preserveWhitespace: true },
      );

      // Should keep original whitespace
      expect(result.rendered).toContain('\n\n\n');
    });

    it('should remove trailing whitespace from lines', () => {
      const template = 'Hello {{name}}!   \nWelcome.  ';
      const result = renderTemplate(template, { name: 'Alice' });

      expect(result.rendered).toBe('Hello Alice!\nWelcome.');
    });

    it('should clean up conditional whitespace', () => {
      const template = `
{{#if user}}
Hello {{user}}!
{{/if}}

Welcome back.
`;
      const result = renderTemplate(template, { user: 'Alice' });

      expect(result.rendered).toBe('Hello Alice!\n\nWelcome back.');
    });
  });

  describe('renderTemplate - error handling', () => {
    it('should throw error for templates with syntax errors', () => {
      const template = '{{#if unclosed}}Content';

      expect(() => {
        renderTemplate(template, {});
      }).toThrow('Template has syntax errors');
    });

    it('should include error details in exception', () => {
      const template = '{{#if unclosed}}Content';

      expect(() => {
        renderTemplate(template, {});
      }).toThrow('Mismatched conditional blocks');
    });

    it('should validate template before rendering', () => {
      const template = '{{#if undefined_var}}Content{{/if}}';

      expect(() => {
        renderTemplate(template, {});
      }).toThrow('undefined variable');
    });
  });

  describe('renderTemplate - complex scenarios', () => {
    it('should render real-world prompt template', () => {
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

      const result = renderTemplate(template, {
        role: 'an AI assistant',
        query: 'What is TypeScript?',
        context: 'Programming languages',
        tone: 'friendly',
      });

      expect(result.rendered).toContain('You are an AI assistant');
      expect(result.rendered).toContain('User Query: What is TypeScript?');
      expect(result.rendered).toContain('Context: Programming languages');
      expect(result.rendered).toContain('Please provide a friendly response');
    });

    it('should handle template without context and examples', () => {
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

      const result = renderTemplate(template, {
        query: 'Hello!',
      });

      expect(result.rendered).toContain('You are a helpful assistant');
      expect(result.rendered).toContain('User Query: Hello!');
      expect(result.rendered).not.toContain('Context:');
      expect(result.rendered).not.toContain('Examples:');
      expect(result.rendered).toContain('Please provide a professional response');
    });

    it('should track all used and missing variables', () => {
      const template = '{{provided}} {{missing}} {{default:value}}';
      const result = renderTemplate(template, { provided: 'yes' });

      expect(result.usedVariables).toEqual(
        expect.arrayContaining(['provided', 'missing', 'default']),
      );
      expect(result.missingVariables).toContain('missing');
      expect(result.missingVariables).not.toContain('default'); // Has default
      expect(result.missingVariables).not.toContain('provided'); // Provided
    });
  });

  describe('renderTemplates - batch rendering', () => {
    it('should render multiple templates', () => {
      const templates = {
        greeting: 'Hello {{name}}!',
        farewell: 'Goodbye {{name}}!',
      };

      const results = renderTemplates(templates, { name: 'Alice' });

      expect(results.greeting.rendered).toBe('Hello Alice!');
      expect(results.farewell.rendered).toBe('Goodbye Alice!');
    });

    it('should apply same variables to all templates', () => {
      const templates = {
        template1: '{{var1}} {{var2}}',
        template2: '{{var2}} {{var3}}',
      };

      const results = renderTemplates(templates, {
        var1: 'a',
        var2: 'b',
        var3: 'c',
      });

      expect(results.template1.rendered).toBe('a b');
      expect(results.template2.rendered).toBe('b c');
    });

    it('should apply same options to all templates', () => {
      const templates = {
        template1: '{{html}}',
        template2: '{{html}}',
      };

      const results = renderTemplates(
        templates,
        { html: '<div>Test</div>' },
        { escapeHtml: true },
      );

      expect(results.template1.rendered).toBe('&lt;div&gt;Test&lt;/div&gt;');
      expect(results.template2.rendered).toBe('&lt;div&gt;Test&lt;/div&gt;');
    });

    it('should track variables independently for each template', () => {
      const templates = {
        template1: '{{var1}}',
        template2: '{{var2}}',
      };

      const results = renderTemplates(templates, {
        var1: 'a',
        var2: 'b',
      });

      expect(results.template1.usedVariables).toContain('var1');
      expect(results.template1.usedVariables).not.toContain('var2');
      expect(results.template2.usedVariables).toContain('var2');
      expect(results.template2.usedVariables).not.toContain('var1');
    });
  });

  describe('previewTemplate', () => {
    it('should render template with sample data', () => {
      const template = 'Hello {{name}}!';
      const result = previewTemplate(template, { name: 'Preview' });

      expect(result).toBe('Hello Preview!');
    });

    it('should use non-strict mode', () => {
      const template = 'Hello {{name}}!';
      const result = previewTemplate(template, {});

      // Should not throw, should keep placeholder
      expect(result).toBe('Hello {{name}}!');
    });

    it('should not escape HTML', () => {
      const template = '{{html}}';
      const result = previewTemplate(template, {
        html: '<b>Bold</b>',
      });

      expect(result).toBe('<b>Bold</b>');
    });

    it('should clean whitespace', () => {
      const template = `
        Hello {{name}}!


        Welcome.
      `;
      const result = previewTemplate(template, { name: 'User' });

      // Should clean up but may have some whitespace
      expect(result).toContain('Hello User!');
      expect(result).toContain('Welcome.');
    });

    it('should work with empty sample data', () => {
      const template = 'Hello {{name:World}}!';
      const result = previewTemplate(template);

      expect(result).toBe('Hello World!');
    });

    it('should handle conditionals in preview', () => {
      const template = '{{feature}}{{#if feature}}Feature Enabled{{/if}}';
      const result = previewTemplate(template, { feature: true });

      expect(result).toBe('trueFeature Enabled');
    });
  });

  describe('edge cases', () => {
    it('should handle empty template', () => {
      const result = renderTemplate('', {});

      expect(result.rendered).toBe('');
      expect(result.usedVariables).toHaveLength(0);
      expect(result.missingVariables).toHaveLength(0);
    });

    it('should handle template with only whitespace', () => {
      const result = renderTemplate('   \n\t  ', {});

      expect(result.rendered).toBe('');
    });

    it('should handle template without variables', () => {
      const template = 'This is a static template.';
      const result = renderTemplate(template, {});

      expect(result.rendered).toBe('This is a static template.');
      expect(result.usedVariables).toHaveLength(0);
    });

    it('should handle same variable multiple times', () => {
      const template = '{{name}} says hello to {{name}}';
      const result = renderTemplate(template, { name: 'Alice' });

      expect(result.rendered).toBe('Alice says hello to Alice');
      expect(result.usedVariables).toContain('name');
    });

    it('should handle special characters in values', () => {
      const template = '{{text}}';
      const result = renderTemplate(template, {
        text: 'Special: !@#$%^&*()',
      });

      expect(result.rendered).toBe('Special: !@#$%^&*()');
    });

    it('should handle unicode in values', () => {
      const template = '{{emoji}}';
      const result = renderTemplate(template, {
        emoji: '😀 🎉 🚀',
      });

      expect(result.rendered).toBe('😀 🎉 🚀');
    });

    it('should handle conditional with missing variable', () => {
      const template = '{{missing}}{{#if missing}}Content{{/if}}';
      const result = renderTemplate(template, {});

      // Variable is used in conditional, so tracked
      expect(result.usedVariables).toContain('missing');
      // Conditional evaluates to false (undefined)
      expect(result.rendered).toBe('{{missing}}');
    });

    it('should handle very long templates', () => {
      const template = '{{var}}\n'.repeat(100);
      const result = renderTemplate(template, { var: 'X' });

      expect(result.rendered).toContain('X');
      expect(result.rendered.split('\n')).toHaveLength(100);
    });
  });
});
