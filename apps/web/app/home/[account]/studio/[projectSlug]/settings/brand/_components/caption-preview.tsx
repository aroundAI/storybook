'use client';

import type { CSSProperties } from 'react';

import {
  BRAND_DEFAULTS,
  BrandColorSchema,
  type BrandInput,
} from '@kit/desktop-integration';

const SAMPLE = 'Every cut the Studio makes follows the brand you set here.';
const EMPHASIZED_WORD = 'brand';

/** Pixels at 1080p, as the Studio reads captionStyle.fontSize. */
const REFERENCE_HEIGHT = 1080;

function colorOr(value: string | undefined, fallback: string) {
  return value && BrandColorSchema.safeParse(value).success ? value : fallback;
}

function numberIn(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
) {
  return typeof value === 'number' && value >= min && value <= max
    ? value
    : fallback;
}

/** Greedy word wrap at `maxChars`, as the Studio's caption styler breaks lines. */
export function wrapCaption(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = '';

  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;

    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }

  if (line) lines.push(line);

  return lines;
}

const JUSTIFY = {
  top: 'flex-start',
  center: 'center',
  bottom: 'flex-end',
} as const;

const LOGO_CORNER = {
  'top-left': { top: '4%', left: '3%' },
  'top-right': { top: '4%', right: '3%' },
  'bottom-left': { bottom: '4%', left: '3%' },
  'bottom-right': { bottom: '4%', right: '3%' },
} as const;

/**
 * A 16:9 frame showing a caption styled by the form's current values. Values
 * that do not validate yet (a half-typed colour) fall back to the default,
 * so the preview never renders something the Studio would refuse.
 */
export function CaptionPreview({
  brand,
  logoUrl,
}: {
  brand: BrandInput | undefined;
  logoUrl: string | null;
}) {
  const defaults = BRAND_DEFAULTS;
  const colors = brand?.colors;
  const style = brand?.captionStyle;

  const captionText = colorOr(colors?.captionText, defaults.colors.captionText);
  const captionBackground = colorOr(
    colors?.captionBackground,
    defaults.colors.captionBackground,
  );
  const primary = colorOr(colors?.primary, defaults.colors.primary);
  const frame = colorOr(colors?.background, defaults.colors.background);
  const fontSize = numberIn(
    style?.fontSize,
    12,
    200,
    defaults.captionStyle.fontSize,
  );
  const maxChars = numberIn(
    style?.maxCharsPerLine,
    10,
    80,
    defaults.captionStyle.maxCharsPerLine,
  );
  const position = style?.position ?? defaults.captionStyle.position;
  const background = style?.background ?? defaults.captionStyle.background;
  const emphasis = style?.emphasis ?? defaults.captionStyle.emphasis;
  const font = brand?.fonts?.body?.trim() || defaults.fonts.body;
  const logo = brand?.logo;
  const logoPosition = logo?.position ?? defaults.logo.position;
  const logoOpacity = numberIn(logo?.opacity, 0, 1, defaults.logo.opacity);

  const textStyle: CSSProperties = {
    color: captionText,
    fontFamily: `"${font}", sans-serif`,
    fontSize: `${(fontSize / REFERENCE_HEIGHT) * 100}cqh`,
    lineHeight: 1.25,
    ...(background === 'box'
      ? {
          backgroundColor: captionBackground,
          padding: '0.15em 0.4em',
          boxDecorationBreak: 'clone',
          WebkitBoxDecorationBreak: 'clone',
        }
      : {}),
    ...(background === 'outline'
      ? {
          WebkitTextStroke: `0.06em ${captionBackground}`,
          paintOrder: 'stroke fill',
        }
      : {}),
  };

  const emphasisStyle: CSSProperties =
    emphasis === 'color'
      ? { color: primary }
      : emphasis === 'scale'
        ? {
            display: 'inline-block',
            transform: 'scale(1.2)',
            margin: '0 0.1em',
          }
        : {};

  return (
    <div
      data-test="brand-caption-preview"
      className="relative aspect-video w-full overflow-hidden rounded-md border"
      style={{
        backgroundColor: frame,
        containerType: 'size',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: JUSTIFY[position],
        alignItems: 'center',
        padding: '6cqh 4cqw',
      }}
    >
      {logo?.assetId ? (
        <div
          data-test="brand-caption-preview-logo"
          className="absolute flex h-[12cqh] w-[12cqh] items-center justify-center rounded-sm border border-white/40 text-[3cqh] text-white"
          style={{ ...LOGO_CORNER[logoPosition], opacity: logoOpacity }}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt=""
              className="h-full w-full object-contain"
            />
          ) : (
            'Logo'
          )}
        </div>
      ) : null}

      <p data-test="brand-caption-preview-text" className="text-center">
        {wrapCaption(SAMPLE, maxChars).map((line, index) => (
          <span key={index} style={textStyle}>
            {line.split(' ').map((word, wordIndex) => (
              <span key={wordIndex}>
                {wordIndex > 0 ? ' ' : null}
                {word.replace(/[^a-z]/gi, '').toLowerCase() ===
                EMPHASIZED_WORD ? (
                  <span
                    data-test="brand-caption-preview-emphasis"
                    style={emphasisStyle}
                  >
                    {word}
                  </span>
                ) : (
                  word
                )}
              </span>
            ))}
            <br />
          </span>
        ))}
      </p>
    </div>
  );
}
