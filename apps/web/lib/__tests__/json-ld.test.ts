import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { serializeJsonLd } from '../json-ld';

/**
 * Structured data inside `<script type="application/ld+json">` must not be
 * able to end its own script element. See `lib/json-ld.ts`.
 */
const TITLE =
  'Show </script><script>alert(1)</script> <!-- & \u2028 \u2029 done';

describe('serializeJsonLd', () => {
  const text = serializeJsonLd({ name: TITLE });

  it('leaves nothing the HTML parser can act on', () => {
    expect(text).not.toMatch(/[<>&\u2028\u2029]/);
    expect(text.toLowerCase()).not.toContain('</script');
  });

  it('is still the same JSON, so the title survives exactly', () => {
    expect(JSON.parse(text)).toEqual({ name: TITLE });
  });

  it('parses in a real document as one script with the exact data', () => {
    const doc = new DOMParser().parseFromString(
      `<script type="application/ld+json">${text}</script><p>after</p>`,
      'text/html',
    );
    const scripts = doc.querySelectorAll('script');

    expect(scripts).toHaveLength(1);
    expect(JSON.parse(scripts[0]!.textContent ?? '')).toEqual({
      name: TITLE,
    });
  });

  it('the parse check is not vacuous: plain JSON.stringify breaks out', () => {
    const doc = new DOMParser().parseFromString(
      `<script type="application/ld+json">${JSON.stringify({ name: TITLE })}</script>`,
      'text/html',
    );

    expect(doc.querySelectorAll('script').length).toBeGreaterThan(1);
  });
});

describe('every JSON-LD site goes through the helper', () => {
  const ROOT = resolve(__dirname, '../../../..');
  const SKIP = new Set(['node_modules', '.next', '.turbo', 'dist', 'coverage']);

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      if (SKIP.has(name)) return [];

      const path = join(dir, name);

      if (statSync(path).isDirectory()) return sources(path);

      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  }

  const files = ['apps', 'packages'].flatMap((root) =>
    sources(join(ROOT, root)),
  );

  it('scans the repository, so the check below is not vacuous', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it('no dangerouslySetInnerHTML is handed a bare JSON.stringify', () => {
    const offenders = files
      .filter((file) =>
        /dangerouslySetInnerHTML=\{\{\s*__html:\s*JSON\.stringify\(/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => relative(ROOT, file));

    expect(offenders).toEqual([]);
  });
});
