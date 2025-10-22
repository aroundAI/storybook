/**
 * System Prompt Composer Tests
 *
 * Comprehensive test suite for the system prompt composer covering:
 * - Multi-layer composition (compliance, role, context, etc.)
 * - Priority-based ordering within layers
 * - Conditional inclusion based on context
 * - Composition hashing
 * - Utility functions (merge, format, compare, getUsedLayers)
 */
import { describe, expect, it } from 'vitest';

import {
  compareCompositions,
  composeSystemPrompts,
  formatCompositionForDisplay,
  getUsedLayers,
  mergePrompts,
} from '../src/lib/engine/composer';
import type { PromptSystemPrompt, SystemPromptLayer } from '../src/lib/types';

// Helper to create mock system prompts
function createMockPrompt(
  id: string,
  slug: string,
  layer: SystemPromptLayer,
  content: string,
  priority: number = 0,
  conditionRules?: Record<string, unknown>,
): PromptSystemPrompt {
  return {
    id,
    slug,
    layer_type: layer,
    scope: 'global',
    content,
    priority,
    condition_rules: conditionRules || null,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    account_id: null,
    created_by: 'test-user',
  } as PromptSystemPrompt;
}

describe('System Prompt Composer', () => {
  describe('composeSystemPrompts', () => {
    describe('layer ordering', () => {
      it('should compose prompts in correct layer order', () => {
        const prompts = [
          createMockPrompt('3', 'example', 'examples', 'Examples here', 0),
          createMockPrompt('1', 'comply', 'compliance', 'GDPR compliance', 0),
          createMockPrompt('2', 'assistant', 'role', 'You are helpful', 0),
        ];

        const result = composeSystemPrompts(prompts);

        // Should be ordered: compliance -> role -> examples
        expect(result.system_prompts[0]?.layer).toBe('compliance');
        expect(result.system_prompts[1]?.layer).toBe('role');
        expect(result.system_prompts[2]?.layer).toBe('examples');
      });

      it('should handle all layer types in order', () => {
        const prompts = [
          createMockPrompt('8', 'ex', 'examples', 'Examples', 0),
          createMockPrompt('7', 'con', 'constraints', 'Constraints', 0),
          createMockPrompt('6', 'std', 'standards', 'Standards', 0),
          createMockPrompt('5', 'fmt', 'format', 'Format', 0),
          createMockPrompt('4', 'bv', 'brand_voice', 'Brand Voice', 0),
          createMockPrompt('3', 'ctx', 'context', 'Context', 0),
          createMockPrompt('2', 'role', 'role', 'Role', 0),
          createMockPrompt('1', 'comp', 'compliance', 'Compliance', 0),
        ];

        const result = composeSystemPrompts(prompts);

        const layers = result.system_prompts.map((p) => p.layer);
        expect(layers).toEqual([
          'compliance',
          'role',
          'context',
          'brand_voice',
          'format',
          'standards',
          'constraints',
          'examples',
        ]);
      });
    });

    describe('priority ordering', () => {
      it('should sort by priority within same layer (highest first)', () => {
        const prompts = [
          createMockPrompt('1', 'low', 'role', 'Low priority', 1),
          createMockPrompt('2', 'high', 'role', 'High priority', 10),
          createMockPrompt('3', 'med', 'role', 'Medium priority', 5),
        ];

        const result = composeSystemPrompts(prompts);

        // Within role layer: should be ordered by priority (high -> med -> low)
        expect(result.system_prompts[0]?.priority).toBe(10);
        expect(result.system_prompts[1]?.priority).toBe(5);
        expect(result.system_prompts[2]?.priority).toBe(1);
      });

      it('should handle negative priorities', () => {
        const prompts = [
          createMockPrompt('1', 'neg', 'role', 'Negative', -5),
          createMockPrompt('2', 'zero', 'role', 'Zero', 0),
          createMockPrompt('3', 'pos', 'role', 'Positive', 5),
        ];

        const result = composeSystemPrompts(prompts);

        expect(result.system_prompts[0]?.priority).toBe(5);
        expect(result.system_prompts[1]?.priority).toBe(0);
        expect(result.system_prompts[2]?.priority).toBe(-5);
      });

      it('should maintain layer order over priority', () => {
        const prompts = [
          createMockPrompt('1', 'low-comp', 'compliance', 'Compliance', 1),
          createMockPrompt('2', 'high-role', 'role', 'Role', 100),
        ];

        const result = composeSystemPrompts(prompts);

        // compliance comes before role regardless of priority
        expect(result.system_prompts[0]?.layer).toBe('compliance');
        expect(result.system_prompts[1]?.layer).toBe('role');
      });
    });

    describe('conditional inclusion', () => {
      it('should include prompts without conditions', () => {
        const prompts = [
          createMockPrompt('1', 'always', 'role', 'Always included', 0),
        ];

        const result = composeSystemPrompts(prompts);

        expect(result.system_prompts).toHaveLength(1);
      });

      it('should filter based on context conditions', () => {
        const prompts = [
          createMockPrompt('1', 'prod', 'role', 'Production', 0, {
            environment: 'production',
          }),
          createMockPrompt('2', 'dev', 'role', 'Development', 0, {
            environment: 'development',
          }),
        ];

        const result = composeSystemPrompts(prompts, {
          context: { environment: 'production' },
        });

        expect(result.system_prompts).toHaveLength(1);
        expect(result.system_prompts[0]?.slug).toBe('prod');
      });

      it('should support array of acceptable values', () => {
        const prompts = [
          createMockPrompt('1', 'multi', 'role', 'Multi-env', 0, {
            environment: ['production', 'staging'],
          }),
        ];

        // Should match when context value is in array
        const resultProd = composeSystemPrompts(prompts, {
          context: { environment: 'production' },
        });
        expect(resultProd.system_prompts).toHaveLength(1);

        const resultStaging = composeSystemPrompts(prompts, {
          context: { environment: 'staging' },
        });
        expect(resultStaging.system_prompts).toHaveLength(1);

        // Should not match when not in array
        const resultDev = composeSystemPrompts(prompts, {
          context: { environment: 'development' },
        });
        expect(resultDev.system_prompts).toHaveLength(0);
      });

      it('should handle multiple condition rules (AND logic)', () => {
        const prompts = [
          createMockPrompt('1', 'specific', 'role', 'Specific context', 0, {
            environment: 'production',
            region: 'us-east-1',
          }),
        ];

        // Both conditions must match
        const resultMatch = composeSystemPrompts(prompts, {
          context: { environment: 'production', region: 'us-east-1' },
        });
        expect(resultMatch.system_prompts).toHaveLength(1);

        // Missing one condition
        const resultPartial = composeSystemPrompts(prompts, {
          context: { environment: 'production' },
        });
        expect(resultPartial.system_prompts).toHaveLength(0);
      });

      it('should handle null/undefined condition rules', () => {
        const prompts = [
          createMockPrompt(
            '1',
            'null',
            'role',
            'Null conditions',
            0,
            null as any,
          ),
        ];

        const result = composeSystemPrompts(prompts);

        expect(result.system_prompts).toHaveLength(1);
      });
    });

    describe('composition output', () => {
      it('should include prompt metadata', () => {
        const prompts = [
          createMockPrompt('id-123', 'test-prompt', 'role', 'Content', 5),
        ];

        const result = composeSystemPrompts(prompts);

        expect(result.system_prompts[0]).toEqual({
          id: 'id-123',
          slug: 'test-prompt',
          layer: 'role',
          content: 'Content',
          priority: 5,
        });
      });

      it('should generate composition hash', () => {
        const prompts = [createMockPrompt('1', 'test', 'role', 'Content', 0)];

        const result = composeSystemPrompts(prompts);

        expect(result.composition_hash).toBeDefined();
        expect(result.composition_hash).toHaveLength(16);
      });

      it('should generate same hash for same composition', () => {
        const prompts = [
          createMockPrompt('1', 'a', 'role', 'Content A', 0),
          createMockPrompt('2', 'b', 'context', 'Content B', 0),
        ];

        const result1 = composeSystemPrompts(prompts);
        const result2 = composeSystemPrompts(prompts);

        expect(result1.composition_hash).toBe(result2.composition_hash);
      });

      it('should generate different hash for different composition', () => {
        const prompts1 = [createMockPrompt('1', 'a', 'role', 'Content A', 0)];
        const prompts2 = [createMockPrompt('2', 'b', 'role', 'Content B', 0)];

        const result1 = composeSystemPrompts(prompts1);
        const result2 = composeSystemPrompts(prompts2);

        expect(result1.composition_hash).not.toBe(result2.composition_hash);
      });
    });

    describe('options', () => {
      it('should use default options when not provided', () => {
        const prompts = [createMockPrompt('1', 'test', 'role', 'Test', 0)];

        const result = composeSystemPrompts(prompts);

        expect(result.system_prompts).toHaveLength(1);
      });

      it('should accept custom context', () => {
        const prompts = [
          createMockPrompt('1', 'ctx', 'role', 'Contextual', 0, { foo: 'bar' }),
        ];

        const result = composeSystemPrompts(prompts, {
          context: { foo: 'bar' },
        });

        expect(result.system_prompts).toHaveLength(1);
      });
    });

    describe('edge cases', () => {
      it('should handle empty prompts array', () => {
        const result = composeSystemPrompts([]);

        expect(result.system_prompts).toHaveLength(0);
        expect(result.composition_hash).toBeDefined();
      });

      it('should handle all prompts filtered by conditions', () => {
        const prompts = [
          createMockPrompt('1', 'filtered', 'role', 'Filtered', 0, {
            env: 'prod',
          }),
        ];

        const result = composeSystemPrompts(prompts, {
          context: { env: 'dev' },
        });

        expect(result.system_prompts).toHaveLength(0);
      });

      it('should handle multiple prompts in same layer', () => {
        const prompts = [
          createMockPrompt('1', 'role-1', 'role', 'Role 1', 10),
          createMockPrompt('2', 'role-2', 'role', 'Role 2', 5),
          createMockPrompt('3', 'role-3', 'role', 'Role 3', 1),
        ];

        const result = composeSystemPrompts(prompts);

        expect(result.system_prompts).toHaveLength(3);
        expect(result.system_prompts.every((p) => p.layer === 'role')).toBe(
          true,
        );
      });
    });
  });

  describe('mergePrompts', () => {
    it('should merge system and user prompts', () => {
      const result = mergePrompts('System prompt', 'User prompt');

      expect(result.system).toBe('System prompt');
      expect(result.user).toBe('User prompt');
    });

    it('should trim whitespace', () => {
      const result = mergePrompts('  System  ', '  User  ');

      expect(result.system).toBe('System');
      expect(result.user).toBe('User');
    });

    it('should handle empty prompts', () => {
      const result = mergePrompts('', '');

      expect(result.system).toBe('');
      expect(result.user).toBe('');
    });

    it('should handle multiline prompts', () => {
      const system = `Line 1
Line 2
Line 3`;
      const user = `User line 1
User line 2`;

      const result = mergePrompts(system, user);

      expect(result.system).toContain('Line 1');
      expect(result.user).toContain('User line 1');
    });
  });

  describe('formatCompositionForDisplay', () => {
    it('should format composition for display', () => {
      const composition = {
        template_id: 'template-1',
        system_prompts: [
          {
            id: '1',
            slug: 'role',
            layer: 'role' as SystemPromptLayer,
            content: 'You are helpful',
            priority: 10,
          },
        ],
        composition_hash: 'abc123def456',
      };

      const result = formatCompositionForDisplay(composition);

      expect(result).toContain('System Prompt Composition');
      expect(result).toContain('ROLE');
      expect(result).toContain('role (priority: 10)');
      expect(result).toContain('You are helpful');
      expect(result).toContain('abc123def456');
    });

    it('should show layer headers', () => {
      const composition = {
        template_id: 'template-1',
        system_prompts: [
          {
            id: '1',
            slug: 'comp',
            layer: 'compliance' as SystemPromptLayer,
            content: 'GDPR',
            priority: 0,
          },
          {
            id: '2',
            slug: 'role',
            layer: 'role' as SystemPromptLayer,
            content: 'Assistant',
            priority: 0,
          },
        ],
        composition_hash: 'hash',
      };

      const result = formatCompositionForDisplay(composition);

      expect(result).toContain('## COMPLIANCE');
      expect(result).toContain('## ROLE');
    });

    it('should separate layers with empty lines', () => {
      const composition = {
        template_id: 'template-1',
        system_prompts: [
          {
            id: '1',
            slug: 'a',
            layer: 'compliance' as SystemPromptLayer,
            content: 'A',
            priority: 0,
          },
          {
            id: '2',
            slug: 'b',
            layer: 'role' as SystemPromptLayer,
            content: 'B',
            priority: 0,
          },
        ],
        composition_hash: 'hash',
      };

      const result = formatCompositionForDisplay(composition);
      const lines = result.split('\n');

      // Should have empty line between layer sections
      expect(
        lines.some(
          (line, i) => line.includes('## COMPLIANCE') && lines[i + 1] === '',
        ),
      ).toBe(false); // First layer doesn't have preceding empty line
      expect(result).toContain('\n\n## ROLE');
    });
  });

  describe('getUsedLayers', () => {
    it('should extract unique layers', () => {
      const composition = {
        template_id: 'template-1',
        system_prompts: [
          {
            id: '1',
            slug: 'a',
            layer: 'role' as SystemPromptLayer,
            content: 'A',
            priority: 0,
          },
          {
            id: '2',
            slug: 'b',
            layer: 'role' as SystemPromptLayer,
            content: 'B',
            priority: 0,
          },
          {
            id: '3',
            slug: 'c',
            layer: 'context' as SystemPromptLayer,
            content: 'C',
            priority: 0,
          },
        ],
        composition_hash: 'hash',
      };

      const layers = getUsedLayers(composition);

      expect(layers).toHaveLength(2);
      expect(layers).toContain('role');
      expect(layers).toContain('context');
    });

    it('should sort layers in correct order', () => {
      const composition = {
        template_id: 'template-1',
        system_prompts: [
          {
            id: '1',
            slug: 'a',
            layer: 'examples' as SystemPromptLayer,
            content: 'A',
            priority: 0,
          },
          {
            id: '2',
            slug: 'b',
            layer: 'compliance' as SystemPromptLayer,
            content: 'B',
            priority: 0,
          },
          {
            id: '3',
            slug: 'c',
            layer: 'role' as SystemPromptLayer,
            content: 'C',
            priority: 0,
          },
        ],
        composition_hash: 'hash',
      };

      const layers = getUsedLayers(composition);

      expect(layers).toEqual(['compliance', 'role', 'examples']);
    });

    it('should handle empty composition', () => {
      const composition = {
        template_id: 'template-1',
        system_prompts: [],
        composition_hash: 'hash',
      };

      const layers = getUsedLayers(composition);

      expect(layers).toHaveLength(0);
    });
  });

  describe('compareCompositions', () => {
    it('should detect identical compositions', () => {
      const compA = {
        template_id: 'template-1',
        system_prompts: [
          {
            id: '1',
            slug: 'test',
            layer: 'role' as SystemPromptLayer,
            content: 'Test',
            priority: 0,
          },
        ],
        composition_hash: 'same-hash',
      };
      const compB = {
        template_id: 'template-1',
        system_prompts: [
          {
            id: '1',
            slug: 'test',
            layer: 'role' as SystemPromptLayer,
            content: 'Test',
            priority: 0,
          },
        ],
        composition_hash: 'same-hash',
      };

      const result = compareCompositions(compA, compB);

      expect(result.same).toBe(true);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.changed).toHaveLength(0);
    });

    it('should detect added prompts', () => {
      const compA = {
        template_id: 'template-1',
        system_prompts: [
          {
            id: '1',
            slug: 'existing',
            layer: 'role' as SystemPromptLayer,
            content: 'Existing',
            priority: 0,
          },
        ],
        composition_hash: 'hash-a',
      };
      const compB = {
        template_id: 'template-1',
        system_prompts: [
          {
            id: '1',
            slug: 'existing',
            layer: 'role' as SystemPromptLayer,
            content: 'Existing',
            priority: 0,
          },
          {
            id: '2',
            slug: 'new',
            layer: 'context' as SystemPromptLayer,
            content: 'New',
            priority: 0,
          },
        ],
        composition_hash: 'hash-b',
      };

      const result = compareCompositions(compA, compB);

      expect(result.same).toBe(false);
      expect(result.added).toContain('new');
      expect(result.removed).toHaveLength(0);
    });

    it('should detect removed prompts', () => {
      const compA = {
        template_id: 'template-1',
        system_prompts: [
          {
            id: '1',
            slug: 'kept',
            layer: 'role' as SystemPromptLayer,
            content: 'Kept',
            priority: 0,
          },
          {
            id: '2',
            slug: 'removed',
            layer: 'context' as SystemPromptLayer,
            content: 'Removed',
            priority: 0,
          },
        ],
        composition_hash: 'hash-a',
      };
      const compB = {
        template_id: 'template-1',
        system_prompts: [
          {
            id: '1',
            slug: 'kept',
            layer: 'role' as SystemPromptLayer,
            content: 'Kept',
            priority: 0,
          },
        ],
        composition_hash: 'hash-b',
      };

      const result = compareCompositions(compA, compB);

      expect(result.same).toBe(false);
      expect(result.added).toHaveLength(0);
      expect(result.removed).toContain('removed');
    });

    it('should detect changed prompts', () => {
      const compA = {
        template_id: 'template-1',
        system_prompts: [
          {
            id: '1',
            slug: 'modified',
            layer: 'role' as SystemPromptLayer,
            content: 'Original',
            priority: 0,
          },
        ],
        composition_hash: 'hash-a',
      };
      const compB = {
        template_id: 'template-1',
        system_prompts: [
          {
            id: '1',
            slug: 'modified',
            layer: 'role' as SystemPromptLayer,
            content: 'Updated',
            priority: 0,
          },
        ],
        composition_hash: 'hash-b',
      };

      const result = compareCompositions(compA, compB);

      expect(result.same).toBe(false);
      expect(result.changed).toContain('modified');
    });

    it('should detect multiple changes', () => {
      const compA = {
        template_id: 'template-1',
        system_prompts: [
          {
            id: '1',
            slug: 'kept',
            layer: 'role' as SystemPromptLayer,
            content: 'Kept',
            priority: 0,
          },
          {
            id: '2',
            slug: 'removed',
            layer: 'context' as SystemPromptLayer,
            content: 'Removed',
            priority: 0,
          },
          {
            id: '3',
            slug: 'changed',
            layer: 'format' as SystemPromptLayer,
            content: 'Old',
            priority: 0,
          },
        ],
        composition_hash: 'hash-a',
      };
      const compB = {
        template_id: 'template-1',
        system_prompts: [
          {
            id: '1',
            slug: 'kept',
            layer: 'role' as SystemPromptLayer,
            content: 'Kept',
            priority: 0,
          },
          {
            id: '3',
            slug: 'changed',
            layer: 'format' as SystemPromptLayer,
            content: 'New',
            priority: 0,
          },
          {
            id: '4',
            slug: 'added',
            layer: 'examples' as SystemPromptLayer,
            content: 'Added',
            priority: 0,
          },
        ],
        composition_hash: 'hash-b',
      };

      const result = compareCompositions(compA, compB);

      expect(result.same).toBe(false);
      expect(result.added).toContain('added');
      expect(result.removed).toContain('removed');
      expect(result.changed).toContain('changed');
    });
  });
});
