/**
 * Colour distance for the chart ramp (FILM-1708), the dataviz method's
 * arithmetic: OKLab ΔE ×100, with protanopia and deuteranopia simulated by
 * Machado, Oliveira & Fernandes (2009) at severity 1.0 in linear sRGB.
 *
 * Shared by the unit test (which reads the stylesheet) and the browser test
 * (which reads the rendered colours), so the two measure the same thing.
 */

export type LinearRgb = [number, number, number];

const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
} as const;

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** `oklch(L C H)` with L as a fraction or a percentage, to linear sRGB. */
export function oklchToLinear(L: number, C: number, H: number): LinearRgb {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Parses a computed or declared colour: `oklch(…)` or `rgb(…)`. */
export function parseColour(value: string): LinearRgb {
  const oklch = value.match(
    /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.]+%?\s*)?\)/,
  );

  if (oklch) {
    const L = Number(oklch[1]) / (oklch[2] === '%' ? 100 : 1);

    return oklchToLinear(L, Number(oklch[3]), Number(oklch[4]));
  }

  const rgb = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);

  if (rgb) {
    const toLinear = (c: number) =>
      c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

    return [rgb[1], rgb[2], rgb[3]].map((c) =>
      toLinear(Number(c) / 255),
    ) as LinearRgb;
  }

  throw new Error(`Not a colour this helper reads: ${value}`);
}

function oklab([r, g, b]: LinearRgb): LinearRgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function simulate(rgb: LinearRgb, kind: keyof typeof MACHADO): LinearRgb {
  return MACHADO[kind].map((row) =>
    clamp(row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]),
  ) as LinearRgb;
}

function distance(a: LinearRgb, b: LinearRgb) {
  const [x, y] = [oklab(a), oklab(b)];

  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** ΔE under normal vision. The method's floor is 15. */
export function normalDeltaE(a: LinearRgb, b: LinearRgb) {
  return distance(a, b);
}

/** The worse of protan and deutan ΔE. The method's target is 8, floor 6. */
export function cvdDeltaE(a: LinearRgb, b: LinearRgb) {
  return Math.min(
    distance(simulate(a, 'protan'), simulate(b, 'protan')),
    distance(simulate(a, 'deutan'), simulate(b, 'deutan')),
  );
}

/** WCAG contrast ratio between two colours. */
export function contrast(a: LinearRgb, b: LinearRgb) {
  const lum = ([r, g, b2]: LinearRgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];

  return (hi + 0.05) / (lo + 0.05);
}
