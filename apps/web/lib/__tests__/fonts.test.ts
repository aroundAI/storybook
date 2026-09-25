import { describe, expect, it, vi } from 'vitest';

import { getFontsClassName } from '../fonts';

vi.mock('next/font/local', () => ({
  default: vi.fn(() => ({
    variable: '--font-sans',
    className: 'font-sans',
  })),
}));

describe('fonts', () => {
  describe('getFontsClassName', () => {
    describe('theme classes', () => {
      it('should include dark class when theme is dark', () => {
        const className = getFontsClassName('dark');

        expect(className).toContain('dark');
      });

      it('should include light class when theme is light', () => {
        const className = getFontsClassName('light');

        expect(className).toContain('light');
      });

      it('should not include theme class when theme is system', () => {
        const className = getFontsClassName('system');

        expect(className).not.toContain('dark');
        expect(className).not.toContain('light');
      });

      it('should not include theme class when theme is undefined', () => {
        const className = getFontsClassName();

        expect(className).not.toContain('dark');
        expect(className).not.toContain('light');
      });

      it('should not include theme class when theme is empty string', () => {
        const className = getFontsClassName('');

        expect(className).not.toContain('dark');
        expect(className).not.toContain('light');
      });

      it('should not include theme class for invalid theme values', () => {
        const className = getFontsClassName('invalid-theme');

        expect(className).not.toContain('dark');
        expect(className).not.toContain('light');
      });
    });

    describe('base classes', () => {
      it('should include bg-background class', () => {
        const className = getFontsClassName();

        expect(className).toContain('bg-background');
      });

      it('should include min-h-screen class', () => {
        const className = getFontsClassName();

        expect(className).toContain('min-h-screen');
      });

      it('should include antialiased class', () => {
        const className = getFontsClassName();

        expect(className).toContain('antialiased');
      });

      it('should include base classes regardless of theme', () => {
        const darkClassName = getFontsClassName('dark');
        const lightClassName = getFontsClassName('light');
        const noThemeClassName = getFontsClassName();

        expect(darkClassName).toContain('bg-background');
        expect(lightClassName).toContain('bg-background');
        expect(noThemeClassName).toContain('bg-background');
      });
    });

    describe('font variables', () => {
      it('should include font-sans variable', () => {
        const className = getFontsClassName();

        expect(className).toContain('--font-sans');
      });

      it('should deduplicate font variables when heading uses same font', () => {
        // Since heading = sans, the variable should only appear once
        const className = getFontsClassName();
        const matches = className.match(/--font-sans/g);

        // Should appear exactly once (deduplicated by reduce logic)
        expect(matches).toHaveLength(1);
      });

      it('should include font variables with theme class', () => {
        const className = getFontsClassName('dark');

        expect(className).toContain('--font-sans');
        expect(className).toContain('dark');
      });
    });

    describe('return value format', () => {
      it('should return a string', () => {
        const className = getFontsClassName();

        expect(typeof className).toBe('string');
      });

      it('should return non-empty string', () => {
        const className = getFontsClassName();

        expect(className.length).toBeGreaterThan(0);
      });

      it('should return different strings for different themes', () => {
        const darkClassName = getFontsClassName('dark');
        const lightClassName = getFontsClassName('light');

        expect(darkClassName).not.toBe(lightClassName);
      });

      it('should return consistent output for same theme', () => {
        const className1 = getFontsClassName('dark');
        const className2 = getFontsClassName('dark');

        expect(className1).toBe(className2);
      });
    });

    describe('edge cases', () => {
      it('should handle null as theme', () => {
        const className = getFontsClassName(null as any);

        expect(typeof className).toBe('string');
        expect(className).toContain('bg-background');
      });

      it('should handle object as theme', () => {
        const className = getFontsClassName({ theme: 'dark' } as any);

        expect(typeof className).toBe('string');
        expect(className).not.toContain('dark');
      });

      it('should handle number as theme', () => {
        const className = getFontsClassName(123 as any);

        expect(typeof className).toBe('string');
        expect(className).not.toContain('dark');
      });

      it('should handle whitespace in theme', () => {
        const className = getFontsClassName('  dark  ');

        // Should not match because of whitespace
        expect(className).not.toContain('dark');
      });

      it('should handle uppercase theme', () => {
        const className = getFontsClassName('DARK');

        // Should not match because it's case-sensitive
        expect(className).not.toContain('dark');
      });
    });

    describe('integration scenarios', () => {
      it('should combine all classes properly for dark theme', () => {
        const className = getFontsClassName('dark');

        expect(className).toContain('bg-background');
        expect(className).toContain('min-h-screen');
        expect(className).toContain('antialiased');
        expect(className).toContain('--font-sans');
        expect(className).toContain('dark');
      });

      it('should combine all classes properly for light theme', () => {
        const className = getFontsClassName('light');

        expect(className).toContain('bg-background');
        expect(className).toContain('min-h-screen');
        expect(className).toContain('antialiased');
        expect(className).toContain('--font-sans');
        expect(className).toContain('light');
      });

      it('should combine classes properly without theme', () => {
        const className = getFontsClassName();

        expect(className).toContain('bg-background');
        expect(className).toContain('min-h-screen');
        expect(className).toContain('antialiased');
        expect(className).toContain('--font-sans');
      });
    });
  });
});
