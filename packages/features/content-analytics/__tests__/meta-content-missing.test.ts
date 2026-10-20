import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-207. A Facebook video or Instagram media taken down on the platform
 * stayed `published` in StoryBook. Only Meta's definite "does not exist"
 * (code 100 / subcode 33, or a 404 saying so) is read as gone; a token,
 * permission, rate-limit or server error is a failed read, as before.
 */
const metaFetch = vi.fn();

vi.mock('@kit/shared/vendors', () => ({
  metaFetch: (...args: unknown[]) => metaFetch(...args),
}));

const { FacebookInsightsProvider } = await import(
  '../src/providers/facebook/facebook-insights'
);
const { InstagramInsightsProvider } = await import(
  '../src/providers/instagram/instagram-insights'
);
const { PublishedContentMissingError, isGraphObjectMissing } = await import(
  '../src/lib/content-removed'
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

const GONE = json(
  {
    error: {
      message:
        "Unsupported get request. Object with ID '123' does not exist, cannot be loaded due to missing permissions, or does not support this operation.",
      type: 'GraphMethodException',
      code: 100,
      error_subcode: 33,
    },
  },
  400,
);

const answers = {
  expired: () =>
    json({ error: { message: 'Session has expired', code: 190 } }, 400),
  throttled: () =>
    json({ error: { message: 'Application request limit', code: 4 } }, 400),
  invalidParameter: () =>
    json({ error: { message: 'Invalid parameter', code: 100 } }, 400),
  serverError: () =>
    json({ error: { message: 'An unknown error occurred', code: 1 } }, 500),
};

describe('isGraphObjectMissing', () => {
  it('reads code 100 / subcode 33 and a 404 "does not exist" as gone', () => {
    expect(isGraphObjectMissing(400, { code: 100, error_subcode: 33 })).toBe(
      true,
    );
    expect(
      isGraphObjectMissing(404, { message: 'Object does not exist' }),
    ).toBe(true);
  });

  it('reads nothing else as gone', () => {
    expect(isGraphObjectMissing(400, { code: 100 })).toBe(false);
    expect(isGraphObjectMissing(400, { code: 190 })).toBe(false);
    expect(isGraphObjectMissing(404, { message: 'Not found' })).toBe(false);
    expect(isGraphObjectMissing(500, undefined)).toBe(false);
  });
});

describe('Facebook: a video gone from the Page (KB-207)', () => {
  beforeEach(() => metaFetch.mockReset());

  it('throws PublishedContentMissingError for the video', async () => {
    metaFetch.mockImplementation(async () => GONE.clone());

    await expect(
      new FacebookInsightsProvider('token').getVideoInsights({
        videoId: '123',
        reel: false,
      }),
    ).rejects.toBeInstanceOf(PublishedContentMissingError);
  });

  it.each(Object.entries(answers))(
    'a %s answer is a failed read, not a removal',
    async (_name, answer) => {
      metaFetch.mockImplementation(async () => answer());

      const read = new FacebookInsightsProvider('token').getVideoInsights({
        videoId: '123',
        reel: false,
      });

      await expect(read).rejects.toThrow();
      await expect(read).rejects.not.toBeInstanceOf(
        PublishedContentMissingError,
      );
    },
  );
});

describe('Instagram: media gone from the account (KB-207)', () => {
  beforeEach(() => metaFetch.mockReset());

  it('throws PublishedContentMissingError for the media', async () => {
    metaFetch.mockImplementation(async () => GONE.clone());

    await expect(
      new InstagramInsightsProvider('token', 'ig-1').getMediaInsights({
        mediaId: '123',
      }),
    ).rejects.toBeInstanceOf(PublishedContentMissingError);
  });

  it.each(Object.entries(answers))(
    'a %s answer is a failed read, not a removal',
    async (_name, answer) => {
      metaFetch.mockImplementation(async () => answer());

      const read = new InstagramInsightsProvider(
        'token',
        'ig-1',
      ).getMediaInsights({ mediaId: '123' });

      await expect(read).rejects.toThrow();
      await expect(read).rejects.not.toBeInstanceOf(
        PublishedContentMissingError,
      );
    },
  );
});
