import { describe, expect, it } from 'vitest';

import { defaultTools } from '../src/server/tools/index';

/**
 * Clients decide from the annotations whether to ask before a call
 * (FILM-1911): ChatGPT treats a tool without readOnlyHint as a write and
 * asks; Claude runs read-only tools without asking and always asks before a
 * destructive one. MCP reads a missing openWorldHint as true, so every tool
 * says it.
 */
const REACHES_OUTSIDE_STORYBOOK = ['start_voice_render', 'start_audio_render'];

describe('the annotations every tool sends', () => {
  it.each(defaultTools.map((tool) => [tool.name, tool] as const))(
    '%s declares all four hints, and a read-only tool is never destructive',
    (_name, tool) => {
      const { annotations } = tool;

      for (const hint of [
        'readOnlyHint',
        'destructiveHint',
        'idempotentHint',
        'openWorldHint',
      ] as const) {
        expect(typeof annotations[hint], hint).toBe('boolean');
      }

      if (annotations.readOnlyHint) {
        expect(annotations.destructiveHint).toBe(false);
      }

      expect(tool.title.length).toBeGreaterThan(0);
    },
  );

  it('only the vendor renders reach outside StoryBook', () => {
    expect(
      defaultTools
        .filter((tool) => tool.annotations.openWorldHint)
        .map((tool) => tool.name)
        .sort(),
    ).toEqual([...REACHES_OUTSIDE_STORYBOOK].sort());
  });
});
