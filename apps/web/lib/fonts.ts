import { Inter as SansFont } from 'next/font/google';

import { cn } from '@kit/ui/utils';

/**
 * @sans
 * @description Default sans font
 * By default, it uses the Inter font from Google Fonts.
 */
const sans = SansFont({
  subsets: ['latin'],
  variable: '--font-sans',
  fallback: ['system-ui', 'Helvetica Neue', 'Helvetica', 'Arial'],
  preload: true,
  weight: ['300', '400', '500', '600', '700'],
});

/**
 * @heading
 * @description Default heading font
 */
const heading = sans;

export { sans, heading };

/**
 * @name getFontsClassName
 * @description Get the class name for the root layout.
 * @param theme
 */
export function getFontsClassName(theme?: string) {
  const font = [sans.variable, heading.variable].reduce<string[]>(
    (acc, curr) => {
      if (acc.includes(curr)) return acc;

      return [...acc, curr];
    },
    [],
  );

  const themeClasses =
    theme === 'dark'
      ? { dark: true }
      : theme === 'light'
        ? { light: true }
        : {};

  return cn('bg-background min-h-screen antialiased', ...font, themeClasses);
}
