import { describe, expect, it, vi } from 'vitest';

import {
  extractContentId,
  formatDescriptionForPlatform,
  generateDefaultTags,
  sanitizeFilename,
} from '../src/lib/upload-only-format';

describe('Upload Only Actions - Helper Functions', () => {
  describe('extractContentId', () => {
    describe('YouTube URLs', () => {
      it('should extract video ID from standard watch URL', () => {
        const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
        expect(extractContentId(url, 'youtube')).toBe('dQw4w9WgXcQ');
      });

      it('should extract video ID from short URL', () => {
        const url = 'https://youtu.be/dQw4w9WgXcQ';
        expect(extractContentId(url, 'youtube')).toBe('dQw4w9WgXcQ');
      });

      it('should extract video ID with additional parameters', () => {
        const url =
          'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLtest&index=1';
        expect(extractContentId(url, 'youtube')).toBe('dQw4w9WgXcQ');
      });

      it('should return null for invalid YouTube URL', () => {
        const url = 'https://www.youtube.com/channel/UCtest';
        expect(extractContentId(url, 'youtube')).toBeNull();
      });
    });

    describe('TikTok URLs', () => {
      it('should extract video ID from standard URL', () => {
        const url = 'https://www.tiktok.com/@user/video/1234567890123456789';
        expect(extractContentId(url, 'tiktok')).toBe('1234567890123456789');
      });

      it('should return null for invalid TikTok URL', () => {
        const url = 'https://www.tiktok.com/@user';
        expect(extractContentId(url, 'tiktok')).toBeNull();
      });
    });

    describe('Instagram URLs', () => {
      it('should extract reel ID from reel URL', () => {
        const url = 'https://www.instagram.com/reel/ABC123xyz_-/';
        expect(extractContentId(url, 'instagram')).toBe('ABC123xyz_-');
      });

      it('should extract post ID from post URL', () => {
        const url = 'https://www.instagram.com/p/ABC123xyz/';
        expect(extractContentId(url, 'instagram')).toBe('ABC123xyz');
      });

      it('should return null for invalid Instagram URL', () => {
        const url = 'https://www.instagram.com/username/';
        expect(extractContentId(url, 'instagram')).toBeNull();
      });
    });

    describe('Facebook URLs', () => {
      it('should extract video ID from videos URL', () => {
        const url = 'https://www.facebook.com/watch/videos/1234567890';
        expect(extractContentId(url, 'facebook')).toBe('1234567890');
      });

      it('should return null for invalid Facebook URL', () => {
        const url = 'https://www.facebook.com/page/posts/123';
        expect(extractContentId(url, 'facebook')).toBeNull();
      });
    });

    describe('Logger integration', () => {
      it('should call logger.warn when content ID extraction fails', () => {
        const mockLogger = {
          warn: vi.fn(),
        };
        const url = 'https://invalid-url.com/nothing';

        extractContentId(url, 'youtube', mockLogger);

        expect(mockLogger.warn).toHaveBeenCalledWith(
          { url, platform: 'youtube' },
          'Could not extract content ID from URL. Analytics tracking may be limited.',
        );
      });

      it('should not call logger.warn when extraction succeeds', () => {
        const mockLogger = {
          warn: vi.fn(),
        };
        const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

        extractContentId(url, 'youtube', mockLogger);

        expect(mockLogger.warn).not.toHaveBeenCalled();
      });

      it('should work without logger parameter', () => {
        const url = 'https://invalid-url.com/nothing';

        // Should not throw
        expect(() => extractContentId(url, 'youtube')).not.toThrow();
        expect(extractContentId(url, 'youtube')).toBeNull();
      });
    });
  });

  describe('sanitizeFilename', () => {
    it('should remove special characters', () => {
      const title = 'My Video: "The Best!" @2024';
      expect(sanitizeFilename(title)).toBe('my_video_the_best_2024');
    });

    it('should replace spaces with underscores', () => {
      const title = 'My Cool Video';
      expect(sanitizeFilename(title)).toBe('my_cool_video');
    });

    it('should convert to lowercase', () => {
      const title = 'MY VIDEO TITLE';
      expect(sanitizeFilename(title)).toBe('my_video_title');
    });

    it('should limit length to 100 characters', () => {
      const title = 'a'.repeat(150);
      expect(sanitizeFilename(title).length).toBe(100);
    });

    it('should handle multiple consecutive spaces', () => {
      const title = 'My    Video   Title';
      expect(sanitizeFilename(title)).toBe('my_video_title');
    });

    it('should preserve hyphens', () => {
      const title = 'My-Video-Title';
      expect(sanitizeFilename(title)).toBe('my-video-title');
    });

    it('should handle empty string', () => {
      expect(sanitizeFilename('')).toBe('');
    });

    it('should handle title with only special characters', () => {
      const title = '@#$%^&*()';
      expect(sanitizeFilename(title)).toBe('');
    });

    it('should handle unicode characters by removing them', () => {
      const title = 'Video 日本語 Title';
      expect(sanitizeFilename(title)).toBe('video_title');
    });

    it('should handle emojis by removing them', () => {
      const title = 'My 🎬 Video 🎥';
      // Trailing underscore is acceptable - emojis become spaces which become underscores
      expect(sanitizeFilename(title)).toBe('my_video_');
    });
  });

  describe('formatDescriptionForPlatform', () => {
    const longDescription = 'a'.repeat(10000);

    describe('TikTok', () => {
      it('should truncate to 2200 characters', () => {
        const result = formatDescriptionForPlatform(longDescription, 'tiktok');
        expect(result.length).toBe(2200);
      });

      it('should not modify short descriptions', () => {
        const short = 'Short description';
        expect(formatDescriptionForPlatform(short, 'tiktok')).toBe(short);
      });
    });

    describe('Instagram', () => {
      it('should truncate to 2200 characters', () => {
        const result = formatDescriptionForPlatform(
          longDescription,
          'instagram',
        );
        expect(result.length).toBe(2200);
      });
    });

    describe('YouTube', () => {
      it('should truncate to 5000 characters', () => {
        const result = formatDescriptionForPlatform(longDescription, 'youtube');
        expect(result.length).toBe(5000);
      });
    });

    describe('Facebook', () => {
      it('should truncate to 63206 characters', () => {
        const veryLongDescription = 'a'.repeat(70000);
        const result = formatDescriptionForPlatform(
          veryLongDescription,
          'facebook',
        );
        expect(result.length).toBe(63206);
      });

      it('should not modify descriptions under limit', () => {
        const result = formatDescriptionForPlatform(
          longDescription,
          'facebook',
        );
        expect(result.length).toBe(10000);
      });
    });

    it('should handle empty description', () => {
      expect(formatDescriptionForPlatform('', 'youtube')).toBe('');
    });
  });

  describe('generateDefaultTags', () => {
    it('should extract words from title longer than 3 characters', () => {
      const episode = {
        title: 'The Amazing Spider Man Returns',
        description: null,
        metadata: undefined,
      };

      const tags = generateDefaultTags(episode, 'youtube');

      expect(tags).toContain('Amazing');
      expect(tags).toContain('Spider');
      expect(tags).toContain('Returns');
      expect(tags).not.toContain('The'); // 3 chars
      expect(tags).not.toContain('Man'); // 3 chars
    });

    it('should limit title words to 5', () => {
      const episode = {
        title: 'One Two Three Four Five Six Seven Eight',
        description: null,
        metadata: undefined,
      };

      const tags = generateDefaultTags(episode, 'youtube');

      // Words > 3 chars: Three, Four, Five, Seven, Eight (only first 5)
      expect(tags.length).toBeLessThanOrEqual(5);
    });

    it('should include tags from metadata', () => {
      const episode = {
        title: 'Video Title',
        description: null,
        metadata: {
          tags: ['custom', 'tags', 'here'],
        },
      };

      const tags = generateDefaultTags(episode, 'youtube');

      expect(tags).toContain('custom');
      expect(tags).toContain('tags');
      expect(tags).toContain('here');
    });

    it('should deduplicate tags', () => {
      const episode = {
        title: 'Amazing Video',
        description: null,
        metadata: {
          tags: ['Amazing', 'Video', 'Extra'],
        },
      };

      const tags = generateDefaultTags(episode, 'youtube');

      const amazingCount = tags.filter((t) => t === 'Amazing').length;
      const videoCount = tags.filter((t) => t === 'Video').length;

      expect(amazingCount).toBe(1);
      expect(videoCount).toBe(1);
    });

    it('should limit total tags to 30', () => {
      const manyTags = Array.from({ length: 50 }, (_, i) => `tag${i}`);
      const episode = {
        title: 'Some Title Here With Many Words For Tags',
        description: null,
        metadata: {
          tags: manyTags,
        },
      };

      const tags = generateDefaultTags(episode, 'youtube');

      expect(tags.length).toBeLessThanOrEqual(30);
    });

    it('should handle null title', () => {
      const episode = {
        title: null,
        description: null,
        metadata: undefined,
      };

      const tags = generateDefaultTags(episode, 'youtube');

      expect(tags).toEqual([]);
    });

    it('should handle undefined title', () => {
      const episode = {
        title: undefined,
        description: null,
        metadata: undefined,
      };

      const tags = generateDefaultTags(episode, 'youtube');

      expect(tags).toEqual([]);
    });

    it('should handle missing metadata', () => {
      const episode = {
        title: 'Video Title',
        description: null,
        metadata: undefined,
      };

      expect(() => generateDefaultTags(episode, 'youtube')).not.toThrow();
    });

    it('should handle non-array tags in metadata', () => {
      const episode = {
        title: 'Video Title',
        description: null,
        metadata: {
          tags: 'not-an-array',
        },
      };

      const tags = generateDefaultTags(episode, 'youtube');

      // Should only have title words, not the invalid tags
      expect(tags).toContain('Video');
      expect(tags).toContain('Title');
      expect(tags).not.toContain('not-an-array');
    });
  });
});
