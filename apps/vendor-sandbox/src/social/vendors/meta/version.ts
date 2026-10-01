import type { SocialRoute } from '../../server';

/**
 * Graph's `facebook-api-version` response header (FILM-1728): the version
 * Meta actually served, which the app's `metaFetch` compares with its pin.
 *
 * Meta's rule, from its versioning guide: *"once a version is no longer
 * usable, any calls made to it will be defaulted to the next oldest, usable
 * version."* A version not yet released is answered the same way — measured
 * 2026-10-01, a request for v27.0 came back as v21.0, and on 2026-09-21 one
 * for v18.0 came back as v20.0. Both fall out of the table below.
 *
 * Dates from https://developers.facebook.com/docs/graph-api/changelog/,
 * read 2026-10-01. Majors, not version strings, so this file holds no Graph
 * version literal (vendor-api-versions.test.ts). `expires: null` is Meta's
 * "TBD".
 */
const GRAPH_VERSIONS: ReadonlyArray<{
  major: number;
  released: string;
  expires: string | null;
}> = [
  { major: 18, released: '2023-09-12', expires: '2026-01-26' },
  { major: 19, released: '2024-01-23', expires: '2026-05-21' },
  { major: 20, released: '2024-05-21', expires: '2026-09-24' },
  { major: 21, released: '2024-10-02', expires: '2027-01-21' },
  { major: 22, released: '2025-01-21', expires: '2027-05-20' },
  { major: 23, released: '2025-05-29', expires: '2027-10-08' },
  { major: 24, released: '2025-10-08', expires: '2028-02-18' },
  { major: 25, released: '2026-02-18', expires: '2028-07-29' },
  { major: 26, released: '2026-07-29', expires: null },
];

/** The version Meta would serve a request for `requested` at `nowMs`. */
export function servedGraphMajor(requested: number, nowMs: number) {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const usable = GRAPH_VERSIONS.filter(
    (v) => v.released <= today && (v.expires === null || v.expires > today),
  );

  if (usable.some((v) => v.major === requested)) return requested;
  return usable[0]?.major ?? requested;
}

/**
 * Sets the header on every versioned Graph path, then lets the real route
 * answer. The Reels upload host (`/video-upload/…`) is not Graph and gets
 * none, as at Meta.
 */
export const metaVersionRoute: SocialRoute = ({ url, res, social }) => {
  const requested = /^\/v(\d+)\.0\//.exec(url.pathname)?.[1];

  if (requested) {
    const served = servedGraphMajor(Number(requested), social.now());
    res.setHeader('facebook-api-version', `v${served}.0`);
  }

  return false;
};
