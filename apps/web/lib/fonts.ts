import {
  Cormorant,
  DM_Sans,
  Inter,
  JetBrains_Mono,
  Lora,
  Merriweather,
  Montserrat,
  Nunito,
  Open_Sans,
  Playfair_Display,
  Poppins,
  Quicksand,
  Raleway,
  Roboto,
  Source_Sans_3,
} from 'next/font/google';

import { getBrandingConfig } from '@kit/branding';
import { cn } from '@kit/ui/utils';

const config = getBrandingConfig();

const fontMap = {
  Inter: Inter,
  Poppins: Poppins,
  Montserrat: Montserrat,
  Quicksand: Quicksand,
  Nunito: Nunito,
  'Playfair Display': Playfair_Display,
  Lora: Lora,
  'DM Sans': DM_Sans,
  'Open Sans': Open_Sans,
  Raleway: Raleway,
  Roboto: Roboto,
  'Source Sans Pro': Source_Sans_3,
  Merriweather: Merriweather,
  Cormorant: Cormorant,
  'JetBrains Mono': JetBrains_Mono,
};

type FontName = keyof typeof fontMap;

type FontWeight =
  | '100'
  | '200'
  | '300'
  | '400'
  | '500'
  | '600'
  | '700'
  | '800'
  | '900';

function parseWeights(weights: number[]): FontWeight[] {
  return weights.map((w) => String(w)) as FontWeight[];
}

function loadFont(
  fontName: string,
  weights: number[],
  variable: `--${string}`,
) {
  const FontConstructor = fontMap[fontName as FontName];

  if (!FontConstructor) {
    return Inter({
      subsets: ['latin'],
      variable,
      fallback: ['system-ui', 'Helvetica Neue', 'Helvetica', 'Arial'],
      preload: true,
      weight: ['400', '500', '600', '700'],
    });
  }

  const weightArray = parseWeights(weights);

  return FontConstructor({
    subsets: ['latin'],
    variable,
    fallback: ['system-ui', 'Helvetica Neue', 'Helvetica', 'Arial'],
    preload: true,
    weight:
      weightArray.length > 0
        ? (weightArray as any)
        : ['400', '500', '600', '700'], // eslint-disable-line @typescript-eslint/no-explicit-any
  });
}

/**
 * @heading
 * @description Dynamic heading font based on branding configuration
 */
const heading = loadFont(
  config.typography.heading.font,
  config.typography.heading.weights,
  '--font-heading',
);

/**
 * @sans
 * @description Dynamic body font based on branding configuration
 */
const sans = loadFont(
  config.typography.body.font,
  config.typography.body.weights,
  '--font-sans',
);

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
