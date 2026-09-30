import { describe, expect, it } from 'vitest';

import { TWEET_URL_LENGTH, tweetLength } from '../src/lib/tweet-length';

describe('tweetLength', () => {
  it('counts plain characters one each', () => {
    expect(tweetLength('hello world')).toBe(11);
    expect(tweetLength('')).toBe(0);
  });

  it('counts a link as 23 characters however long it is', () => {
    const link = 'https://example.com/a/very/long/path?with=query&and=more';

    expect(tweetLength(link)).toBe(TWEET_URL_LENGTH);
    expect(tweetLength(`see ${link}`)).toBe(4 + TWEET_URL_LENGTH);
  });

  it('counts each of several links', () => {
    expect(tweetLength('a http://x.co b https://y.co')).toBe(
      'a  b '.length + 2 * TWEET_URL_LENGTH,
    );
  });

  it('counts an astral character once', () => {
    expect(tweetLength('a😀')).toBe(2);
  });

  it('puts exactly 280 characters at the limit', () => {
    expect(tweetLength('x'.repeat(280))).toBe(280);
    expect(tweetLength('x'.repeat(281))).toBe(281);
  });
});
