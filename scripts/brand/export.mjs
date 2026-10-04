#!/usr/bin/env node
// Renders StoryBook's vector brand kit (packages/branding/assets/brand) into the
// raster files the web app and StorybookStudio ship.
//
//   pnpm --filter @kit/branding brand:export
//
// Web app files are written in place (apps/web/public/images/...); the
// StorybookStudio set goes to packages/branding/dist/studio/ (gitignored) and
// is copied into the fork's build/ and public/ by hand.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = createRequire(join(root, 'packages/branding/package.json'))(
  'sharp',
);

const SRC = join(root, 'packages/branding/assets/brand');
const WEB = join(root, 'apps/web/public/images');
const STUDIO = join(root, 'packages/branding/dist/studio');

const svg = (name) => readFileSync(join(SRC, name));

/** Render an SVG to PNG at a given width (height follows the viewBox). */
async function render(name, width, height) {
  return sharp(svg(name), { density: 600 })
    .resize(width, height ?? null, { fit: 'contain', kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// macOS app icon grid: 1024 canvas, 824 body at 100, corner radius 185.4,
// with the system's soft drop shadow. The squircle is applied here, never in
// the SVG, so the same source serves Windows, Linux and the web.
async function macIcon(name, size = 1024) {
  const k = size / 1024;
  const body = Math.round(824 * k);
  const inset = Math.round(100 * k);
  const radius = 185.4 * k;
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${body}" height="${body}"><rect width="${body}" height="${body}" rx="${radius}" ry="${radius}"/></svg>`,
  );
  const art = await sharp(await render(name, body, body))
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  const shadow = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${14 * k}"/></filter></defs><rect x="${inset}" y="${inset + 12 * k}" width="${body}" height="${body}" rx="${radius}" fill="#000" fill-opacity="0.32" filter="url(#s)"/></svg>`,
  );
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: shadow, left: 0, top: 0 },
      { input: art, left: inset, top: inset },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** A PNG-in-ICO container (Vista+), one entry per size. */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const out = [];
function write(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  out.push(path.replace(`${root}/`, ''));
}

// ---- Web app ---------------------------------------------------------------
// Header logo: the UI lockup (mark + wordmark), white for dark mode.
write(join(WEB, 'logo-dark.png'), await render('lockup-ui.svg', 1200));
write(
  join(WEB, 'logo-light.png'),
  await render('lockup-ui-on-light.svg', 1200),
);
write(join(WEB, 'icon.png'), await render('app-icon-dark.svg', 625, 625));
// OAuth consent and the "Edit in StorybookStudio" sheet show the desktop app's icon.
write(
  join(WEB, 'storybookstudio-icon.png'),
  await macIcon('app-icon-dark.svg', 128),
);

const FAV = join(WEB, 'favicon');
const fav16 = await render('favicon.svg', 16, 16);
const fav32 = await render('favicon.svg', 32, 32);
const fav48 = await render('favicon.svg', 48, 48);
write(join(FAV, 'favicon-16x16.png'), fav16);
write(join(FAV, 'favicon-32x32.png'), fav32);
write(
  join(FAV, 'favicon.ico'),
  ico([
    { size: 16, data: fav16 },
    { size: 32, data: fav32 },
    { size: 48, data: fav48 },
  ]),
);
// iOS and Android mask these themselves: full-bleed squares.
write(
  join(FAV, 'apple-touch-icon.png'),
  await render('app-icon-dark.svg', 180, 180),
);
write(
  join(FAV, 'android-chrome-192x192.png'),
  await render('app-icon-dark.svg', 192, 192),
);
write(
  join(FAV, 'android-chrome-512x512.png'),
  await render('app-icon-dark.svg', 512, 512),
);
write(
  join(FAV, 'mstile-150x150.png'),
  await render('app-icon-dark.svg', 150, 150),
);
write(join(FAV, 'safari-pinned-tab.svg'), svg('monogram-mono-black.svg'));

// ---- StorybookStudio -------------------------------------------------------
write(join(STUDIO, 'icon-1024.png'), await macIcon('app-icon-dark.svg'));
write(join(STUDIO, 'icon-mono-1024.png'), await macIcon('app-icon-mono.svg'));
// The splash window is sized to a 1632×656 image (electron/main.js SPLASH_ASPECT).
write(
  join(STUDIO, 'splash-2x.png'),
  await render('splash-studio.svg', 3264, 1312),
);
write(
  join(STUDIO, 'splash.jpg'),
  await sharp(svg('splash-studio.svg'), { density: 300 })
    .resize(1632, 656)
    .jpeg({ quality: 88 })
    .toBuffer(),
);
write(
  join(STUDIO, 'welcome-hero.webp'),
  await sharp(svg('hero-studio.svg'), { density: 300 })
    .resize(2560, 1440)
    .webp({ quality: 88 })
    .toBuffer(),
);
// Behind the Studio's StoryBook Welcome screen (no text: the page sets its own).
write(
  join(STUDIO, 'welcome-bg.webp'),
  await sharp(svg('background-wave.svg'), { density: 300 })
    .resize(2560, 1440)
    .webp({ quality: 86 })
    .toBuffer(),
);
write(
  join(STUDIO, 'loader-256.png'),
  await render('social-avatar.svg', 256, 256),
);
write(
  join(STUDIO, 'social-512.png'),
  await render('social-avatar.svg', 512, 512),
);
write(join(STUDIO, 'favicon.svg'), svg('favicon.svg'));

console.log(out.join('\n'));
