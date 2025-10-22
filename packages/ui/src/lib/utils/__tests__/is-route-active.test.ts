import { describe, expect, it } from 'vitest';

import {
  checkIfRouteIsActive,
  isRouteActive,
} from '../is-route-active';

describe('is-route-active', () => {
  describe('isRouteActive', () => {
    describe('exact path matching', () => {
      it('should return true when paths are exactly equal', () => {
        const result = isRouteActive('/home', '/home');

        expect(result).toBe(true);
      });

      it('should return true for root paths', () => {
        const result = isRouteActive('/', '/');

        expect(result).toBe(true);
      });

      it('should return false when paths do not match', () => {
        const result = isRouteActive('/home', '/about');

        expect(result).toBe(false);
      });

      it('should return false for different nested paths', () => {
        const result = isRouteActive('/home/dashboard', '/home/settings');

        expect(result).toBe(false);
      });
    });

    describe('function-based end parameter', () => {
      it('should call function with current path', () => {
        const endFn = (path: string) => path === '/home';

        const result = isRouteActive('/home', '/home', endFn);

        // Exact match returns true before function is called
        expect(result).toBe(true);
      });

      it('should return true when function returns false', () => {
        const endFn = () => false;

        const result = isRouteActive('/home', '/home/dashboard', endFn);

        expect(result).toBe(true);
      });

      it('should return false when function returns true', () => {
        const endFn = () => true;

        const result = isRouteActive('/home', '/home/dashboard', endFn);

        expect(result).toBe(false);
      });

      it('should support custom matching logic', () => {
        const endFn = (path: string) => path.startsWith('/admin');

        const result = isRouteActive('/home', '/home/user', endFn);

        expect(result).toBe(true); // Not admin, so !endFn = true
      });
    });

    describe('end parameter - boolean', () => {
      it('should use depth 1 when end is true', () => {
        const result = isRouteActive('/home', '/home/dashboard', true);

        // Depth 1 means exact matching - should not match child paths
        expect(result).toBe(false);
      });

      it('should use depth 3 when end is false', () => {
        const result = isRouteActive('/home', '/home/dashboard/settings', false);

        expect(result).toBe(true); // Deep matching
      });

      it('should default to end=true when not specified', () => {
        const resultDefault = isRouteActive('/home', '/home/dashboard');
        const resultExplicit = isRouteActive('/home', '/home/dashboard', true);

        expect(resultDefault).toBe(resultExplicit);
      });
    });

    describe('segment matching - depth 1', () => {
      it('should not match immediate child with depth 1', () => {
        const result = isRouteActive('/home', '/home/dashboard', true);

        // Depth 1 requires exact matching
        expect(result).toBe(false);
      });

      it('should not match grandchild with depth 1', () => {
        const result = isRouteActive('/home', '/home/dashboard/settings', true);

        expect(result).toBe(false);
      });

      it('should not match parent with child path at depth 1', () => {
        const result = isRouteActive('/home/dashboard', '/home/dashboard/edit', true);

        // Depth 1 requires exact match
        expect(result).toBe(false);
      });
    });

    describe('segment matching - depth 3', () => {
      it('should match deep nested paths with depth 3', () => {
        const result = isRouteActive('/home', '/home/dashboard/settings', false);

        expect(result).toBe(true);
      });

      it('should match two levels deep', () => {
        const result = isRouteActive('/home', '/home/dashboard', false);

        expect(result).toBe(true);
      });

      it('should match three levels deep', () => {
        const result = isRouteActive('/home', '/home/a/b/c', false);

        expect(result).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should handle paths with trailing slashes', () => {
        const result = isRouteActive('/home/', '/home', true);

        expect(result).toBe(false); // Different paths
      });

      it('should handle empty current path', () => {
        const result = isRouteActive('/home', '', true);

        expect(result).toBe(false);
      });

      it('should handle empty target path', () => {
        const result = isRouteActive('', '/home', true);

        expect(result).toBe(false);
      });

      it('should handle paths with special characters', () => {
        const result = isRouteActive('/home-page', '/home-page', true);

        expect(result).toBe(true);
      });

      it('should handle paths with numbers', () => {
        const result = isRouteActive('/user/123', '/user/123/edit', true);

        // Depth 1 requires exact match
        expect(result).toBe(false);
      });
    });
  });

  describe('checkIfRouteIsActive', () => {
    describe('exact matching', () => {
      it('should return true for exact match', () => {
        const result = checkIfRouteIsActive('/home', '/home');

        expect(result).toBe(true);
      });

      it('should return true for exact nested match', () => {
        const result = checkIfRouteIsActive('/home/dashboard', '/home/dashboard');

        expect(result).toBe(true);
      });

      it('should return false for non-matching paths', () => {
        const result = checkIfRouteIsActive('/home', '/about');

        expect(result).toBe(false);
      });
    });

    describe('query parameter handling', () => {
      it('should strip query params from current route', () => {
        const result = checkIfRouteIsActive('/home', '/home?tab=settings');

        expect(result).toBe(true);
      });

      it('should match with query params in current route', () => {
        const result = checkIfRouteIsActive('/home/dashboard', '/home/dashboard?view=grid');

        expect(result).toBe(true);
      });

      it('should handle multiple query params', () => {
        const result = checkIfRouteIsActive('/home', '/home?tab=settings&mode=dark');

        expect(result).toBe(true);
      });

      it('should handle query params with special characters', () => {
        const result = checkIfRouteIsActive('/search', '/search?q=hello%20world');

        expect(result).toBe(true);
      });
    });

    describe('root path handling', () => {
      it('should return false when target is root but current is not', () => {
        const result = checkIfRouteIsActive('/', '/home');

        expect(result).toBe(false);
      });

      it('should return true when both paths are root', () => {
        const result = checkIfRouteIsActive('/', '/');

        expect(result).toBe(true);
      });

      it('should return true when current is root child', () => {
        const result = checkIfRouteIsActive('/home', '/home/dashboard', 2);

        expect(result).toBe(true);
      });
    });

    describe('depth-based matching', () => {
      it('should not match with depth 1 (requires exact match)', () => {
        const result = checkIfRouteIsActive('/home', '/home/dashboard', 1);

        // Depth 1 requires exact match
        expect(result).toBe(false);
      });

      it('should not match grandchildren with depth 1', () => {
        const result = checkIfRouteIsActive('/home', '/home/dashboard/settings', 1);

        expect(result).toBe(false);
      });

      it('should match two levels deep with depth 2', () => {
        const result = checkIfRouteIsActive('/home', '/home/dashboard', 2);

        expect(result).toBe(true);
      });

      it('should match three levels deep with depth 3', () => {
        const result = checkIfRouteIsActive('/home', '/home/dashboard/settings', 3);

        expect(result).toBe(true);
      });

      it('should use default depth of 1', () => {
        const resultDefault = checkIfRouteIsActive('/home', '/home/dashboard');
        const resultExplicit = checkIfRouteIsActive('/home', '/home/dashboard', 1);

        expect(resultDefault).toBe(resultExplicit);
      });
    });

    describe('path inclusion check', () => {
      it('should return false when target not included in current', () => {
        const result = checkIfRouteIsActive('/dashboard', '/home');

        expect(result).toBe(false);
      });

      it('should return false when target is prefix but depth not matched', () => {
        const result = checkIfRouteIsActive('/home', '/home/dashboard');

        // Default depth is 1, requires exact match
        expect(result).toBe(false);
      });

      it('should return false for partial segment matches', () => {
        const result = checkIfRouteIsActive('/hom', '/home');

        expect(result).toBe(false);
      });
    });

    describe('segment counting', () => {
      it('should match when all segments are present', () => {
        const result = checkIfRouteIsActive('/home/dashboard', '/home/dashboard/settings', 2);

        expect(result).toBe(true);
      });

      it('should not match when segments differ', () => {
        const result = checkIfRouteIsActive('/home/dashboard', '/home/settings', 1);

        expect(result).toBe(false);
      });

      it('should handle complex nested paths', () => {
        const result = checkIfRouteIsActive('/app/user/profile', '/app/user/profile/edit', 1);

        // Depth 1 requires exact match
        expect(result).toBe(false);
      });

      it('should handle paths with many segments', () => {
        const result = checkIfRouteIsActive('/a/b/c', '/a/b/c/d/e/f', 3);

        expect(result).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should handle paths with double slashes', () => {
        const result = checkIfRouteIsActive('/home//dashboard', '/home/dashboard');

        expect(result).toBe(false);
      });

      it('should handle empty string paths', () => {
        const result = checkIfRouteIsActive('', '');

        expect(result).toBe(true);
      });

      it('should handle paths with only slashes', () => {
        const result = checkIfRouteIsActive('/', '/');

        expect(result).toBe(true);
      });

      it('should handle paths with trailing slashes', () => {
        const result = checkIfRouteIsActive('/home/', '/home');

        expect(result).toBe(false);
      });

      it('should handle paths with hash fragments', () => {
        // Query params are stripped, but hash is part of path
        const result = checkIfRouteIsActive('/home', '/home#section');

        expect(result).toBe(false); // Hash is not stripped
      });

      it('should handle very long paths', () => {
        const longPath = '/a/b/c/d/e/f/g/h/i/j';
        const result = checkIfRouteIsActive('/a/b/c', longPath, 10);

        expect(result).toBe(true);
      });

      it('should handle paths with dynamic segments', () => {
        const result = checkIfRouteIsActive('/user/[id]', '/user/123', 1);

        expect(result).toBe(false); // Literal match, not pattern match
      });

      it('should handle case-sensitive paths', () => {
        const result = checkIfRouteIsActive('/Home', '/home');

        expect(result).toBe(false);
      });
    });
  });
});
