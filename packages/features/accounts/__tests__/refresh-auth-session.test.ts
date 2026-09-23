import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * KB-58: `refreshAuthSession` became an `enhanceAction` with `auth: false`.
 * It runs straight after an MFA code is verified, while the cookie can still
 * be aal1, so it must not call `requireUser` (which would redirect to
 * /auth/verify) — and it must still refresh the session.
 */

const refreshSession = vi.fn(() => Promise.resolve({ error: null }));
// What an aal1 cookie gets from requireUser: no user, and a redirect to MFA.
const requireUser = vi.fn(() =>
  Promise.resolve({ data: null, error: new Error('aal1'), redirectTo: '/auth/verify' }),
);

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({ auth: { refreshSession } }),
}));
vi.mock('@kit/supabase/require-user', () => ({ requireUser }));
vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: vi.fn(),
}));
vi.mock('@kit/auth/captcha/server', () => ({ verifyCaptchaToken: vi.fn() }));
vi.mock('@kit/audit-logs/server', () => ({
  createAuditLog: vi.fn(),
  extractNetworkContext: vi.fn(),
}));
vi.mock('@kit/otp', () => ({ createOtpApi: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  }),
}));

describe('refreshAuthSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it("refreshes the caller's session without requiring an aal2 user", async () => {
    const { refreshAuthSession } = await import(
      '../src/server/personal-accounts-server-actions'
    );

    await expect(refreshAuthSession()).resolves.toEqual({});

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(requireUser).not.toHaveBeenCalled();
  });
});
