import { NextRequest, NextResponse } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { enhanceRouteHandler } from '../src/routes';

// Mock dependencies
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT;${url}`);
    (error as any).digest = `NEXT_REDIRECT;${url}`;
    throw error;
  }),
}));

vi.mock('@kit/auth/captcha/server', () => ({
  verifyCaptchaToken: vi.fn().mockResolvedValue(true),
}));

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: vi.fn().mockResolvedValue({
    data: { id: 'user-123', email: 'test@example.com' },
    error: null,
  }),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(),
}));

describe('enhanceRouteHandler', () => {
  const createMockRequest = (
    options: {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    } = {},
  ) => {
    const url = options.url || 'http://localhost:3000/api/test';
    const method = options.method || 'GET';
    const headers = new Headers(options.headers || {});

    const request = {
      url,
      method,
      headers,
      clone: vi.fn(() => ({
        json: vi.fn().mockResolvedValue(options.body || {}),
      })),
      json: vi.fn().mockResolvedValue(options.body || {}),
    } as unknown as NextRequest;

    return request;
  };

  const createRouteParams = (params: Record<string, string> = {}) => ({
    params: Promise.resolve(params),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Functionality', () => {
    it('should handle simple GET request', async () => {
      const handler = vi.fn(({ request }) => {
        return NextResponse.json({ success: true });
      });

      const routeHandler = enhanceRouteHandler(handler, { auth: false });
      const request = createMockRequest();
      const routeParams = createRouteParams();

      await routeHandler(request, routeParams);

      expect(handler).toHaveBeenCalledWith({
        request,
        body: undefined,
        user: undefined,
        params: {},
      });
    });

    it('should pass route params to handler', async () => {
      const handler = vi.fn(({ params }) => {
        return NextResponse.json({ id: params.id });
      });

      const routeHandler = enhanceRouteHandler(handler, { auth: false });
      const request = createMockRequest();
      const routeParams = createRouteParams({ id: '123', slug: 'test' });

      await routeHandler(request, routeParams);

      expect(handler).toHaveBeenCalledWith({
        request,
        body: undefined,
        user: undefined,
        params: { id: '123', slug: 'test' },
      });
    });
  });

  describe('Schema Validation', () => {
    it('should validate request body against schema', async () => {
      const TestSchema = z.object({
        name: z.string().min(1),
        age: z.number().min(0),
      });

      const handler = vi.fn(({ body }) => {
        return NextResponse.json({ received: body });
      });

      const routeHandler = enhanceRouteHandler(handler, {
        auth: false,
        schema: TestSchema,
      });

      const request = createMockRequest({
        method: 'POST',
        body: { name: 'John', age: 30 },
      });
      const routeParams = createRouteParams();

      await routeHandler(request, routeParams);

      expect(handler).toHaveBeenCalledWith({
        request,
        body: { name: 'John', age: 30 },
        user: undefined,
        params: {},
      });
    });

    it('should reject invalid body against schema', async () => {
      const TestSchema = z.object({
        name: z.string().min(1),
        age: z.number().min(0),
      });

      const handler = vi.fn(() => NextResponse.json({ success: true }));

      const routeHandler = enhanceRouteHandler(handler, {
        auth: false,
        schema: TestSchema,
      });

      const request = createMockRequest({
        method: 'POST',
        body: { name: '', age: -1 },
      });
      const routeParams = createRouteParams();

      await expect(routeHandler(request, routeParams)).rejects.toThrow();
      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle empty body with schema', async () => {
      const TestSchema = z.object({
        name: z.string().min(1),
      });

      const handler = vi.fn(() => NextResponse.json({ success: true }));

      const routeHandler = enhanceRouteHandler(handler, {
        auth: false,
        schema: TestSchema,
      });

      const request = createMockRequest({
        method: 'POST',
        body: {},
      });
      const routeParams = createRouteParams();

      await expect(routeHandler(request, routeParams)).rejects.toThrow();
      expect(handler).not.toHaveBeenCalled();
    });

    it('should work without schema', async () => {
      const handler = vi.fn(() => NextResponse.json({ success: true }));

      const routeHandler = enhanceRouteHandler(handler, { auth: false });

      const request = createMockRequest({
        method: 'POST',
        body: { anything: 'goes' },
      });
      const routeParams = createRouteParams();

      await routeHandler(request, routeParams);

      expect(handler).toHaveBeenCalledWith({
        request,
        body: undefined,
        user: undefined,
        params: {},
      });
    });
  });

  describe('Authentication', () => {
    it('should require authentication by default', async () => {
      const handler = vi.fn(({ user }) => {
        return NextResponse.json({ userId: user.id });
      });

      const routeHandler = enhanceRouteHandler(handler);

      const request = createMockRequest();
      const routeParams = createRouteParams();

      await routeHandler(request, routeParams);

      const { requireUser } = await import('@kit/supabase/require-user');
      expect(requireUser).toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          user: { id: 'user-123', email: 'test@example.com' },
        }),
      );
    });

    it('should skip authentication when auth: false', async () => {
      const handler = vi.fn(() => NextResponse.json({ success: true }));

      const routeHandler = enhanceRouteHandler(handler, { auth: false });

      const request = createMockRequest();
      const routeParams = createRouteParams();

      await routeHandler(request, routeParams);

      const { requireUser } = await import('@kit/supabase/require-user');
      expect(requireUser).not.toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          user: undefined,
        }),
      );
    });

    it('should redirect when user is not authenticated', async () => {
      const { requireUser } = await import('@kit/supabase/require-user');
      const { redirect } = await import('next/navigation');

      (requireUser as any).mockResolvedValueOnce({
        data: null,
        error: true,
        redirectTo: '/auth/sign-in',
      });

      const handler = vi.fn(() => NextResponse.json({ success: true }));

      const routeHandler = enhanceRouteHandler(handler);

      const request = createMockRequest();
      const routeParams = createRouteParams();

      await expect(routeHandler(request, routeParams)).rejects.toThrow(
        'NEXT_REDIRECT',
      );
      expect(redirect).toHaveBeenCalledWith('/auth/sign-in');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should pass authenticated user to handler', async () => {
      const mockUser = {
        id: 'user-456',
        email: 'authenticated@example.com',
        role: 'admin',
      };

      const { requireUser } = await import('@kit/supabase/require-user');
      (requireUser as any).mockResolvedValueOnce({
        data: mockUser,
        error: null,
      });

      const handler = vi.fn(({ user }) => {
        return NextResponse.json({ user });
      });

      const routeHandler = enhanceRouteHandler(handler);

      const request = createMockRequest();
      const routeParams = createRouteParams();

      await routeHandler(request, routeParams);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          user: mockUser,
        }),
      );
    });
  });

  describe('CAPTCHA Verification', () => {
    it('should not verify captcha by default', async () => {
      const handler = vi.fn(() => NextResponse.json({ success: true }));

      const routeHandler = enhanceRouteHandler(handler, { auth: false });

      const request = createMockRequest();
      const routeParams = createRouteParams();

      await routeHandler(request, routeParams);

      const { verifyCaptchaToken } = await import('@kit/auth/captcha/server');
      expect(verifyCaptchaToken).not.toHaveBeenCalled();
    });

    it('should verify captcha when captcha: true', async () => {
      const handler = vi.fn(() => NextResponse.json({ success: true }));

      const routeHandler = enhanceRouteHandler(handler, {
        auth: false,
        captcha: true,
      });

      const request = createMockRequest({
        headers: {
          'x-captcha-token': 'test-captcha-token',
        },
      });
      const routeParams = createRouteParams();

      await routeHandler(request, routeParams);

      const { verifyCaptchaToken } = await import('@kit/auth/captcha/server');
      expect(verifyCaptchaToken).toHaveBeenCalledWith('test-captcha-token');
      expect(handler).toHaveBeenCalled();
    });

    it('should return 400 when captcha token is missing', async () => {
      const handler = vi.fn(() => NextResponse.json({ success: true }));

      const routeHandler = enhanceRouteHandler(handler, {
        auth: false,
        captcha: true,
      });

      const request = createMockRequest();
      const routeParams = createRouteParams();

      const response = await routeHandler(request, routeParams);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toBe('Captcha token is required');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should reject invalid captcha token', async () => {
      const { verifyCaptchaToken } = await import('@kit/auth/captcha/server');
      (verifyCaptchaToken as any).mockRejectedValueOnce(
        new Error('Invalid captcha'),
      );

      const handler = vi.fn(() => NextResponse.json({ success: true }));

      const routeHandler = enhanceRouteHandler(handler, {
        auth: false,
        captcha: true,
      });

      const request = createMockRequest({
        headers: {
          'x-captcha-token': 'invalid-token',
        },
      });
      const routeParams = createRouteParams();

      await expect(routeHandler(request, routeParams)).rejects.toThrow(
        'Invalid captcha',
      );
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Combined Options', () => {
    it('should handle auth + schema', async () => {
      const TestSchema = z.object({
        title: z.string().min(1),
        content: z.string(),
      });

      const handler = vi.fn(({ body, user }) => {
        return NextResponse.json({
          title: body.title,
          userId: user.id,
        });
      });

      const routeHandler = enhanceRouteHandler(handler, {
        auth: true,
        schema: TestSchema,
      });

      const request = createMockRequest({
        method: 'POST',
        body: { title: 'Test', content: 'Content here' },
      });
      const routeParams = createRouteParams();

      await routeHandler(request, routeParams);

      expect(handler).toHaveBeenCalledWith({
        request,
        body: { title: 'Test', content: 'Content here' },
        user: { id: 'user-123', email: 'test@example.com' },
        params: {},
      });
    });

    it('should handle auth + captcha + schema', async () => {
      const TestSchema = z.object({
        message: z.string().min(1),
      });

      const handler = vi.fn(({ body, user }) => {
        return NextResponse.json({
          message: body.message,
          from: user.email,
        });
      });

      const routeHandler = enhanceRouteHandler(handler, {
        auth: true,
        captcha: true,
        schema: TestSchema,
      });

      const request = createMockRequest({
        method: 'POST',
        headers: {
          'x-captcha-token': 'valid-token',
        },
        body: { message: 'Hello world' },
      });
      const routeParams = createRouteParams();

      await routeHandler(request, routeParams);

      const { verifyCaptchaToken } = await import('@kit/auth/captcha/server');
      const { requireUser } = await import('@kit/supabase/require-user');

      expect(verifyCaptchaToken).toHaveBeenCalledWith('valid-token');
      expect(requireUser).toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith({
        request,
        body: { message: 'Hello world' },
        user: { id: 'user-123', email: 'test@example.com' },
        params: {},
      });
    });

    it('should handle captcha + schema without auth', async () => {
      const TestSchema = z.object({
        email: z.string().email(),
      });

      const handler = vi.fn(({ body }) => {
        return NextResponse.json({ email: body.email });
      });

      const routeHandler = enhanceRouteHandler(handler, {
        auth: false,
        captcha: true,
        schema: TestSchema,
      });

      const request = createMockRequest({
        method: 'POST',
        headers: {
          'x-captcha-token': 'test-token',
        },
        body: { email: 'test@example.com' },
      });
      const routeParams = createRouteParams();

      await routeHandler(request, routeParams);

      const { verifyCaptchaToken } = await import('@kit/auth/captcha/server');
      const { requireUser } = await import('@kit/supabase/require-user');

      expect(verifyCaptchaToken).toHaveBeenCalledWith('test-token');
      expect(requireUser).not.toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith({
        request,
        body: { email: 'test@example.com' },
        user: undefined,
        params: {},
      });
    });
  });

  describe('Response Handling', () => {
    it('should return NextResponse from handler', async () => {
      const handler = vi.fn(() => {
        return NextResponse.json({ data: 'test' });
      });

      const routeHandler = enhanceRouteHandler(handler, { auth: false });

      const request = createMockRequest();
      const routeParams = createRouteParams();

      const response = await routeHandler(request, routeParams);

      expect(response).toBeInstanceOf(NextResponse);
    });

    it('should return Response from handler', async () => {
      const handler = vi.fn(() => {
        return new Response('Plain text', { status: 200 });
      });

      const routeHandler = enhanceRouteHandler(handler, { auth: false });

      const request = createMockRequest();
      const routeParams = createRouteParams();

      const response = await routeHandler(request, routeParams);

      expect(response).toBeInstanceOf(Response);
      const text = await response.text();
      expect(text).toBe('Plain text');
    });

    it('should handle async handler', async () => {
      const handler = vi.fn(async ({ body }) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return NextResponse.json({ processed: body });
      });

      const TestSchema = z.object({ value: z.string() });

      const routeHandler = enhanceRouteHandler(handler, {
        auth: false,
        schema: TestSchema,
      });

      const request = createMockRequest({
        method: 'POST',
        body: { value: 'async-test' },
      });
      const routeParams = createRouteParams();

      const response = await routeHandler(request, routeParams);

      expect(handler).toHaveBeenCalled();
      expect(response).toBeInstanceOf(NextResponse);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing config object', async () => {
      const handler = vi.fn(() => NextResponse.json({ success: true }));

      const routeHandler = enhanceRouteHandler(handler);

      const request = createMockRequest();
      const routeParams = createRouteParams();

      await routeHandler(request, routeParams);

      expect(handler).toHaveBeenCalled();
    });

    it('should handle empty route params', async () => {
      const handler = vi.fn(({ params }) => {
        return NextResponse.json({ params });
      });

      const routeHandler = enhanceRouteHandler(handler, { auth: false });

      const request = createMockRequest();
      const routeParams = createRouteParams();

      await routeHandler(request, routeParams);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          params: {},
        }),
      );
    });

    it('should clone request before reading body', async () => {
      const TestSchema = z.object({ data: z.string() });

      const handler = vi.fn(() => NextResponse.json({ success: true }));

      const routeHandler = enhanceRouteHandler(handler, {
        auth: false,
        schema: TestSchema,
      });

      const request = createMockRequest({
        method: 'POST',
        body: { data: 'test' },
      });
      const routeParams = createRouteParams();

      await routeHandler(request, routeParams);

      expect(request.clone).toHaveBeenCalled();
    });
  });
});
