/*
 * -------------------------------------------------------
 * Section: Subscriptions
 * We create the schema for the subscriptions. Subscriptions are the subscriptions for an account to a product. For example, a user might have a subscription to a product with the status 'active'.
 * -------------------------------------------------------

 */
-- Subscriptions table
create table if not exists
  public.subscriptions (
    id text not null primary key,
    account_id uuid references public.accounts (id) on delete cascade not null,
    billing_customer_id int references public.billing_customers on delete cascade not null,
    status public.subscription_status not null,
    active bool not null,
    billing_provider public.billing_provider not null,
    cancel_at_period_end bool not null,
    currency varchar(3) not null,
    created_at timestamptz not null default current_timestamp,
    updated_at timestamptz not null default current_timestamp,
    period_starts_at timestamptz not null,
    period_ends_at timestamptz not null,
    trial_starts_at timestamptz,
    trial_ends_at timestamptz
  );

comment on table public.subscriptions is 'The subscriptions for an account';

comment on column public.subscriptions.account_id is 'The account the subscription is for';

comment on column public.subscriptions.billing_provider is 'The provider of the subscription';

comment on column public.subscriptions.cancel_at_period_end is 'Whether the subscription will be canceled at the end of the period';

comment on column public.subscriptions.currency is 'The currency for the subscription';

comment on column public.subscriptions.status is 'The status of the subscription';

comment on column public.subscriptions.period_starts_at is 'The start of the current period for the subscription';

comment on column public.subscriptions.period_ends_at is 'The end of the current period for the subscription';

comment on column public.subscriptions.trial_starts_at is 'The start of the trial period for the subscription';

comment on column public.subscriptions.trial_ends_at is 'The end of the trial period for the subscription';

comment on column public.subscriptions.active is 'Whether the subscription is active';

comment on column public.subscriptions.billing_customer_id is 'The billing customer ID for the subscription';

-- Revoke all on subscriptions table from authenticated and service_role
revoke all on public.subscriptions
from
  authenticated,
  service_role;

-- Open up relevant access to subscriptions table for authenticated users and service_role
grant
select
,
  insert,
update,
delete on table public.subscriptions to service_role;

grant
select
  on table public.subscriptions to authenticated;

-- Indexes on the subscriptions table
create index ix_subscriptions_account_id on public.subscriptions (account_id);

-- Triggers for subscriptions table
create trigger subscriptions_set_timestamps
before insert or update on public.subscriptions
for each row execute function public.trigger_set_timestamps();

-- Enable RLS on subscriptions table
alter table public.subscriptions enable row level security;

-- RLS on the subscriptions table
-- SELECT(subscriptions):
-- Users can read account subscriptions on an account they are a member of
create policy subscriptions_read_self on public.subscriptions for
select
  to authenticated using (
    (
      has_role_on_account (account_id)
      and public.is_set ('enable_team_account_billing')
    )
    or (
      account_id = (
        select
          auth.uid ()
      )
      and public.is_set ('enable_account_billing')
    )
  );

-- Function "public.upsert_subscription"
-- Insert or Update a subscription and its items in the database when receiving a webhook from the billing provider
create
or replace function public.upsert_subscription (
  target_account_id uuid,
  target_customer_id varchar(255),
  target_subscription_id text,
  active bool,
  status public.subscription_status,
  billing_provider public.billing_provider,
  cancel_at_period_end bool,
  currency varchar(3),
  period_starts_at timestamptz,
  period_ends_at timestamptz,
  line_items jsonb,
  trial_starts_at timestamptz default null,
  trial_ends_at timestamptz default null
) returns public.subscriptions
set
  search_path = '' as $$
declare
    new_subscription public.subscriptions;
    new_billing_customer_id int;
begin
    insert into public.billing_customers(
        account_id,
        provider,
        customer_id)
    values (
        target_account_id,
        billing_provider,
        target_customer_id)
on conflict (
    account_id,
    provider,
    customer_id)
    do update set
        provider = excluded.provider
    returning
        id into new_billing_customer_id;

    insert into public.subscriptions(
        account_id,
        billing_customer_id,
        id,
        active,
        status,
        billing_provider,
        cancel_at_period_end,
        currency,
        period_starts_at,
        period_ends_at,
        trial_starts_at,
        trial_ends_at)
    values (
        target_account_id,
        new_billing_customer_id,
        target_subscription_id,
        active,
        status,
        billing_provider,
        cancel_at_period_end,
        currency,
        period_starts_at,
        period_ends_at,
        trial_starts_at,
        trial_ends_at)
