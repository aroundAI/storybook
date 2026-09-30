import { describe, expect, it } from 'vitest';

import {
  isAssetsTabActive,
  isPathActive,
} from '../app/home/[account]/studio/[projectSlug]/_lib/sidebar-active';

/**
 * FILM-901. The studio sidebar's Characters and Locations links differ only in
 * `?tab=`, and the pathname has no query string, so they never lit. The tab
 * now decides.
 */

const BASE = '/home/acme/studio/proj-1';
const ASSETS = `${BASE}/assets`;

describe('isAssetsTabActive', () => {
  it('lights Characters on the assets page with the character tab', () => {
    expect(isAssetsTabActive(ASSETS, ASSETS, 'character', 'character')).toBe(
      true,
    );
    expect(isAssetsTabActive(ASSETS, ASSETS, 'character', 'location')).toBe(
      false,
    );
  });

  it('lights Locations on the assets page with the location tab', () => {
    expect(isAssetsTabActive(ASSETS, ASSETS, 'location', 'location')).toBe(
      true,
    );
    expect(isAssetsTabActive(ASSETS, ASSETS, 'location', 'character')).toBe(
      false,
    );
  });

  it('treats no tab as Characters, as the assets page does', () => {
    expect(isAssetsTabActive(ASSETS, ASSETS, null, 'character')).toBe(true);
    expect(isAssetsTabActive(ASSETS, ASSETS, null, 'location')).toBe(false);
  });

  it('treats a tab it does not know as Characters too', () => {
    expect(isAssetsTabActive(ASSETS, ASSETS, 'voice', 'character')).toBe(true);
  });

  it('lights neither anywhere else', () => {
    for (const path of [BASE, `${BASE}/episodes`, `${BASE}/canon`]) {
      expect(isAssetsTabActive(path, ASSETS, 'character', 'character')).toBe(
        false,
      );
      expect(isAssetsTabActive(path, ASSETS, 'location', 'location')).toBe(
        false,
      );
    }
  });
});

describe('isPathActive', () => {
  it('matches the overview only exactly', () => {
    expect(isPathActive(BASE, BASE, true)).toBe(true);
    expect(isPathActive(`${BASE}/episodes`, BASE, true)).toBe(false);
  });

  it('matches a section and everything beneath it', () => {
    expect(isPathActive(`${BASE}/episodes`, `${BASE}/episodes`)).toBe(true);
    expect(
      isPathActive(`${BASE}/episodes/ep-1/story`, `${BASE}/episodes`),
    ).toBe(true);
  });

  it('does not match a sibling that only shares a prefix', () => {
    expect(isPathActive(`${BASE}/episodes-archive`, `${BASE}/episodes`)).toBe(
      false,
    );
    expect(isPathActive('/home/acme/studio/proj-10', BASE)).toBe(false);
  });
});
