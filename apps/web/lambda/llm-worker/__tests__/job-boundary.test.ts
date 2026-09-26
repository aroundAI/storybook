import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LlmJobAuthzClient } from '@kit/prompt-engine/llm-job-target';

import { runLlmJob } from '../job-boundary';

/**
 * KB-33, KB-49. What the LLM worker checks before any handler runs: the
 * message and payload parse with the producer's schemas, and the job's user
 * can still write the job's project.
 */

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const EPISODE = '33333333-3333-4333-8333-333333333333';
const WRITER = '44444444-4444-4444-8444-444444444444';
const REVOKED = '55555555-5555-4555-8555-555555555555';

const dispatch = vi.fn();
const notify = vi.fn();

function supabase(): LlmJobAuthzClient {
  return {
    from(relation: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({
          data:
            relation === 'episodes'
              ? { project_id: PROJECT, deleted_at: null }
              : { account_id: ACCOUNT },
          error: null,
        }),
      };
      return builder;
    },
    rpc: (_fn: string, args: object) =>
      Promise.resolve({
        data: (args as { target_user_id: string }).target_user_id === WRITER,
        error: null,
      }),
  };
}

function message(userId: string, payload: Record<string, unknown> = {}) {
  return JSON.stringify({
    jobType: 'shot-generation',
    userId,
    payload: {
      accountId: ACCOUNT,
      projectId: PROJECT,
      episodeId: EPISODE,
      userId,
      version: 3,
      ...payload,
    },
  });
}

const deps = () => ({ supabase: supabase(), dispatch, notify });

beforeEach(() => {
  dispatch.mockReset();
  dispatch.mockResolvedValue({ ok: true });
  notify.mockReset();
  notify.mockResolvedValue(undefined);
});

describe('runLlmJob', () => {
  it('runs a writer’s job with the parsed payload and reports the result', async () => {
    await expect(runLlmJob(message(WRITER), deps())).resolves.toBe('done');

    expect(dispatch).toHaveBeenCalledWith(
      'shot-generation',
      expect.objectContaining({ episodeId: EPISODE, version: 3 }),
    );
    expect(notify).toHaveBeenCalledWith(
      WRITER,
      expect.objectContaining({ type: 'llm-result', result: { ok: true } }),
    );
  });

  it('does not run the job of a user who can no longer write the project', async () => {
    await expect(runLlmJob(message(REVOKED), deps())).resolves.toBe('refused');

    expect(dispatch).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      REVOKED,
      expect.objectContaining({
        type: 'llm-error',
        error: 'You no longer have write access to this project',
      }),
    );
  });

  it('refuses a payload missing a field before any handler runs, naming it', async () => {
    await expect(
      runLlmJob(message(WRITER, { version: undefined }), deps()),
    ).rejects.toThrow(/Invalid shot-generation payload: version: Required/);

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("refuses a payload naming another user than the message's", async () => {
    await expect(
      runLlmJob(message(WRITER, { userId: REVOKED }), deps()),
    ).rejects.toThrow(/userId: is not the message's userId/);

    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('the handlers', () => {
  const dir = join(__dirname, '../handlers');

  it('parse their payload rather than cast it (KB-33)', () => {
    const casts = readdirSync(dir)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => {
        const source = readFileSync(join(dir, file), 'utf8');
        return (
          source.includes('KB-33') ||
          /payload as unknown as/.test(source) ||
          !source.includes('parseLlmJobPayload(')
        );
      });

    expect(casts).toEqual([]);
  });
});
