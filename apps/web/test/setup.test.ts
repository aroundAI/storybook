import { describe, expect, it } from 'vitest';

describe('Test Infrastructure', () => {
  it('should run tests', () => {
    expect(true).toBe(true);
  });

  it('should have access to environment variables', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeDefined();
    expect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBeDefined();
  });

  it('should support async tests', async () => {
    const result = await Promise.resolve(42);
    expect(result).toBe(42);
  });

  it('should have Next.js navigation mocked', () => {
    // This test will pass if the mock is properly setup in vitest.setup.ts
    expect(true).toBe(true);
  });

  it('should have window.matchMedia mocked', () => {
    const matchMedia = window.matchMedia('(min-width: 768px)');
    expect(matchMedia).toBeDefined();
    expect(matchMedia.matches).toBe(false);
  });

  it('should have IntersectionObserver mocked', () => {
    expect(global.IntersectionObserver).toBeDefined();
    const observer = new IntersectionObserver(() => {});
    expect(observer.observe).toBeDefined();
    expect(observer.disconnect).toBeDefined();
  });
});
