import { describe, expect, it, vi } from 'vitest';

import { MemoryCache } from '@kit/cache';

import {
  describeRequestForLog,
  recordToolCall,
  redactHeaders,
} from '../src/server/audit';
import { checkRateLimits } from '../src/server/rate-limit';

describe('redactHeaders', () => {
  it('replaces every credential header, whatever its casing, and keeps the rest', () => {
    const redacted = redactHeaders(
      new Headers({
        Authorization: 'Bearer sbk_pat_SECRET',
        Cookie: 'sb-access-token=SECRET2',
        apikey: 'SECRET3',
        'X-Api-Key': 'SECRET4',
        'Content-Type': 'application/json',
        'Mcp-Protocol-Version': '2025-06-18',
      }),
    );

    expect(redacted).toEqual({
      authorization: '[redacted]',
      cookie: '[redacted]',
      apikey: '[redacted]',
      'x-api-key': '[redacted]',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-06-18',
    });
    expect(JSON.stringify(redacted)).not.toMatch(/SECRET/);
  });

  it('accepts Node-style header records too', () => {
    expect(
      redactHeaders({
        AUTHORIZATION: 'Bearer x',
        accept: ['a', 'b'],
        host: undefined,
      }),
    ).toEqual({ authorization: '[redacted]', accept: 'a, b', host: '' });
  });

  it('describeRequestForLog never carries the bearer token', () => {
    const described = describeRequestForLog(
      new Request('https://app.test/api/mcp?x=1', {
        method: 'POST',
        headers: { authorization: 'Bearer sbk_pat_TOKENVALUE' },
      }),
    );

    expect(described).toMatchObject({ method: 'POST', path: '/api/mcp' });
    expect(JSON.stringify(described)).not.toContain('TOKENVALUE');
  });
});

describe('recordToolCall', () => {
  it('writes the row without any payload field, and swallows a write failure', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = { from: vi.fn().mockReturnValue({ insert }) } as any;

    await recordToolCall(admin, {
      connectionId: 'c',
      userId: 'u',
      accountId: 'a',
      tool: 'whoami',
      runId: null,
      status: 'error',
      errorCode: 'FORBIDDEN',
      durationMs: 12.6,
    });

    expect(admin.from).toHaveBeenCalledWith('mcp_tool_calls');
    expect(insert).toHaveBeenCalledWith({
      connection_id: 'c',
      user_id: 'u',
      account_id: 'a',
      tool: 'whoami',
      run_id: null,
      status: 'error',
      error_code: 'FORBIDDEN',
      duration_ms: 13,
    });
    expect(Object.keys(insert.mock.calls[0]![0])).not.toContain('arguments');

    insert.mockResolvedValue({ error: { code: '42501', message: 'denied' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      recordToolCall(admin, {
        connectionId: 'c',
        userId: 'u',
        accountId: 'a',
        tool: 'whoami',
        runId: null,
        status: 'ok',
        errorCode: null,
        durationMs: 1,
      }),
    ).resolves.toBeUndefined();

    spy.mockRestore();
  });
});

describe('checkRateLimits', () => {
  const limits = { callsPerMinute: 3, writesPerMinute: 1 };
  const now = Date.UTC(2026, 9, 2, 12, 0, 20); // 20s into a window

  it('allows up to the call limit per connection, then refuses with the time to the next window', async () => {
    const cache = new MemoryCache();
    const input = {
      connectionId: 'c1',
      accountId: 'a1',
      isWrite: false,
      limits,
      now,
    };

    for (let i = 0; i < 3; i++) {
      expect(await checkRateLimits(cache, input)).toEqual({ allowed: true });
    }

    expect(await checkRateLimits(cache, input)).toEqual({
      allowed: false,
      limit: 'connection_calls',
      retryAfterS: 40,
    });
    cache.destroy();
  });

  it('two connections of one team share the team limit', async () => {
    const cache = new MemoryCache();
    const a = {
      connectionId: 'c1',
      accountId: 'a1',
      isWrite: false,
      limits,
      now,
    };
    const b = { ...a, connectionId: 'c2' };

    await checkRateLimits(cache, a);
    await checkRateLimits(cache, a);
    expect(await checkRateLimits(cache, b)).toEqual({ allowed: true });
    expect((await checkRateLimits(cache, b)).allowed).toBe(false);
    expect(await checkRateLimits(cache, b)).toMatchObject({
      limit: 'team_calls',
    });
    cache.destroy();
  });

  it('writes are counted against the write limit as well as the call limit', async () => {
    const cache = new MemoryCache();
    const write = {
      connectionId: 'c1',
      accountId: 'a1',
      isWrite: true,
      limits,
      now,
    };

    expect(await checkRateLimits(cache, write)).toEqual({ allowed: true });
    expect(await checkRateLimits(cache, write)).toMatchObject({
      allowed: false,
      limit: 'connection_writes',
    });
    // Reads still pass: only one of three calls has been used
    expect(await checkRateLimits(cache, { ...write, isWrite: false })).toEqual({
      allowed: true,
    });
    cache.destroy();
  });

  it('a new minute starts a new count', async () => {
    const cache = new MemoryCache();
    const input = {
      connectionId: 'c1',
      accountId: 'a1',
      isWrite: false,
      limits,
      now,
    };

    for (let i = 0; i < 4; i++) await checkRateLimits(cache, input);
    expect((await checkRateLimits(cache, input)).allowed).toBe(false);
    expect(
      await checkRateLimits(cache, { ...input, now: now + 60_000 }),
    ).toEqual({
      allowed: true,
    });
    cache.destroy();
  });
});
