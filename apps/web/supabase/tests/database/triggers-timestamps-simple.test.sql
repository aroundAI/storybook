BEGIN;
create extension "basejump-supabase_test_helpers" version '0.0.6';

select plan(12);

--- Test the trigger_set_timestamps function on all tables
--- This test verifies that created_at and updated_at are properly set on insert

--- Create test users
select tests.create_supabase_user('trigger_test_user1', 'test1@example.com');

-- Authenticate as test user
select makerkit.authenticate_as('trigger_test_user1');

------------
--- Test accounts table timestamp triggers - INSERT
------------

INSERT INTO public.accounts (name, is_personal_account)
VALUES ('Test Account', false);

SELECT ok(
    (SELECT created_at IS NOT NULL FROM public.accounts WHERE name = 'Test Account'),
    'accounts: created_at should be set automatically on insert'
);

SELECT ok(
    (SELECT updated_at IS NOT NULL FROM public.accounts WHERE name = 'Test Account'),
    'accounts: updated_at should be set automatically on insert'
);

SELECT ok(
    (SELECT created_at = updated_at FROM public.accounts WHERE name = 'Test Account'),
    'accounts: created_at should equal updated_at on insert'
);

------------
--- Test invitations table timestamp triggers - INSERT
------------

-- Create a team account for invitation testing
INSERT INTO public.accounts (name, is_personal_account)
VALUES ('Invitation Test Team', false);

-- Test invitation insert
INSERT INTO public.invitations (email, account_id, invited_by, role, invite_token, expires_at)
VALUES (
    'invitee@example.com',
    (SELECT id FROM public.accounts WHERE name = 'Invitation Test Team'),
    tests.get_supabase_uid('trigger_test_user1'),
    'member',
    'test-token-123',
    now() + interval '7 days'
);

SELECT ok(
    (SELECT created_at IS NOT NULL FROM public.invitations WHERE email = 'invitee@example.com'),
    'invitations: created_at should be set automatically on insert'
);

SELECT ok(
    (SELECT updated_at IS NOT NULL FROM public.invitations WHERE email = 'invitee@example.com'),
    'invitations: updated_at should be set automatically on insert'
);

SELECT ok(
    (SELECT created_at = updated_at FROM public.invitations WHERE email = 'invitee@example.com'),
    'invitations: created_at should equal updated_at on insert'
);

------------
--- Test subscriptions table timestamp triggers - INSERT (service_role required)
------------

set role service_role;

-- Create billing customer first
INSERT INTO public.billing_customers (account_id, provider, customer_id, email)
VALUES (
    (SELECT id FROM public.accounts WHERE name = 'Invitation Test Team'),
    'stripe',
    'cus_test123',
    'billing@example.com'
);

-- Test subscription insert
INSERT INTO public.subscriptions (
    id, account_id, billing_customer_id, status, active, billing_provider,
    cancel_at_period_end, currency, period_starts_at, period_ends_at
)
VALUES (
    'sub_test123',
    (SELECT id FROM public.accounts WHERE name = 'Invitation Test Team'),
    (SELECT id FROM public.billing_customers WHERE customer_id = 'cus_test123'),
    'active',
    true,
    'stripe',
    false,
    'USD',
    now(),
    now() + interval '1 month'
);

SELECT ok(
    (SELECT created_at IS NOT NULL FROM public.subscriptions WHERE id = 'sub_test123'),
    'subscriptions: created_at should be set automatically on insert'
);

SELECT ok(
    (SELECT updated_at IS NOT NULL FROM public.subscriptions WHERE id = 'sub_test123'),
    'subscriptions: updated_at should be set automatically on insert'
);

SELECT ok(
    (SELECT created_at = updated_at FROM public.subscriptions WHERE id = 'sub_test123'),
    'subscriptions: created_at should equal updated_at on insert'
);

------------
--- Test subscription_items table timestamp triggers - INSERT
------------

-- Test subscription_item insert
INSERT INTO public.subscription_items (
    id, subscription_id, product_id, variant_id, type, quantity, interval, interval_count
)
VALUES (
    'si_test123',
    'sub_test123',
    'prod_test123',
    'var_test123',
    'flat',
    1,
    'month',
    1
);

SELECT ok(
    (SELECT created_at IS NOT NULL FROM public.subscription_items WHERE id = 'si_test123'),
    'subscription_items: created_at should be set automatically on insert'
);

SELECT ok(
    (SELECT updated_at IS NOT NULL FROM public.subscription_items WHERE id = 'si_test123'),
    'subscription_items: updated_at should be set automatically on insert'
);

SELECT ok(
    (SELECT created_at = updated_at FROM public.subscription_items WHERE id = 'si_test123'),
    'subscription_items: created_at should equal updated_at on insert'
);

SELECT * FROM finish();

ROLLBACK;