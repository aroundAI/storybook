// Import mocked functions
import { redirect } from 'next/navigation';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { verifyCaptchaToken } from '@kit/auth/captcha/server';
import { requireUser } from '@kit/supabase/require-user';
import type { JWTUserData } from '@kit/supabase/types';

import { enhanceAction } from '../src/actions';

/**
 * requireUser returns a discriminated union keyed on `error`, and its
 * success branch carries a full JWTUserData. Fixtures that supplied only
 * id/email/role were describing a user the auth layer never produces.
 */
function makeUser(overrides: Partial<JWTUserData> = {}): JWTUserData {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    email: 'user@example.com',
    phone: '',
    is_anonymous: false,
    aal: 'aal1',
    app_metadata: {},
    user_metadata: {},
    ...overrides,
  };
}

// Mock dependencies
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT;${url}`);
    (error as any).digest = `NEXT_REDIRECT;${url}`;
    throw error;
  }),
}));

vi.mock('@kit/auth/captcha/server', () => ({
  verifyCaptchaToken: vi.fn(),
}));

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: vi.fn(),
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => ({})),
}));

describe('enhanceAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Schema Validation', () => {
    it('should validate input with schema', async () => {
      const TestSchema = z.object({
        name: z.string().min(1),
        age: z.number().min(0),
      });

      const mockFn = vi.fn((data) => ({ success: true, data }));

      const action = enhanceAction(mockFn, {
        auth: false,
        schema: TestSchema,
      });

      const result = await action({ name: 'John', age: 30 });

      expect(mockFn).toHaveBeenCalledWith({ name: 'John', age: 30 }, undefined);
      expect(result).toEqual({
        success: true,
        data: { name: 'John', age: 30 },
      });
    });

    it('should reject invalid input against schema', async () => {
      const TestSchema = z.object({
        name: z.string().min(1),
        age: z.number().min(0),
      });

      const mockFn = vi.fn();

      const action = enhanceAction(mockFn, {
        auth: false,
        schema: TestSchema,
      });

      await expect(action({ name: '', age: -5 })).rejects.toThrow();
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('should work without schema', async () => {
      const mockFn = vi.fn((data) => ({ success: true, data }));

      const action = enhanceAction(mockFn, {
        auth: false,
      });

      const input = { arbitrary: 'data' };
      const result = await action(input);

      expect(mockFn).toHaveBeenCalledWith(input, undefined);
      expect(result).toEqual({
        success: true,
        data: input,
      });
    });

    it('should handle complex nested schemas', async () => {
      const ComplexSchema = z.object({
        user: z.object({
          name: z.string(),
          email: z.string().email(),
        }),
        settings: z.object({
          theme: z.enum(['light', 'dark']),
          notifications: z.boolean(),
        }),
      });

      const mockFn = vi.fn((data) => ({ success: true, data }));

      const action = enhanceAction(mockFn, {
        auth: false,
        schema: ComplexSchema,
      });

      const input = {
        user: {
          name: 'Jane',
          email: 'jane@example.com',
        },
        settings: {
          theme: 'dark' as const,
          notifications: true,
        },
      };

      const result = await action(input);

      expect(mockFn).toHaveBeenCalledWith(input, undefined);
      expect(result.success).toBe(true);
    });
  });

  describe('Authentication', () => {
    it('should require authentication by default', async () => {
      const mockUser = makeUser({
        id: 'user-123',
        email: 'user@example.com',
      });

      vi.mocked(requireUser).mockResolvedValue({
        error: null,
        data: mockUser,
      });

      const mockFn = vi.fn((data, user) => ({ success: true, user }));

      const action = enhanceAction(mockFn, {});

      const result = await action({ test: 'data' });

      expect(requireUser).toHaveBeenCalled();
      expect(mockFn).toHaveBeenCalledWith({ test: 'data' }, mockUser);
      expect(result.user).toEqual(mockUser);
    });

    it('should skip authentication when auth: false', async () => {
      const mockFn = vi.fn((data, user) => ({ success: true, user }));

      const action = enhanceAction(mockFn, {
        auth: false,
      });

      const result = await action({ test: 'data' });

      expect(requireUser).not.toHaveBeenCalled();
      expect(mockFn).toHaveBeenCalledWith({ test: 'data' }, undefined);
      expect(result.user).toBeUndefined();
    });

    it('should redirect when user is not authenticated', async () => {
      vi.mocked(requireUser).mockResolvedValue({
        // AuthenticationError adds nothing to Error, and the module is
        // mocked, so a plain Error satisfies the union's failure branch.
        error: new Error('Authentication required'),
        data: null,
        redirectTo: '/auth/sign-in',
      });

      const mockFn = vi.fn();

      const action = enhanceAction(mockFn, {
        auth: true,
      });

      await expect(action({ test: 'data' })).rejects.toThrow('NEXT_REDIRECT');

      expect(redirect).toHaveBeenCalledWith('/auth/sign-in');
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('should inject user data when authenticated', async () => {
      const mockUser = makeUser({
        id: 'user-456',
        email: 'authenticated@example.com',
      });

      vi.mocked(requireUser).mockResolvedValue({
        error: null,
        data: mockUser,
      });

      const mockFn = vi.fn((data, user) => ({
        userId: user.id,
        userEmail: user.email,
      }));

      const action = enhanceAction(mockFn, {
        auth: true,
      });

      const result = await action({ test: 'data' });

      expect(result).toEqual({
        userId: 'user-456',
        userEmail: 'authenticated@example.com',
      });
    });
  });

  describe('CAPTCHA Verification', () => {
    it('should verify captcha when enabled', async () => {
      const TestSchema = z.object({
        name: z.string(),
        captchaToken: z.string(),
      });

      vi.mocked(verifyCaptchaToken).mockResolvedValue(undefined);

      const mockFn = vi.fn((data) => ({ success: true }));

      const action = enhanceAction(mockFn, {
        auth: false,
        captcha: true,
        schema: TestSchema,
      });

      const result = await action({
        name: 'Test',
        captchaToken: 'valid-token',
      });

      expect(verifyCaptchaToken).toHaveBeenCalledWith('valid-token');
      expect(result.success).toBe(true);
    });

    it('should reject invalid captcha token', async () => {
      const TestSchema = z.object({
        name: z.string(),
        captchaToken: z.string(),
      });

      vi.mocked(verifyCaptchaToken).mockRejectedValue(
        new Error('Invalid captcha token'),
      );

      const mockFn = vi.fn();

      const action = enhanceAction(mockFn, {
        auth: false,
        captcha: true,
        schema: TestSchema,
      });

      await expect(
        action({
          name: 'Test',
          captchaToken: 'invalid-token',
        }),
      ).rejects.toThrow('Invalid captcha token');

      expect(mockFn).not.toHaveBeenCalled();
    });

    it('should skip captcha verification by default', async () => {
      const mockFn = vi.fn(() => ({ success: true }));

      const action = enhanceAction(mockFn, {
        auth: false,
      });

      await action({ name: 'Test' });

      expect(verifyCaptchaToken).not.toHaveBeenCalled();
    });

    it('should skip captcha verification when explicitly false', async () => {
      const mockFn = vi.fn(() => ({ success: true }));

      const action = enhanceAction(mockFn, {
        auth: false,
        captcha: false,
      });

      await action({ name: 'Test' });

      expect(verifyCaptchaToken).not.toHaveBeenCalled();
    });
  });

  describe('Combined Features', () => {
    it('should handle schema validation + authentication', async () => {
      const TestSchema = z.object({
        title: z.string().min(1),
        content: z.string(),
      });

      const mockUser = makeUser({
        id: 'user-789',
        email: 'combo@example.com',
      });

      vi.mocked(requireUser).mockResolvedValue({
        error: null,
        data: mockUser,
      });

      const mockFn = vi.fn((data, user) => ({
        ...data,
        createdBy: user.id,
      }));

      const action = enhanceAction(mockFn, {
        auth: true,
        schema: TestSchema,
      });

      const result = await action({
        title: 'Test Post',
        content: 'Content here',
      });

      expect(requireUser).toHaveBeenCalled();
      expect(result).toEqual({
        title: 'Test Post',
        content: 'Content here',
        createdBy: 'user-789',
      });
    });

    it('should handle schema validation + captcha + authentication', async () => {
      const TestSchema = z.object({
        email: z.string().email(),
        password: z.string().min(8),
        captchaToken: z.string(),
      });

      const mockUser = makeUser({
        id: 'user-999',
        email: 'fullstack@example.com',
      });

      vi.mocked(verifyCaptchaToken).mockResolvedValue(undefined);
      vi.mocked(requireUser).mockResolvedValue({
        error: null,
        data: mockUser,
      });

      const mockFn = vi.fn((data, user) => ({
        success: true,
        userId: user.id,
      }));

      const action = enhanceAction(mockFn, {
        auth: true,
        captcha: true,
        schema: TestSchema,
      });

      const result = await action({
        email: 'test@example.com',
        password: 'SecurePass123',
        captchaToken: 'valid-captcha',
      });

      expect(verifyCaptchaToken).toHaveBeenCalledWith('valid-captcha');
      expect(requireUser).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        userId: 'user-999',
      });
    });
  });

  describe('Error Handling', () => {
    it('should propagate function errors', async () => {
      const mockFn = vi.fn(() => {
        throw new Error('Function failed');
      });

      const action = enhanceAction(mockFn, {
        auth: false,
      });

      await expect(action({ test: 'data' })).rejects.toThrow('Function failed');
    });

    it('should propagate async function errors', async () => {
      const mockFn = vi.fn(async () => {
        await Promise.resolve();
        throw new Error('Async function failed');
      });

      const action = enhanceAction(mockFn, {
        auth: false,
      });

      await expect(action({ test: 'data' })).rejects.toThrow(
        'Async function failed',
      );
    });

    it('should handle schema validation errors', async () => {
      const StrictSchema = z.object({
        requiredField: z.string().min(5),
        numberField: z.number().positive(),
      });

      const mockFn = vi.fn();

      const action = enhanceAction(mockFn, {
        auth: false,
        schema: StrictSchema,
      });

      // Invalid data
      await expect(
        action({
          requiredField: 'abc', // Too short
          numberField: -1, // Not positive
        }),
      ).rejects.toThrow();

      expect(mockFn).not.toHaveBeenCalled();
    });
  });

  describe('Type Safety', () => {
    it('should maintain type safety with schema', async () => {
      const TypedSchema = z.object({
        id: z.string().uuid(),
        count: z.number().int(),
        active: z.boolean(),
      });

      const mockFn = vi.fn((data, user) => {
        // TypeScript should infer correct types here
        const id: string = data.id;
        const count: number = data.count;
        const active: boolean = data.active;

        return { id, count, active };
      });

      const action = enhanceAction(mockFn, {
        auth: false,
        schema: TypedSchema,
      });

      const result = await action({
        id: '123e4567-e89b-12d3-a456-426614174000',
        count: 42,
        active: true,
      });

      expect(result).toEqual({
        id: '123e4567-e89b-12d3-a456-426614174000',
        count: 42,
        active: true,
      });
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle create account action', async () => {
      const CreateAccountSchema = z.object({
        name: z.string().min(1).max(100),
        slug: z.string().min(3).max(50),
        description: z.string().optional(),
      });

      const mockUser = makeUser({
        id: 'user-123',
        email: 'owner@example.com',
      });

      vi.mocked(requireUser).mockResolvedValue({
        error: null,
        data: mockUser,
      });

      const mockFn = vi.fn((data, user) => ({
        success: true,
        account: {
          ...data,
          ownerId: user.id,
          createdAt: new Date().toISOString(),
        },
      }));

      const action = enhanceAction(mockFn, {
        auth: true,
        schema: CreateAccountSchema,
      });

      const result = await action({
        name: 'My Team',
        slug: 'my-team',
        description: 'Team description',
      });

      expect(result.success).toBe(true);
      expect(result.account.ownerId).toBe('user-123');
      expect(result.account.name).toBe('My Team');
    });

    it('should handle contact form submission with captcha', async () => {
      const ContactSchema = z.object({
        name: z.string().min(1),
        email: z.string().email(),
        message: z.string().min(10),
        captchaToken: z.string(),
      });

      vi.mocked(verifyCaptchaToken).mockResolvedValue(undefined);

      const mockFn = vi.fn((data) => ({
        success: true,
        messageId: 'msg-123',
      }));

      const action = enhanceAction(mockFn, {
        auth: false, // Public form
        captcha: true,
        schema: ContactSchema,
      });

      const result = await action({
        name: 'John Doe',
        email: 'john@example.com',
        message: 'This is a test message for support',
        captchaToken: 'valid-token',
      });

      expect(verifyCaptchaToken).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-123');
    });

    it('should handle update user settings', async () => {
      const UpdateSettingsSchema = z.object({
        theme: z.enum(['light', 'dark', 'system']),
        language: z.string().length(2),
        notifications: z.boolean(),
      });

      const mockUser = makeUser({
        id: 'user-456',
        email: 'user@example.com',
      });

      vi.mocked(requireUser).mockResolvedValue({
        error: null,
        data: mockUser,
      });

      const mockFn = vi.fn((data, user) => ({
        success: true,
        settings: {
          ...data,
          userId: user.id,
          updatedAt: new Date().toISOString(),
        },
      }));

      const action = enhanceAction(mockFn, {
        auth: true,
        schema: UpdateSettingsSchema,
      });

      const result = await action({
        theme: 'dark',
        language: 'en',
        notifications: true,
      });

      expect(result.success).toBe(true);
      expect(result.settings.theme).toBe('dark');
      expect(result.settings.userId).toBe('user-456');
    });
  });
});
