import { describe, expect, it } from 'vitest';

import {
  externalClientLabel,
  latestStageOrigin,
  originLabel,
  parseGenerationOrigin,
} from '../generation-origin';
import { STUDIO_PAGE_STAGES, studioPageFromPath } from '../stage-runs';

describe('origin badge text (FILM-1910)', () => {
  it('names the three authors', () => {
    expect(originLabel({ kind: 'server', model: 'gemini-3.5-flash' })).toEqual({
      label: 'Gemini',
      detail: 'gemini-3.5-flash',
    });
    expect(
      originLabel({
        kind: 'external',
        clientName: 'claude-ai',
        model: 'claude-opus-5-5',
      }),
    ).toEqual({ label: 'Claude via MCP', detail: 'reported: claude-opus-5-5' });
    expect(originLabel({ kind: 'human' })).toEqual({
      label: 'Edited',
      detail: null,
    });
  });

  it('names another MCP client as itself, and an unnamed one as Claude', () => {
    expect(externalClientLabel('Cursor')).toBe('Cursor');
    expect(externalClientLabel(null)).toBe('Claude');
    expect(externalClientLabel('Claude Desktop')).toBe('Claude');
  });

  it('shows no badge for content without an origin', () => {
    expect(parseGenerationOrigin(null)).toBeNull();
    expect(parseGenerationOrigin({})).toBeNull();
    expect(parseGenerationOrigin({ kind: 'robot' })).toBeNull();
  });

  it('keeps the kind when an optional field is malformed', () => {
    expect(parseGenerationOrigin({ kind: 'external', model: 42 })).toEqual({
      kind: 'external',
    });
  });
});

describe('the stage-keyed episode origin', () => {
  const origin = {
    story: { kind: 'server', at: '2026-10-03T10:00:00.000Z' },
    story_refinement: {
      kind: 'external',
      clientName: 'claude-ai',
      at: '2026-10-03T11:00:00.000Z',
    },
    screenplay: { kind: 'human', at: '2026-10-03T12:00:00.000Z' },
  };

  it('picks the newest origin among the page stages', () => {
    expect(
      latestStageOrigin(origin, STUDIO_PAGE_STAGES.story.stages)?.kind,
    ).toBe('external');
    expect(
      latestStageOrigin(origin, STUDIO_PAGE_STAGES.screenplay.stages)?.kind,
    ).toBe('human');
  });

  it('reads only stage keys, never a flat origin as a stage', () => {
    expect(
      latestStageOrigin(
        { kind: 'server', at: '2026-10-03T10:00:00.000Z' },
        STUDIO_PAGE_STAGES.story.stages,
      ),
    ).toBeNull();
    expect(latestStageOrigin({}, ['story'])).toBeNull();
  });
});

describe('the studio page a route shows', () => {
  it('maps the last path segment', () => {
    expect(
      studioPageFromPath('/home/team/studio/p/episodes/e1/visual-studio'),
    ).toBe('visual-studio');
    expect(studioPageFromPath('/home/team/studio/p/episodes/e1/story/')).toBe(
      'story',
    );
    expect(studioPageFromPath('/home/team/studio/p/episodes/e1/publish')).toBe(
      null,
    );
    expect(studioPageFromPath(null)).toBeNull();
  });

  it('blocks every page on its own stages', () => {
    for (const { stages, blocks } of Object.values(STUDIO_PAGE_STAGES)) {
      for (const stage of stages) {
        expect(blocks as readonly string[]).toContain(stage);
      }
    }
  });
});
