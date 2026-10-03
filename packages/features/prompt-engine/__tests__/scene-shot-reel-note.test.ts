import { describe, expect, it } from 'vitest';

import { renderTemplate } from '../src/lib/render-template';
import sceneShotGeneration from '../src/prompts/story-generation/scene-shot-generation.json';

/**
 * KB-178: the Reel Scout's note for a Reel-candidate scene is sent as
 * `reel_note`, and the template used to declare it without placing it, so
 * the model never saw it. The owner wants it seen (2026-10-03).
 */
const variables = {
  scene_number: 2,
  total_scenes: 5,
  scene_content: '{"number":2,"heading":"INT. KITCHEN - NIGHT"}',
  episode_metadata: '{"title":"Pilot"}',
  characters: 'Maya Chen',
  locations: 'Kitchen',
  previous_scene_summary: '',
  recurring_element: '',
  shot_duration_min: 4,
  shot_duration_max: 8,
};

function render(reelNote: string) {
  return renderTemplate('scene-shot-generation', sceneShotGeneration, {
    ...variables,
    reel_note: reelNote,
  });
}

describe('scene-shot-generation places the Reel Scout note (KB-178)', () => {
  it('sends a Reel candidate’s note to the model, right after the scene it steers', () => {
    const { userPrompt } = render('CANARY-REEL-NOTE');

    expect(userPrompt).toContain('CANARY-REEL-NOTE');
    expect(userPrompt.indexOf('CANARY-REEL-NOTE')).toBeGreaterThan(
      userPrompt.indexOf('INT. KITCHEN - NIGHT'),
    );
    expect(userPrompt.indexOf('CANARY-REEL-NOTE')).toBeLessThan(
      userPrompt.indexOf('## REQUIREMENTS'),
    );
  });

  it('renders an unflagged scene with no trace of the note and no heading left behind', () => {
    const flagged = render('CANARY-REEL-NOTE').userPrompt;
    const plain = render('').userPrompt;

    expect(plain).not.toContain('CANARY-REEL-NOTE');
    expect(plain).not.toMatch(/\{\{/);
    expect(plain).toBe(flagged.replace('CANARY-REEL-NOTE', ''));
    expect(plain).not.toMatch(/REEL PRIORITY/i);
  });
});
