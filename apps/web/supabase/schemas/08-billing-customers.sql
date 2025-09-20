/*
 * -------------------------------------------------------
 * Section: Billing Customers
 * We create the schema for the billing customers. Billing customers are the customers for an account in the billing provider. For example, a user might have a customer in the billing provider with the customer ID 'cus_123'.
 * -------------------------------------------------------

 */
-- Billing Customers table
create table
  public.billing_customers (
    account_id uuid references public.accounts (id) on delete cascade not null,
    id serial primary key,
    email text,
    provider public.billing_provider not null,
    customer_id text not null,
    unique (account_id, customer_id, provider)
  );

comment on table public.billing_customers is 'The billing customers for an account';

comment on column public.billing_customers.account_id is 'The account the billing customer is for';

comment on column public.billing_customers.provider is 'The provider of the billing customer';

comment on column public.billing_customers.customer_id is 'The customer ID for the billing customer';

comment on column public.billing_customers.email is 'The email of the billing customer';

-- Indexes on the billing_customers table
create index ix_billing_customers_account_id on public.billing_customers (account_id);

-- Revoke all on billing_customers table from authenticated and service_role
revoke all on public.billing_customers
from
  authenticated,
  service_role;

-- Open up relevant access to billing_customers table for authenticated users and service_role
grant
select
,
  insert,
update,
delete on table public.billing_customers to service_role;

-- Open up access to billing_customers table for authenticated users
grant
select
  on table public.billing_customers to authenticated,
  service_role;

-- Enable RLS on billing_customers table
alter table public.billing_customers enable row level security;

-- RLS on the billing_customers table
-- SELECT(billing_customers):
-- Users can read account subscriptions on an account they are a member of
create policy billing_customers_read_self on public.billing_customers for
select
  to authenticated using (
    account_id = (
      select
        auth.uid ()
    )
    or has_role_on_account (account_id)
  );
