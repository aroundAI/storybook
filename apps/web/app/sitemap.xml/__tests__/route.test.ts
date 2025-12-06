import { getServerSideSitemap } from 'next-sitemap';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCmsClient } from '@kit/cms';

// Import after mocking
import { GET } from '../route';

// Mock dependencies - declare before vi.mock to avoid hoisting issues
vi.mock('next-sitemap', () => ({
  getServerSideSitemap: vi.fn(),
}));

vi.mock('@kit/cms', () => ({
  createCmsClient: vi.fn(),
}));

vi.mock('~/config/app.config', () => ({
  default: {
    url: 'https://test.com',
    name: 'Test App',
  },
}));

describe('sitemap.xml/route', () => {
  const mockGetContentItems = vi.fn();
  const mockGetServerSideSitemap = vi.mocked(getServerSideSitemap);
  const mockCreateCmsClient = vi.mocked(createCmsClient);

  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateCmsClient.mockResolvedValue({
      getContentItems: mockGetContentItems,
    } as any);

    mockGetServerSideSitemap.mockReturnValue(
      new Response('<xml>sitemap</xml>', {
        headers: { 'content-type': 'application/xml' },
      }) as any,
    );
  });

  describe('GET handler', () => {
    describe('static paths generation', () => {
      it('should include homepage in sitemap', async () => {
        mockGetContentItems.mockResolvedValue({ items: [] });

        await GET();

        const [[paths]] = mockGetServerSideSitemap.mock.calls;
        const homePath = paths.find((p: any) => p.loc.endsWith('/'));

        expect(homePath).toBeDefined();
        expect(homePath.loc).toBe('https://test.com/');
      });

      it('should include all static paths', async () => {
        mockGetContentItems.mockResolvedValue({ items: [] });

        await GET();

        const [[paths]] = mockGetServerSideSitemap.mock.calls;
        const expectedPaths = [
          '/',
          '/faq',
          '/blog',
          '/docs',
          '/pricing',
          '/contact',
          '/cookie-policy',
          '/terms-of-service',
          '/privacy-policy',
        ];

        expectedPaths.forEach((path) => {
          const found = paths.find(
            (p: any) => p.loc === `https://test.com${path}`,
          );
          expect(found).toBeDefined();
        });
      });

      it('should include lastmod timestamp for static paths', async () => {
        mockGetContentItems.mockResolvedValue({ items: [] });

        await GET();

        const [[paths]] = mockGetServerSideSitemap.mock.calls;
        const homePath = paths.find((p: any) => p.loc === 'https://test.com/');

        expect(homePath.lastmod).toBeDefined();
        expect(new Date(homePath.lastmod)).toBeInstanceOf(Date);
      });
    });

    describe('blog posts integration', () => {
      it('should fetch blog posts from CMS', async () => {
        mockGetContentItems.mockResolvedValue({ items: [] });

        await GET();

        expect(mockGetContentItems).toHaveBeenCalledWith({
          collection: 'posts',
          content: false,
          limit: Infinity,
        });
      });

      it('should include blog posts in sitemap', async () => {
        mockGetContentItems.mockImplementation(({ collection }) => {
          if (collection === 'posts') {
            return Promise.resolve({
              items: [
                {
                  slug: 'first-post',
                  publishedAt: '2024-01-01T00:00:00Z',
                },
                {
                  slug: 'second-post',
                  publishedAt: '2024-01-02T00:00:00Z',
                },
              ],
            });
          }
          return Promise.resolve({ items: [] });
        });

        await GET();

        const [[paths]] = mockGetServerSideSitemap.mock.calls;
        const firstPost = paths.find(
          (p: any) => p.loc === 'https://test.com/blog/first-post',
        );
        const secondPost = paths.find(
          (p: any) => p.loc === 'https://test.com/blog/second-post',
        );

        expect(firstPost).toBeDefined();
        expect(secondPost).toBeDefined();
      });

      it('should use publishedAt for blog post lastmod', async () => {
        mockGetContentItems.mockImplementation(({ collection }) => {
          if (collection === 'posts') {
            return Promise.resolve({
              items: [
                {
                  slug: 'test-post',
                  publishedAt: '2024-01-15T12:00:00Z',
                },
              ],
            });
          }
          return Promise.resolve({ items: [] });
        });

        await GET();

        const [[paths]] = mockGetServerSideSitemap.mock.calls;
        const post = paths.find(
          (p: any) => p.loc === 'https://test.com/blog/test-post',
        );

        expect(post.lastmod).toBe('2024-01-15T12:00:00.000Z');
      });

      it('should use current date when publishedAt is missing', async () => {
        const beforeCall = new Date();

        mockGetContentItems.mockImplementation(({ collection }) => {
          if (collection === 'posts') {
            return Promise.resolve({
              items: [
                {
                  slug: 'unpublished-post',
                  publishedAt: null,
                },
              ],
            });
          }
          return Promise.resolve({ items: [] });
        });

        await GET();

        const afterCall = new Date();
        const [[paths]] = mockGetServerSideSitemap.mock.calls;
        const post = paths.find(
          (p: any) => p.loc === 'https://test.com/blog/unpublished-post',
        );

        const lastmodDate = new Date(post.lastmod);
        expect(lastmodDate.getTime()).toBeGreaterThanOrEqual(
          beforeCall.getTime(),
        );
        expect(lastmodDate.getTime()).toBeLessThanOrEqual(afterCall.getTime());
      });
    });

    describe('documentation integration', () => {
      it('should fetch documentation from CMS', async () => {
        mockGetContentItems.mockResolvedValue({ items: [] });

        await GET();

        expect(mockGetContentItems).toHaveBeenCalledWith({
          collection: 'documentation',
          content: false,
          limit: Infinity,
        });
      });

      it('should include documentation pages in sitemap', async () => {
        mockGetContentItems.mockImplementation(({ collection }) => {
          if (collection === 'documentation') {
            return Promise.resolve({
              items: [
                {
                  slug: 'getting-started',
                  publishedAt: '2024-01-01T00:00:00Z',
                },
                {
                  slug: 'api-reference',
                  publishedAt: '2024-01-02T00:00:00Z',
                },
              ],
            });
          }
          return Promise.resolve({ items: [] });
        });

        await GET();

        const [[paths]] = mockGetServerSideSitemap.mock.calls;
        const gettingStarted = paths.find(
          (p: any) => p.loc === 'https://test.com/docs/getting-started',
        );
        const apiRef = paths.find(
          (p: any) => p.loc === 'https://test.com/docs/api-reference',
        );

        expect(gettingStarted).toBeDefined();
        expect(apiRef).toBeDefined();
      });

      it('should use publishedAt for documentation lastmod', async () => {
        mockGetContentItems.mockImplementation(({ collection }) => {
          if (collection === 'documentation') {
            return Promise.resolve({
              items: [
                {
                  slug: 'test-doc',
                  publishedAt: '2024-02-20T10:30:00Z',
                },
              ],
            });
          }
          return Promise.resolve({ items: [] });
        });

        await GET();

        const [[paths]] = mockGetServerSideSitemap.mock.calls;
        const doc = paths.find(
          (p: any) => p.loc === 'https://test.com/docs/test-doc',
        );

        expect(doc.lastmod).toBe('2024-02-20T10:30:00.000Z');
      });
    });

    describe('cache headers', () => {
      it('should set Cache-Control header with max-age', async () => {
        mockGetContentItems.mockResolvedValue({ items: [] });

        await GET();

        const [, headers] = mockGetServerSideSitemap.mock.calls[0];

        expect(headers['Cache-Control']).toContain('max-age=60');
      });

      it('should set Cache-Control header with s-maxage', async () => {
        mockGetContentItems.mockResolvedValue({ items: [] });

        await GET();

        const [, headers] = mockGetServerSideSitemap.mock.calls[0];

        expect(headers['Cache-Control']).toContain('s-maxage=3600');
      });

      it('should set Cache-Control header as public', async () => {
        mockGetContentItems.mockResolvedValue({ items: [] });

        await GET();

        const [, headers] = mockGetServerSideSitemap.mock.calls[0];

        expect(headers['Cache-Control']).toContain('public');
      });

      it('should have complete Cache-Control header', async () => {
        mockGetContentItems.mockResolvedValue({ items: [] });

        await GET();

        const [, headers] = mockGetServerSideSitemap.mock.calls[0];

        expect(headers['Cache-Control']).toBe(
          'public, max-age=60, s-maxage=3600',
        );
      });
    });

    describe('integration scenarios', () => {
      it('should combine static paths, blog posts, and docs', async () => {
        mockGetContentItems.mockImplementation(({ collection }) => {
          if (collection === 'posts') {
            return Promise.resolve({
              items: [{ slug: 'blog-post', publishedAt: '2024-01-01' }],
            });
          }
          if (collection === 'documentation') {
            return Promise.resolve({
              items: [{ slug: 'doc-page', publishedAt: '2024-01-01' }],
            });
          }
          return Promise.resolve({ items: [] });
        });

        await GET();

        const [[paths]] = mockGetServerSideSitemap.mock.calls;

        expect(paths.length).toBeGreaterThanOrEqual(11); // 9 static + 1 blog + 1 doc
        expect(
          paths.find((p: any) => p.loc === 'https://test.com/'),
        ).toBeDefined();
        expect(
          paths.find((p: any) => p.loc === 'https://test.com/blog/blog-post'),
        ).toBeDefined();
        expect(
          paths.find((p: any) => p.loc === 'https://test.com/docs/doc-page'),
        ).toBeDefined();
      });

      it('should handle many content items', async () => {
        const manyPosts = Array.from({ length: 100 }, (_, i) => ({
          slug: `post-${i}`,
          publishedAt: '2024-01-01',
        }));

        mockGetContentItems.mockImplementation(({ collection }) => {
          if (collection === 'posts') {
            return Promise.resolve({ items: manyPosts });
          }
          return Promise.resolve({ items: [] });
        });

        await GET();

        const [[paths]] = mockGetServerSideSitemap.mock.calls;

        expect(paths.length).toBeGreaterThanOrEqual(109); // 9 static + 100 posts
      });

      it('should handle CMS client errors gracefully', async () => {
        mockGetContentItems.mockRejectedValue(new Error('CMS error'));

        await expect(GET()).rejects.toThrow('CMS error');
      });

      it('should call getServerSideSitemap with flattened array', async () => {
        mockGetContentItems.mockResolvedValue({ items: [] });

        await GET();

        const [[paths]] = mockGetServerSideSitemap.mock.calls;

        expect(Array.isArray(paths)).toBe(true);
        expect(paths.every((item: any) => item.loc && item.lastmod)).toBe(true);
      });
    });

    describe('URL generation', () => {
      it('should generate proper URLs with base URL', async () => {
        mockGetContentItems.mockResolvedValue({ items: [] });

        await GET();

        const [[paths]] = mockGetServerSideSitemap.mock.calls;

        paths.forEach((path: any) => {
          expect(path.loc).toMatch(/^https:\/\/test\.com/);
        });
      });

      it('should handle slugs with special characters', async () => {
        mockGetContentItems.mockImplementation(({ collection }) => {
          if (collection === 'posts') {
            return Promise.resolve({
              items: [
                {
                  slug: 'post-with-dashes',
                  publishedAt: '2024-01-01',
                },
              ],
            });
          }
          return Promise.resolve({ items: [] });
        });

        await GET();

        const [[paths]] = mockGetServerSideSitemap.mock.calls;
        const post = paths.find(
          (p: any) => p.loc === 'https://test.com/blog/post-with-dashes',
        );

        expect(post).toBeDefined();
      });
    });

    describe('edge cases', () => {
      it('should handle empty CMS results', async () => {
        mockGetContentItems.mockResolvedValue({ items: [] });

        await GET();

        const [[paths]] = mockGetServerSideSitemap.mock.calls;

        // Should still have static paths
        expect(paths.length).toBe(9);
      });

      it('should handle CMS returning null items', async () => {
        mockGetContentItems.mockResolvedValue({ items: null });

        await expect(GET()).rejects.toThrow();
      });

      it('should handle concurrent CMS requests', async () => {
        let callCount = 0;
        mockGetContentItems.mockImplementation(() => {
          callCount++;
          return new Promise((resolve) =>
            setTimeout(() => resolve({ items: [] }), 10),
          );
        });

        await GET();

        expect(callCount).toBe(2); // posts and documentation
      });
    });
  });
});