on conflict (
    id)
    do update set
        active = excluded.active,
        status = excluded.status,
        cancel_at_period_end = excluded.cancel_at_period_end,
        currency = excluded.currency,
        period_starts_at = excluded.period_starts_at,
        period_ends_at = excluded.period_ends_at,
        trial_starts_at = excluded.trial_starts_at,
        trial_ends_at = excluded.trial_ends_at
    returning
        * into new_subscription;

    -- Upsert subscription items and delete ones that are not in the line_items array
    with item_data as (
        select
            (line_item ->> 'id')::varchar as line_item_id,
            (line_item ->> 'product_id')::varchar as prod_id,
            (line_item ->> 'variant_id')::varchar as var_id,
            (line_item ->> 'type')::public.subscription_item_type as type,
            (line_item ->> 'price_amount')::numeric as price_amt,
            (line_item ->> 'quantity')::integer as qty,
            (line_item ->> 'interval')::varchar as intv,
            (line_item ->> 'interval_count')::integer as intv_count
        from
            jsonb_array_elements(line_items) as line_item
    ),
    line_item_ids as (
        select line_item_id from item_data
    ),
    deleted_items as (
        delete from
            public.subscription_items
        where
            public.subscription_items.subscription_id = new_subscription.id
            and public.subscription_items.id not in (select line_item_id from line_item_ids)
        returning *
    )
    insert into public.subscription_items(
        id,
        subscription_id,
        product_id,
        variant_id,
        type,
        price_amount,
        quantity,
        interval,
        interval_count)
    select
        line_item_id,
        target_subscription_id,
        prod_id,
        var_id,
        type,
        price_amt,
        qty,
        intv,
        intv_count
    from
        item_data
    on conflict (id)
        do update set
            product_id = excluded.product_id,
            variant_id = excluded.variant_id,
            price_amount = excluded.price_amount,
            quantity = excluded.quantity,
            interval = excluded.interval,
            type = excluded.type,
            interval_count = excluded.interval_count;

    return new_subscription;

end;

$$ language plpgsql;

grant
execute on function public.upsert_subscription (
  uuid,
  varchar,
  text,
  bool,
  public.subscription_status,
  public.billing_provider,
  bool,
  varchar,
  timestamptz,
  timestamptz,
  jsonb,
  timestamptz,
  timestamptz
) to service_role;

/* -------------------------------------------------------
* Section: Subscription Items
* We create the schema for the subscription items. Subscription items are the items in a subscription.
* For example, a subscription might have a subscription item with the product ID 'prod_123' and the variant ID 'var_123'.
* -------------------------------------------------------
*/
create table if not exists
  public.subscription_items (
    id varchar(255) not null primary key,
    subscription_id text references public.subscriptions (id) on delete cascade not null,
    product_id varchar(255) not null,
    variant_id varchar(255) not null,
    type public.subscription_item_type not null,
    price_amount numeric,
    quantity integer not null default 1,
    interval varchar(255) not null,
    interval_count integer not null check (interval_count > 0),
    created_at timestamptz not null default current_timestamp,
    updated_at timestamptz not null default current_timestamp,
    unique (subscription_id, product_id, variant_id)
  );

comment on table public.subscription_items is 'The items in a subscription';

comment on column public.subscription_items.subscription_id is 'The subscription the item is for';

comment on column public.subscription_items.product_id is 'The product ID for the item';

comment on column public.subscription_items.variant_id is 'The variant ID for the item';

comment on column public.subscription_items.price_amount is 'The price amount for the item';

comment on column public.subscription_items.quantity is 'The quantity of the item';

comment on column public.subscription_items.interval is 'The interval for the item';

comment on column public.subscription_items.interval_count is 'The interval count for the item';

comment on column public.subscription_items.created_at is 'The creation date of the item';

comment on column public.subscription_items.updated_at is 'The last update date of the item';

-- Revoke all access to subscription_items table for authenticated users and service_role
revoke all on public.subscription_items
from
  authenticated,
  service_role;

-- Open up relevant access to subscription_items table for authenticated users and service_role
grant
select
  on table public.subscription_items to authenticated,
  service_role;

grant insert,
update,
delete on table public.subscription_items to service_role;

-- Indexes
-- Indexes on the subscription_items table
create index ix_subscription_items_subscription_id on public.subscription_items (subscription_id);

-- Triggers for subscription_items table
create trigger subscription_items_set_timestamps
before insert or update on public.subscription_items
for each row execute function public.trigger_set_timestamps();

-- RLS
alter table public.subscription_items enable row level security;

-- SELECT(subscription_items)
-- Users can read subscription items on a subscription they are a member of
create policy subscription_items_read_self on public.subscription_items for
select
  to authenticated using (
    exists (
      select
        1
      from
        public.subscriptions
      where
        id = subscription_id
        and (
          account_id = (
            select
              auth.uid ()
          )
          or has_role_on_account (account_id)
        )
    )
  );


-- Function "public.has_active_subscription"
-- Check if a user has an active subscription on an account - ie. it's trialing or active
-- Useful to gate access to features that require a subscription
create
or replace function public.has_active_subscription (target_account_id uuid) returns boolean
set
  search_path = '' as $$
begin
    return exists (
        select
            1
        from
            public.subscriptions
        where
            account_id = target_account_id
            and active = true);

end;

$$ language plpgsql;

grant
execute on function public.has_active_subscription (uuid) to authenticated,
service_role;