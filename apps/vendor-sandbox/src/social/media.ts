import type { SocialRoute } from './server';

/**
 * Pictures the app may render — channel avatars, video thumbnails — served
 * by the sandbox origin itself, so a page shows an image rather than a
 * broken link, and nothing is ever fetched from a real vendor's CDN.
 *
 * `/sandbox-media/<kind>/<id>.svg?label=<text>`: a flat colour chosen from
 * the id, with the label's initials.
 */

const PALETTE = ['#2f6f8f', '#8f4a2f', '#4a7a3a', '#6a4a8f', '#8f2f5a', '#2f8f7a'];

function initials(label: string) {
  return (
    label
      .split(/\s+/)
      .filter((word) => /^[A-Za-z]/.test(word))
      .slice(0, 2)
      .map((word) => word[0]!.toUpperCase())
      .join('') || '·'
  );
}

export function mediaUrl(origin: string, kind: string, id: string, label: string) {
  return `${origin}/sandbox-media/${kind}/${encodeURIComponent(id)}.svg?label=${encodeURIComponent(label)}`;
}

export const mediaRoute: SocialRoute = ({ url, method, res }) => {
  const match = /^\/sandbox-media\/([a-z-]+)\/([^/]+)\.svg$/.exec(url.pathname);
  if (method !== 'GET' || !match) return false;

  const [, kind, id] = match;
  let hash = 0;
  for (const c of `${kind}${id}`) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const colour = PALETTE[hash % PALETTE.length];
  const text = initials(url.searchParams.get('label') ?? '')
    .replace(/[&<>"']/g, '');
  const wide = kind === 'thumbnail';
  const [w, h] = wide ? [480, 270] : [240, 240];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${colour}"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui,sans-serif" font-size="${wide ? 72 : 96}" fill="#fff">${text}</text></svg>`;
  res.writeHead(200, {
    'content-type': 'image/svg+xml',
    'content-length': Buffer.byteLength(svg),
    'cache-control': 'no-store',
  });
  res.end(svg);
  return true;
};
