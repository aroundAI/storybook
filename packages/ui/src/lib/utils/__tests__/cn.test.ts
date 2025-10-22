import { describe, expect, it } from 'vitest';

import { cn } from '../cn';

describe('cn', () => {
  describe('basic class merging', () => {
    it('should merge multiple class names', () => {
      const result = cn('text-red-500', 'bg-blue-500');

      expect(result).toBe('text-red-500 bg-blue-500');
    });

    it('should handle single class name', () => {
      const result = cn('text-red-500');

      expect(result).toBe('text-red-500');
    });

    it('should handle empty string', () => {
      const result = cn('');

      expect(result).toBe('');
    });

    it('should handle no arguments', () => {
      const result = cn();

      expect(result).toBe('');
    });

    it('should filter out falsy values', () => {
      const result = cn('text-red-500', false, null, undefined, 'bg-blue-500');

      expect(result).toBe('text-red-500 bg-blue-500');
    });
  });

  describe('conditional class application', () => {
    it('should apply classes conditionally', () => {
      const isActive = true;
      const result = cn('base-class', isActive && 'active-class');

      expect(result).toBe('base-class active-class');
    });

    it('should not apply false conditional classes', () => {
      const isActive = false;
      const result = cn('base-class', isActive && 'active-class');

      expect(result).toBe('base-class');
    });

    it('should handle multiple conditions', () => {
      const result = cn(
        'base',
        true && 'true-class',
        false && 'false-class',
        1 > 0 && 'condition-class',
      );

      expect(result).toBe('base true-class condition-class');
    });
  });

  describe('tailwind merge conflicts', () => {
    it('should merge conflicting padding classes', () => {
      const result = cn('p-4', 'p-8');

      // tailwind-merge should keep only the last padding class
      expect(result).toBe('p-8');
    });

    it('should merge conflicting text size classes', () => {
      const result = cn('text-sm', 'text-lg');

      expect(result).toBe('text-lg');
    });

    it('should merge conflicting background colors', () => {
      const result = cn('bg-red-500', 'bg-blue-500');

      expect(result).toBe('bg-blue-500');
    });

    it('should merge conflicting margin classes', () => {
      const result = cn('m-2', 'm-4');

      expect(result).toBe('m-4');
    });

    it('should keep non-conflicting classes', () => {
      const result = cn('p-4 text-sm', 'm-4 text-lg');

      expect(result).toContain('p-4');
      expect(result).toContain('m-4');
      expect(result).toContain('text-lg');
      expect(result).not.toContain('text-sm');
    });

    it('should handle directional spacing conflicts', () => {
      const result = cn('px-4', 'px-8');

      expect(result).toBe('px-8');
    });

    it('should merge width and height separately', () => {
      const result = cn('w-4 h-4', 'w-8');

      expect(result).toContain('w-8');
      expect(result).toContain('h-4');
    });
  });

  describe('object syntax', () => {
    it('should handle object with boolean values', () => {
      const result = cn({
        'text-red-500': true,
        'bg-blue-500': false,
        'p-4': true,
      });

      expect(result).toContain('text-red-500');
      expect(result).toContain('p-4');
      expect(result).not.toContain('bg-blue-500');
    });

    it('should combine strings and objects', () => {
      const result = cn('base-class', {
        'active': true,
        'disabled': false,
      });

      expect(result).toContain('base-class');
      expect(result).toContain('active');
      expect(result).not.toContain('disabled');
    });

    it('should handle multiple objects', () => {
      const result = cn(
        { 'class-1': true },
        { 'class-2': false },
        { 'class-3': true },
      );

      expect(result).toContain('class-1');
      expect(result).toContain('class-3');
      expect(result).not.toContain('class-2');
    });
  });

  describe('array syntax', () => {
    it('should handle array of class names', () => {
      const result = cn(['text-red-500', 'bg-blue-500']);

      expect(result).toBe('text-red-500 bg-blue-500');
    });

    it('should handle nested arrays', () => {
      const result = cn(['text-red-500', ['bg-blue-500', 'p-4']]);

      expect(result).toContain('text-red-500');
      expect(result).toContain('bg-blue-500');
      expect(result).toContain('p-4');
    });

    it('should filter falsy values in arrays', () => {
      const result = cn(['text-red-500', false, null, 'bg-blue-500']);

      expect(result).toBe('text-red-500 bg-blue-500');
    });
  });

  describe('complex scenarios', () => {
    it('should handle mix of all input types', () => {
      const result = cn(
        'base',
        ['array-class'],
        { 'object-class': true },
        true && 'conditional-class',
        'final-class',
      );

      expect(result).toContain('base');
      expect(result).toContain('array-class');
      expect(result).toContain('object-class');
      expect(result).toContain('conditional-class');
      expect(result).toContain('final-class');
    });

    it('should merge conflicts in complex inputs', () => {
      const result = cn(
        'p-2 text-sm',
        { 'p-4': true },
        ['text-lg'],
        'p-8',
      );

      expect(result).toContain('p-8');
      expect(result).toContain('text-lg');
      expect(result).not.toContain('p-2');
      expect(result).not.toContain('p-4');
      expect(result).not.toContain('text-sm');
    });

    it('should handle dynamic component props pattern', () => {
      const variant = 'primary';
      const size = 'lg';

      const result = cn(
        'base-button',
        variant === 'primary' && 'bg-blue-500 text-white',
        size === 'lg' && 'px-6 py-3 text-lg',
      );

      expect(result).toContain('base-button');
      expect(result).toContain('bg-blue-500');
      expect(result).toContain('text-white');
      expect(result).toContain('px-6');
      expect(result).toContain('py-3');
      expect(result).toContain('text-lg');
    });

    it('should handle responsive classes', () => {
      const result = cn('text-sm md:text-base lg:text-lg');

      expect(result).toBe('text-sm md:text-base lg:text-lg');
    });

    it('should merge hover states correctly', () => {
      const result = cn('hover:bg-blue-500', 'hover:bg-red-500');

      expect(result).toBe('hover:bg-red-500');
    });

    it('should handle dark mode classes', () => {
      const result = cn('bg-white', 'dark:bg-black');

      expect(result).toContain('bg-white');
      expect(result).toContain('dark:bg-black');
    });

    it('should merge arbitrary values', () => {
      const result = cn('w-[100px]', 'w-[200px]');

      expect(result).toBe('w-[200px]');
    });

    it('should handle important modifier', () => {
      const result = cn('!p-4', 'p-8');

      // Important should take precedence
      expect(result).toContain('!p-4');
    });

    it('should handle className prop pattern', () => {
      const className = 'custom-class';
      const result = cn('default-class', className);

      expect(result).toBe('default-class custom-class');
    });

    it('should handle undefined className prop', () => {
      const className = undefined;
      const result = cn('default-class', className);

      expect(result).toBe('default-class');
    });
  });

  describe('edge cases', () => {
    it('should handle very long class strings', () => {
      const longClass = 'class-' + 'a'.repeat(1000);
      const result = cn(longClass);

      expect(result).toBe(longClass);
    });

    it('should handle special characters in class names', () => {
      const result = cn('class-with-dash', 'class_with_underscore', 'class:with:colon');

      expect(result).toContain('class-with-dash');
      expect(result).toContain('class_with_underscore');
      expect(result).toContain('class:with:colon');
    });

    it('should handle numbers in class names', () => {
      const result = cn('p-4', 'text-2xl', 'z-50');

      expect(result).toContain('p-4');
      expect(result).toContain('text-2xl');
      expect(result).toContain('z-50');
    });

    it('should handle empty objects', () => {
      const result = cn({});

      expect(result).toBe('');
    });

    it('should handle empty arrays', () => {
      const result = cn([]);

      expect(result).toBe('');
    });

    it('should trim whitespace', () => {
      const result = cn('  text-red-500  ', '  bg-blue-500  ');

      expect(result).toBe('text-red-500 bg-blue-500');
    });
  });
});
