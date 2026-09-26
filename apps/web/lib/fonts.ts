import localFont from 'next/font/local';

import { cn } from '@kit/ui/utils';

/**
 * DM Sans, bundled rather than fetched from Google at build time: a build
 * once failed when Google Fonts returned an unexpected response.
 *
 * The files are the ones `next/font/google` served for `subsets: ['latin']`
 * (byte-identical, 2026-09-25), and the faces reproduce what it generated:
 * two variable files — latin (preloaded) and latin-ext (fetched only for a
 * character in its range) — each declared for 400, 500, 600 and 700, under
 * the family name `DM Sans`. `unicode-range` has to differ per file, and
 * `declarations` apply to every `src` of one call, hence two calls.
 *
 * `adjustFontFallback` is off because `DM Sans Fallback` is declared in
 * `styles/globals.css` with Google's own metrics, as before.
 */

/**
 * latin-ext, declared before latin as Google's stylesheet does. The two
 * `unicode-range`s overlap (U+0304, U+0308, U+0329: combining marks), and for
 * an overlapping code point the browser uses the face declared last — so this
 * order decides which file draws the macron on `Ā`. Its family is `DM Sans`
 * too, so nothing references it by name; Next requires the const.
 */
export const sansLatinExt = localFont({
  src: [
    { path: '../fonts/dm-sans/dm-sans-latin-ext.woff2', weight: '400' },
    { path: '../fonts/dm-sans/dm-sans-latin-ext.woff2', weight: '500' },
    { path: '../fonts/dm-sans/dm-sans-latin-ext.woff2', weight: '600' },
    { path: '../fonts/dm-sans/dm-sans-latin-ext.woff2', weight: '700' },
  ],
  style: 'normal',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    { prop: 'font-family', value: "'DM Sans'" },
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
});

const sans = localFont({
  src: [
    { path: '../fonts/dm-sans/dm-sans-latin.woff2', weight: '400' },
    { path: '../fonts/dm-sans/dm-sans-latin.woff2', weight: '500' },
    { path: '../fonts/dm-sans/dm-sans-latin.woff2', weight: '600' },
    { path: '../fonts/dm-sans/dm-sans-latin.woff2', weight: '700' },
  ],
  style: 'normal',
  display: 'swap',
  preload: true,
  variable: '--font-sans',
  adjustFontFallback: false,
  fallback: [
    'DM Sans Fallback',
    'system-ui',
    'Helvetica Neue',
    'Helvetica',
    'Arial',
  ],
  declarations: [
    { prop: 'font-family', value: "'DM Sans'" },
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

/**
 * @heading
 * @description Default heading font - same as sans for consistency
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

  return cn('min-h-screen bg-background antialiased', ...font, themeClasses);
}
