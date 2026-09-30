/** X shortens every link to a t.co URL and counts it as this many characters. */
export const TWEET_URL_LENGTH = 23;

const URL_PATTERN = /https?:\/\/\S+/g;

/**
 * The length X measures a post by: each link counts `TWEET_URL_LENGTH` however
 * long it is, everything else counts its characters. X's own weighting also
 * counts CJK and some emoji as two; that is not reproduced here, so the count
 * can under-report for such text.
 */
export function tweetLength(text: string): number {
  const links = text.match(URL_PATTERN) ?? [];

  return (
    [...text.replace(URL_PATTERN, '')].length + links.length * TWEET_URL_LENGTH
  );
}
