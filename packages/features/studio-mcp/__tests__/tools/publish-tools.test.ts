import { describe, expect, it, vi } from 'vitest';

import { preselectedScopes } from '../../src/scopes';
import { DEFAULT_SCOPES, parseScopes } from '../../src/server/oauth/authorize';
import { defaultTools } from '../../src/server/tools';

vi.mock('server-only', () => ({}));

/**
 * Scheduling publishes over MCP (owner, 2026-10-10): only a connection a
 * person granted studio:publish may schedule or cancel, and the consent
 * screen never ticks that scope for them.
 */
describe('the publish tools', () => {
  const scopeOf = (name: string) =>
    defaultTools.find((tool) => tool.name === name)?.scope;

  it('schedule and cancel need studio:publish; listing needs only studio:read', () => {
    expect(scopeOf('schedule_publish')).toBe('studio:publish');
    expect(scopeOf('cancel_scheduled_publish')).toBe('studio:publish');
    expect(scopeOf('list_episode_publishes')).toBe('studio:read');
  });

  it('no other tool holds studio:publish', () => {
    expect(
      defaultTools
        .filter((tool) => tool.scope === 'studio:publish')
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(['cancel_scheduled_publish', 'schedule_publish']);
  });
});

describe('studio:publish on the consent screen', () => {
  it('is offered when a client asks for no scope in particular, and not ticked', () => {
    const offered = parseScopes(null)!;

    expect(offered).toContain('studio:publish');
    expect(preselectedScopes(offered)).toEqual(DEFAULT_SCOPES);
  });

  it('is not ticked even when the client asks for it', () => {
    expect(
      preselectedScopes(['studio:read', 'studio:publish', 'studio:write']),
    ).toEqual(['studio:read', 'studio:write']);
  });
});
