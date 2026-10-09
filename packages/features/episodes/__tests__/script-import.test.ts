import { describe, expect, it } from 'vitest';

import { MAX_SCRIPT_CHARS, parseScript } from '../src/lib/script-import';

/**
 * FILM-2205: a finished script becomes the screenplay stage's scenes,
 * checked with its SceneSchema, whatever format it came in.
 */
const FOUNTAIN = `Title: The Gate
Author: A Writer

INT. LIGHTHOUSE - NIGHT

Rain lashes the glass. MARA climbs the stairs.

MARA
(breathless)
The tide is turning.
We have an hour.

JONAH (V.O.)
Then we go now.

CUT TO:

EXT. HARBOUR - DAWN

Boats knock against the pier.

/* a note the writer kept */
`;

const FDX = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
    <Paragraph Type="Scene Heading"><Text>INT. HALL - AFTERNOON</Text></Paragraph>
    <Paragraph Type="Action"><Text>A long table. Two </Text><Text>chairs.</Text></Paragraph>
    <Paragraph Type="Character"><Text>ADA</Text></Paragraph>
    <Paragraph Type="Parenthetical"><Text>(quietly)</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>Sit &amp; listen.</Text></Paragraph>
    <Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>
    <Paragraph Type="Scene Heading"><Text>EXT. PIER - GOLDEN HOUR</Text></Paragraph>
    <Paragraph Type="Action"><Text>Gulls.</Text></Paragraph>
  </Content>
</FinalDraft>`;

describe('parseScript', () => {
  it('reads Fountain: headings, action, speakers, parentheticals, multi-line speech', () => {
    const result = parseScript(FOUNTAIN);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.format).toBe('fountain');
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes[0]).toMatchObject({
      number: 1,
      heading: 'INT. LIGHTHOUSE - NIGHT',
      location: 'LIGHTHOUSE',
      timeOfDay: 'night',
      description: 'Rain lashes the glass. MARA climbs the stairs.',
      dialogue: [
        {
          character: 'MARA',
          text: 'The tide is turning. We have an hour.',
          parenthetical: 'breathless',
        },
        { character: 'JONAH', text: 'Then we go now.' },
      ],
    });
    expect(result.scenes[1]).toMatchObject({
      number: 2,
      location: 'HARBOUR',
      timeOfDay: 'dawn',
      description: 'Boats knock against the pier.',
      dialogue: [],
    });
    expect(result.scenes.every((scene) => scene.estimatedDuration >= 5)).toBe(
      true,
    );
  });

  it('reads Final Draft, joining text runs and decoding entities', () => {
    const result = parseScript(FDX);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.format).toBe('fdx');
    expect(result.scenes.map((scene) => scene.timeOfDay)).toEqual([
      'afternoon',
      'golden-hour',
    ]);
    expect(result.scenes[0]).toMatchObject({
      description: 'A long table. Two chairs.',
      dialogue: [
        { character: 'ADA', text: 'Sit & listen.', parenthetical: 'quietly' },
      ],
    });
  });

  it('reads plain text with no headings as one scene', () => {
    const result = parseScript('A quiet kitchen.\n\nNOOR\nPass the salt.\n');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.format).toBe('text');
    expect(result.scenes).toEqual([
      expect.objectContaining({
        heading: 'SCENE 1',
        description: 'A quiet kitchen.',
        dialogue: [{ character: 'NOOR', text: 'Pass the salt.' }],
      }),
    ]);
  });

  it('refuses an empty or oversized script', () => {
    expect(parseScript('   \n')).toEqual({
      ok: false,
      error: 'The script is empty.',
    });
    expect(parseScript('x'.repeat(MAX_SCRIPT_CHARS + 1)).ok).toBe(false);
  });
});
