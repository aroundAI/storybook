/*
 * -------------------------------------------------------
 * Section: Enums
 * We create the enums for the schema
 * -------------------------------------------------------
 */

/*
* Permissions
- We create the permissions for the Supabase MakerKit. These permissions are used to manage the permissions for the roles
- The permissions are 'roles.manage', 'billing.manage', 'settings.manage', 'members.manage', and 'invites.manage'.
- You can add more permissions as needed.
*/
create type public.app_permissions as enum(
  'roles.manage',
  'billing.manage',
  'settings.manage',
  'members.manage',
  'invites.manage'
);

/*
* Subscription Status
- We create the subscription status for the Supabase MakerKit. These statuses are used to manage the status of the subscriptions
- The statuses are 'active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', and 'paused'.
- You can add more statuses as needed.
*/
create type public.subscription_status as ENUM(
  'active',
  'trialing',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused'
);

/*
Payment Status
- We create the payment status for the Supabase MakerKit. These statuses are used to manage the status of the payments
*/
create type public.payment_status as ENUM('pending', 'succeeded', 'failed');

/*
* Billing Provider
- We create the billing provider for the Supabase MakerKit. These providers are used to manage the billing provider for the accounts
- The providers are 'stripe', 'lemon-squeezy', and 'paddle'.
- You can add more providers as needed.
*/
create type public.billing_provider as ENUM('stripe', 'lemon-squeezy', 'paddle');

/*
* Subscription Item Type
- We create the subscription item type for the Supabase MakerKit. These types are used to manage the type of the subscription items
- The types are 'flat', 'per_seat', and 'metered'.
- You can add more types as needed.
*/
create type public.subscription_item_type as ENUM('flat', 'per_seat', 'metered');

/*
* Invitation Type
- We create the invitation type for the Supabase MakerKit. These types are used to manage the type of the invitation
*/
create type public.invitation as (email text, role varchar(50));