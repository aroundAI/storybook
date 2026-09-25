import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sanitizeForPrompt } from '@kit/episodes/lib';

import * as builder from '../utils/context-builder';
import { P, expectSanitised, fakeClient } from './helpers/injected-rows';

// KB-101. Project text reaches the worker's prompts through the two context
// builders and the formatters over them. Every row below carries an
// injection payload in every text column the builders read; nothing any
// builder returns, and nothing any exported formatter prints, may carry it
// raw. The formatter list is checked against the module's exports, so a new
// formatter fails here until it is added.

describe('project text in the worker prompts is sanitised (KB-101)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('buildEpisodeContext returns no raw project text', async () => {
    const context = await builder.buildEpisodeContext('e5', fakeClient());

    expectSanitised(context, 'buildEpisodeContext');
    // The text is still there, only defused.
    expect(context.seasonDirectionNotes).toBe(sanitizeForPrompt(P));
    expect(context.characters[0]!.name).toBe(sanitizeForPrompt(`${P} c1`));
  });

  it('buildGlobalShotContext returns no raw project text', async () => {
    const global = await builder.buildGlobalShotContext('e5', fakeClient());

    expectSanitised(
      [global.characterRegistry, global.locationRegistry, global.episode],
      'buildGlobalShotContext',
    );
  });

  it('every exported formatter prints no raw project text', async () => {
    const context = await builder.buildEpisodeContext('e5', fakeClient());
    const global = await builder.buildGlobalShotContext('e5', fakeClient());
    const characterName = global.characterRegistry[0]!.name;
    const locationName = global.locationRegistry[0]!.name;
    const scene = {
      number: 1,
      heading: P,
      location: locationName,
      timeOfDay: P,
      description: P,
      dialogue: [{ character: characterName, text: P, parenthetical: P }],
    };
    const filtered = builder.filterContextForScene(scene, global);

    const formatters: Record<string, () => string> = {
      formatVerifiedFactsForPrompt: () =>
        builder.formatVerifiedFactsForPrompt(context.verifiedFacts),
      formatCharactersForPrompt: () =>
        builder.formatCharactersForPrompt(context.characters),
      formatLocationsForPrompt: () =>
        builder.formatLocationsForPrompt(context.locations),
      formatPreviousEpisodesForPrompt: () =>
        builder.formatPreviousEpisodesForPrompt(context.previousEpisodes),
      formatRecurringElementsForPrompt: () =>
        builder.formatRecurringElementsForPrompt(context.recurringElements),
      formatRecurringElementForPrompt: () =>
        builder.formatRecurringElementForPrompt(context.recurringElements?.[0]),
      formatBeatsForPrompt: () => builder.formatBeatsForPrompt(context),
      formatCharacterForVeoPrompt: () =>
        builder.formatCharacterForVeoPrompt(context.characters[0]!),
      formatCharactersForVeoPrompt: () =>
        builder.formatCharactersForVeoPrompt(context.characters),
      formatLocationForVeoPrompt: () =>
        builder.formatLocationForVeoPrompt(context.locations[0]!),
      formatLocationsForVeoPrompt: () =>
        builder.formatLocationsForVeoPrompt(context.locations),
      formatSceneForPrompt: () => builder.formatSceneForPrompt(scene),
      formatFilteredCharactersForPrompt: () =>
        builder.formatFilteredCharactersForPrompt(filtered, [characterName]),
      formatCharactersMinimal: () =>
        builder.formatCharactersMinimal(filtered, [characterName]),
      formatLocationsMinimal: () =>
        builder.formatLocationsMinimal(filtered, locationName),
      formatFilteredLocationsForPrompt: () =>
        builder.formatFilteredLocationsForPrompt(filtered, locationName),
      formatFactsForPrompt: () =>
        builder.formatFactsForPrompt(context.episodeFacts),
    };

    expect(Object.keys(formatters).sort()).toEqual(
      Object.keys(builder)
        .filter((name) => name.startsWith('format'))
        .sort(),
    );

    for (const [name, format] of Object.entries(formatters)) {
      const printed = format();
      expect(printed, `${name} printed nothing`).not.toBe('');
      expectSanitised(printed, name);
    }
  });
});
