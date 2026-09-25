import { corpus } from '../corpus';
import social from '../corpus/social.json';
import type { Rng } from '../rng';

/**
 * Names and words for the social sandbox (FILM-1802 §4): channel and page
 * names, handles, captions and comments that read like a real creator's,
 * never like a fixture. Every generator here is in the placeholder test's
 * loop.
 */
export { social };

export function channelName(rng: Rng) {
  return rng.pick(social.channelNames);
}

export function pageName(rng: Rng) {
  return rng.pick(social.pageNames);
}

export function organizationName(rng: Rng) {
  return rng.pick(social.organizationNames);
}

/**
 * `@harbourlight.films`, `@copperstreet_tales`: a word and a suffix joined
 * by a dot or underscore. Never a trailing number, which is what a fixture's
 * counter looks like.
 */
export function handle(rng: Rng) {
  const word = rng.pick(social.handleWords);
  return rng.chance(0.35)
    ? word
    : `${word}${rng.pick(['.', '_'])}${rng.pick(social.handleSuffixes)}`;
}

export function personName(rng: Rng) {
  return `${rng.pick(corpus.firstNames)} ${rng.pick(corpus.lastNames)}`;
}

export function caption(rng: Rng) {
  return rng.pick(social.captions);
}

export function comment(rng: Rng) {
  return rng.pick(social.comments);
}

export function bio(rng: Rng) {
  return rng.pick(social.bios);
}

export function videoTitle(rng: Rng) {
  return rng.pick(corpus.episodeTitles);
}
