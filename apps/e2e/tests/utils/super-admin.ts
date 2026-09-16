/**
 * The seeded super-admin, and where its TOTP secret comes from.
 *
 * `MFA_KEY` is the base32 secret on the `auth.mfa_factors` row that
 * `apps/web/supabase/seed.sql` attaches to `super-admin@storybook.dev`, with
 * `status = 'verified'`. It was previously copied as a literal into two spec
 * files, which is two places to update when the seed changes and no way to
 * tell they are meant to be the same value.
 *
 * Super-admin is not a claim alone: `public.is_super_admin()`
 * (`apps/web/supabase/schemas/13-mfa.sql`) returns false unless the session's
 * `aal` claim is `aal2`, and only then checks
 * `app_metadata->>'role' = 'super-admin'`. So reaching `/admin` genuinely
 * requires completing the TOTP challenge — which is why it is done once, in a
 * setup project, rather than before every test.
 */
export const SUPER_ADMIN = {
  email: 'super-admin@storybook.dev',
  password: 'testingpassword',
  mfaKey: 'NHOHJVGPO3R3LKVPRMNIYLCDMBHUM2SE',
} as const;

/** Where the setup project writes the authenticated super-admin session. */
export const SUPER_ADMIN_STORAGE_STATE = 'playwright/.auth/super-admin.json';
