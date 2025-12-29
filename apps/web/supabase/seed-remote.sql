-- REMOTE DATABASE SEED
-- For use with remote Supabase instance (kkyeoxowawvmnretoyak.supabase.co)
-- Contains shaurya@storybook.digital as the primary user
-- Run with: psql -h db.kkyeoxowawvmnretoyak.supabase.co -U postgres -d postgres -f seed-remote.sql

-- =====================================================
-- USERS (auth.users)
-- Password for all users: testingpassword
-- =====================================================

INSERT INTO "auth"."users" (
    "instance_id", "id", "aud", "role", "email", "encrypted_password", 
    "email_confirmed_at", "invited_at", "confirmation_token", "confirmation_sent_at",
    "recovery_token", "recovery_sent_at", "email_change_token_new", "email_change",
    "email_change_sent_at", "last_sign_in_at", "raw_app_meta_data", "raw_user_meta_data",
    "is_super_admin", "created_at", "updated_at", "phone", "phone_confirmed_at",
    "phone_change", "phone_change_token", "phone_change_sent_at", "email_change_token_current",
    "email_change_confirm_status", "banned_until", "reauthentication_token",
    "reauthentication_sent_at", "is_sso_user", "deleted_at", "is_anonymous"
)
VALUES 
-- shaurya@storybook.digital (Primary User - Super Admin)
(
    '00000000-0000-0000-0000-000000000000',
    '31a03e74-1639-45b6-bfa7-77447f1a4762',
    'authenticated',
    'authenticated',
    'shaurya@storybook.digital',
    '$2a$10$NaMVRrI7NyfwP.AfAVWt6O/abulGnf9BBqwa6DqdMwXMvOCGpAnVO',
    now(),
    NULL,
    '',
    NULL,
    '',
    NULL,
    '',
    '',
    NULL,
    now(),
    '{"role": "super-admin", "provider": "email", "providers": ["email"]}',
    '{"sub": "31a03e74-1639-45b6-bfa7-77447f1a4762", "email": "shaurya@storybook.digital", "email_verified": true, "phone_verified": false}',
    NULL,
    now(),
    now(),
    NULL,
    NULL,
    '',
    '',
    NULL,
    '',
    0,
    NULL,
    '',
    NULL,
    false,
    NULL,
    false
)
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    encrypted_password = EXCLUDED.encrypted_password,
    raw_app_meta_data = EXCLUDED.raw_app_meta_data,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    email_confirmed_at = EXCLUDED.email_confirmed_at,
    updated_at = now();

-- =====================================================
-- IDENTITIES (auth.identities)
-- =====================================================

INSERT INTO "auth"."identities" (
    "provider_id", "user_id", "identity_data", "provider", 
    "last_sign_in_at", "created_at", "updated_at", "id"
)
VALUES 
(
    '31a03e74-1639-45b6-bfa7-77447f1a4762',
    '31a03e74-1639-45b6-bfa7-77447f1a4762',
    '{"sub": "31a03e74-1639-45b6-bfa7-77447f1a4762", "email": "shaurya@storybook.digital", "email_verified": true, "phone_verified": false}',
    'email',
    now(),
    now(),
    now(),
    '9bb58bad-24a4-41a8-9742-1b5b4e2d8abd'
)
ON CONFLICT (id) DO UPDATE SET
    identity_data = EXCLUDED.identity_data,
    updated_at = now();

-- =====================================================
-- ACCOUNTS (public.accounts)
-- =====================================================

-- Team account: StoryBook
INSERT INTO "public"."accounts" (
    "id", "primary_owner_user_id", "name", "slug", "email",
    "is_personal_account", "updated_at", "created_at",
    "created_by", "updated_by", "picture_url", "public_data"
)
VALUES 
(
    '5deaa894-2094-4da3-b4fd-1fada0809d1c',
    '31a03e74-1639-45b6-bfa7-77447f1a4762',
    'StoryBook',
    'storybook',
    NULL,
    false,
    now(),
    now(),
    NULL,
    NULL,
    NULL,
    '{}'
)
ON CONFLICT (id) DO UPDATE SET
    primary_owner_user_id = EXCLUDED.primary_owner_user_id,
    name = EXCLUDED.name,
    updated_at = now();

-- =====================================================
-- ROLES (public.roles) - Custom role if needed
-- =====================================================

INSERT INTO "public"."roles" ("name", "hierarchy_level")
VALUES ('custom-role', 4)
ON CONFLICT (name) DO NOTHING;

-- =====================================================
-- ACCOUNT MEMBERSHIPS (public.accounts_memberships)
-- =====================================================

INSERT INTO "public"."accounts_memberships" (
    "user_id", "account_id", "account_role", "created_at", "updated_at",
    "created_by", "updated_by"
)
VALUES 
(
    '31a03e74-1639-45b6-bfa7-77447f1a4762',
    '5deaa894-2094-4da3-b4fd-1fada0809d1c',
    'owner',
    now(),
    now(),
    NULL,
    NULL
)
ON CONFLICT (user_id, account_id) DO UPDATE SET
    account_role = EXCLUDED.account_role,
    updated_at = now();

-- =====================================================
-- DONE
-- =====================================================

SELECT 'Remote seed completed. User shaurya@storybook.digital is ready.' as result;
