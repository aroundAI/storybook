import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-1806. The local stack replaces SQS, DynamoDB and the API Gateway
 * Management API with emulators, reached only in the sandbox through
 * `awsClientOptions()`. A client built without it would reach real AWS from
 * a laptop (or fail there), and a queue URL read raw would let a local
 * address redirect production messages. This finds the next one before it
 * is written.
 */

const REPO = resolve(__dirname, '../../..');
const ROOTS = ['packages', 'apps'];
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  '.open-next',
  '.sst',
  'dist',
  'coverage',
  'test-results',
]);
const SOURCE = /\.(?:ts|tsx|js|mjs|cjs)$/;
const TEST_FILE =
  /(?:^|\/)(?:__tests__|__mocks__|e2e)\/|\.(?:test|spec)\.[jt]sx?$/;

const CLIENT =
  /\bnew\s+(SQSClient|DynamoDBClient|ApiGatewayManagementApiClient)\s*\(/g;
const QUEUE_ENV = /process\.env\.([A-Z_]*QUEUE_URL)\b/g;

function sourceFiles(path: string): string[] {
  const absolute = join(REPO, path);
  if (!statSync(absolute).isDirectory()) return SOURCE.test(path) ? [path] : [];
  return readdirSync(absolute).flatMap((entry) =>
    SKIP_DIRS.has(entry) ? [] : sourceFiles(join(path, entry)),
  );
}

const FILES = ROOTS.flatMap(sourceFiles)
  .map((file) => relative(REPO, join(REPO, file)).split(sep).join('/'))
  .filter((file) => !TEST_FILE.test(file));

function argumentsFrom(source: string, open: number) {
  let depth = 0;
  for (let at = open; at < source.length; at++) {
    if (source[at] === '(') depth++;
    if (source[at] === ')' && --depth === 0) return source.slice(open, at + 1);
  }
  return source.slice(open);
}

const lineOf = (source: string, index: number) =>
  source.slice(0, index).split('\n').length;

describe('AWS clients reach the local emulators only through awsClientOptions (FILM-1806)', () => {
  it('finds the clients, so an empty result means clean and not unread', () => {
    const found = FILES.flatMap((file) =>
      [...readFileSync(join(REPO, file), 'utf8').matchAll(CLIENT)].map(
        (m) => `${file} ${m[1]}`,
      ),
    );
    expect(found).toEqual(
      expect.arrayContaining([
        'packages/features/prompt-engine/src/lib/server/sqs-helper.ts SQSClient',
        'apps/web/lambda/llm-worker/index.ts DynamoDBClient',
        'apps/web/websocket/connect.ts DynamoDBClient',
        'apps/web/lambda/llm-worker/index.ts ApiGatewayManagementApiClient',
      ]),
    );
  });

  it('builds every SQS, DynamoDB and API Gateway client with awsClientOptions', () => {
    const missing = FILES.flatMap((file) => {
      const source = readFileSync(join(REPO, file), 'utf8');
      return [...source.matchAll(CLIENT)]
        .filter(
          (m) =>
            !/awsClientOptions\(/.test(
              argumentsFrom(source, m.index + m[0].length - 1),
            ),
        )
        .map(
          (m) =>
            `${file}:${lineOf(source, m.index)} new ${m[1]}() without awsClientOptions()`,
        );
    });
    expect(missing).toEqual([]);
  });

  it('reads every queue URL through queueUrlFromEnv', () => {
    const raw = FILES.flatMap((file) => {
      const source = readFileSync(join(REPO, file), 'utf8');
      return [...source.matchAll(QUEUE_ENV)]
        .filter(
          (m) =>
            !/queueUrlFromEnv\(\s*$/.test(
              source.slice(Math.max(0, m.index - 40), m.index),
            ),
        )
        .map((m) => `${file}:${lineOf(source, m.index)} reads ${m[1]} raw`);
    });
    expect(raw).toEqual([]);
  });
});
