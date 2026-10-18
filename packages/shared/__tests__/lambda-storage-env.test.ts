import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-202's class. A Lambda that decides whether a URL is one of the app's
 * own files (ownedEpisodeVideo, ownedThumbnail, publicUrlPrefix…) reads
 * STORAGE_PROVIDER and R2_PUBLIC_URL. Without them getStorageProvider()
 * falls back to Supabase storage, every R2 URL looks foreign, and the
 * publish is refused: the scheduled-publish Lambda failed every scheduled
 * video that way. Every such Lambda must be given both in sst.config.ts.
 */

const REPO = resolve(__dirname, '../../..');
const LAMBDAS = join(REPO, 'apps', 'web', 'lambda');
const URL_CHECK =
  /\b(ownedEpisodeVideo|ownedThumbnail|publicUrlPrefix|episodeVideoTarget|keyUnderPrefix)\b/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === 'node_modules' || entry === '__tests__') return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(entry) ? [path] : [];
  });
}

/** The environment block of the function whose handler is in `lambda` */
export function environmentOf(config: string, lambda: string): string | null {
  const at = config.indexOf(`apps/web/lambda/${lambda}/index.handler`);
  if (at < 0) return null;
  const start = config.indexOf('environment: {', at);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start + 'environment: '.length; i < config.length; i++) {
    if (config[i] === '{') depth++;
    if (config[i] === '}') depth--;
    if (depth === 0) return config.slice(start, i + 1);
  }
  return null;
}

describe('a Lambda that checks storage URLs knows the storage (KB-202)', () => {
  const config = readFileSync(join(REPO, 'sst.config.ts'), 'utf8');
  const checking = readdirSync(LAMBDAS).filter((name) => {
    const dir = join(LAMBDAS, name);
    return (
      statSync(dir).isDirectory() &&
      sources(dir).some((file) => URL_CHECK.test(readFileSync(file, 'utf8')))
    );
  });

  it('finds the Lambdas that check URLs', () => {
    expect(checking).toEqual(
      expect.arrayContaining(['publish-worker', 'scheduled-publish']),
    );
  });

  it.each(checking)(
    '%s is given STORAGE_PROVIDER and R2_PUBLIC_URL',
    (name) => {
      const env = environmentOf(config, name);
      expect(env, `no environment block for ${name}`).not.toBeNull();
      expect(env).toMatch(/STORAGE_PROVIDER:/);
      expect(env).toMatch(/R2_PUBLIC_URL:/);
    },
  );
});
