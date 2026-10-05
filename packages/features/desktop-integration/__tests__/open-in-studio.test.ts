import { describe, expect, it } from 'vitest';

import {
  OPEN_IN_STUDIO_STATUSES,
  canOpenInStudio,
  studioOpenLink,
} from '../src/open-in-studio';

const EPISODE = '0b7d4a52-6c39-4c0e-9d6f-1f2a3b4c5d6e';

describe('which episodes open in StorybookStudio (FILM-2005)', () => {
  it.each(['storyboard', 'generating', 'ready', 'published'])(
    'an episode in %s does',
    (status) => {
      expect(canOpenInStudio(status)).toBe(true);
    },
  );

  it.each(['draft', 'story', 'editing', 'archived', '', 'READY'])(
    'an episode in "%s" does not',
    (status) => {
      expect(canOpenInStudio(status)).toBe(false);
    },
  );

  it('the list is the four the spec names', () => {
    expect([...OPEN_IN_STUDIO_STATUSES]).toEqual([
      'storyboard',
      'generating',
      'ready',
      'published',
    ]);
  });
});

describe('the storybookstudio://open deep link', () => {
  it('carries the encoded app origin and the episode id, nothing else', () => {
    const link = studioOpenLink({
      origin: 'https://app.storybook.test',
      episodeId: EPISODE,
    });

    expect(link).toBe(
      `storybookstudio://open?api=https%3A%2F%2Fapp.storybook.test&episode=${EPISODE}`,
    );

    const url = new URL(link);
    expect(url.protocol).toBe('storybookstudio:');
    expect(url.host).toBe('open');
    expect([...url.searchParams.keys()]).toEqual(['api', 'episode']);
    expect(url.searchParams.get('api')).toBe('https://app.storybook.test');
  });

  it('reduces whatever it is given to the origin: no path, query, fragment or credentials ever travel', () => {
    const link = studioOpenLink({
      origin:
        'http://user:secret@localhost:3100/home/team/studio?access_token=sbk_at_x#sb-session',
      episodeId: EPISODE,
    });

    const api = new URL(link).searchParams.get('api');
    expect(api).toBe('http://localhost:3100');
    expect(link.replace(/^storybookstudio:\/\/open\?/, '')).not.toMatch(
      /secret|sbk_|token|session|studio/,
    );
  });

  it('refuses an episode id that is not a UUID, so nothing can be appended through it', () => {
    expect(() =>
      studioOpenLink({
        origin: 'https://app.storybook.test',
        episodeId: `${EPISODE}&token=sbk_at_x`,
      }),
    ).toThrow();
  });

  it('refuses an origin that is not http or https', () => {
    expect(() =>
      studioOpenLink({ origin: 'javascript:alert(1)', episodeId: EPISODE }),
    ).toThrow();
  });
});
