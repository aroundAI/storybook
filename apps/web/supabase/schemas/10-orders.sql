/**
 * -------------------------------------------------------
 * Section: Orders
 * We create the schema for the subscription items. Subscription items are the items in a subscription.
 * For example, a subscription might have a subscription item with the product ID 'prod_123' and the variant ID 'var_123'.
 * -------------------------------------------------------
 */

create table if not exists
  public.orders (
    id text not null primary key,
    account_id uuid references public.accounts (id) on delete cascade not null,
    billing_customer_id int references public.billing_customers on delete cascade not null,
    status public.payment_status not null,
    billing_provider public.billing_provider not null,
    total_amount numeric not null,
    currency varchar(3) not null,
    created_at timestamptz not null default current_timestamp,
    updated_at timestamptz not null default current_timestamp
  );

comment on table public.orders is 'The one-time orders for an account';

comment on column public.orders.account_id is 'The account the order is for';

comment on column public.orders.billing_provider is 'The provider of the order';

comment on column public.orders.total_amount is 'The total amount for the order';

comment on column public.orders.currency is 'The currency for the order';

comment on column public.orders.status is 'The status of the order';

comment on column public.orders.billing_customer_id is 'The billing customer ID for the order';

-- Revoke all access to orders table for authenticated users and service_role
revoke all on public.orders
from
  authenticated,
  service_role;

-- Open up access to orders table for authenticated users and service_role
grant
select
  on table public.orders to authenticated;

grant
select
,
  insert,
update,
delete on table public.orders to service_role;

-- Indexes
-- Indexes on the orders table
create index ix_orders_account_id on public.orders (account_id);

-- Triggers for orders table
create trigger orders_set_timestamps
before insert or update on public.orders
for each row execute function public.trigger_set_timestamps();

-- RLS
alter table public.orders enable row level security;

-- SELECT(orders)
-- Users can read orders on an account they are a member of or the account is their own
create policy orders_read_self on public.orders for
select
  to authenticated using (
    (
      account_id = (
        select
          auth.uid ()
      )
      and public.is_set ('enable_account_billing')
    )
    or (
      has_role_on_account (account_id)
      and public.is_set ('enable_team_account_billing')
    )
  );

/**
 * -------------------------------------------------------
 * Section: Order Items
 * We create the schema for the order items. Order items are the items in an order.
 * -------------------------------------------------------
 */
create table if not exists
  public.order_items (
    id text not null primary key,
    order_id text references public.orders (id) on delete cascade not null,
    product_id text not null,
    variant_id text not null,
    price_amount numeric,
    quantity integer not null default 1,
    created_at timestamptz not null default current_timestamp,
    updated_at timestamptz not null default current_timestamp,
    unique (order_id, product_id, variant_id)
  );

comment on table public.order_items is 'The items in an order';

comment on column public.order_items.order_id is 'The order the item is for';

comment on column public.order_items.order_id is 'The order the item is for';

comment on column public.order_items.product_id is 'The product ID for the item';

comment on column public.order_items.variant_id is 'The variant ID for the item';

comment on column public.order_items.price_amount is 'The price amount for the item';

comment on column public.order_items.quantity is 'The quantity of the item';

comment on column public.order_items.created_at is 'The creation date of the item';

comment on column public.order_items.updated_at is 'The last update date of the item';

-- Revoke all access to order_items table for authenticated users and service_role
revoke all on public.order_items
from
  authenticated,
  service_role;

-- Open up relevant access to order_items table for authenticated users and service_role
grant
select
  on table public.order_items to authenticated,
  service_role;

grant insert, update, delete on table public.order_items to service_role;

-- Indexes on the order_items table
create index ix_order_items_order_id on public.order_items (order_id);

-- Triggers for order_items table
create trigger order_items_set_timestamps
before insert or update on public.order_items
for each row execute function public.trigger_set_timestamps();

-- RLS
alter table public.order_items enable row level security;

-- SELECT(order_items):
-- Users can read order items on an order they are a member of
create policy order_items_read_self on public.order_items for
select
  to authenticated using (
    exists (
      select
        1
      from
        public.orders
      where
        id = order_id
        and (
          account_id = (
            select
              auth.uid ()
          )
          or has_role_on_account (account_id)
        )
    )
  );

-- Function "public.upsert_order"
-- Insert or update an order and its items when receiving a webhook from the billing provider
create
or replace function public.upsert_order (
  target_account_id uuid,
  target_customer_id varchar(255),
  target_order_id text,
  status public.payment_status,
  billing_provider public.billing_provider,
  total_amount numeric,
  currency varchar(3),
  line_items jsonb
) returns public.orders
set
  search_path = '' as $$
declare
    new_order public.orders;
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

    insert into public.orders(
        account_id,
        billing_customer_id,
        id,
        status,
        billing_provider,
        total_amount,
        currency)
    values (
        target_account_id,
        new_billing_customer_id,
        target_order_id,
        status,
        billing_provider,
        total_amount,
        currency)
on conflict (
    id)
    do update set
        status = excluded.status,
        total_amount = excluded.total_amount,
        currency = excluded.currency
    returning
        * into new_order;

    -- Upsert order items and delete ones that are not in the line_items array
    with item_data as (
        select
            (line_item ->> 'id')::varchar as line_item_id,
            (line_item ->> 'product_id')::varchar as prod_id,
            (line_item ->> 'variant_id')::varchar as var_id,
            (line_item ->> 'price_amount')::numeric as price_amt,
            (line_item ->> 'quantity')::integer as qty
        from
            jsonb_array_elements(line_items) as line_item
    ),
    line_item_ids as (
        select line_item_id from item_data
    ),
    deleted_items as (
        delete from
            public.order_items
        where
            public.order_items.order_id = new_order.id
            and public.order_items.id not in (select line_item_id from line_item_ids)
        returning *
    )
    insert into public.order_items(
        id,
        order_id,
        product_id,
        variant_id,
        price_amount,
        quantity)
    select
        line_item_id,
        target_order_id,
        prod_id,
        var_id,
        price_amt,
        qty
    from
        item_data
    on conflict (id)
        do update set
            price_amount = excluded.price_amount,
            product_id = excluded.product_id,
            variant_id = excluded.variant_id,
            quantity = excluded.quantity;

    return new_order;

end;

$$ language plpgsql;

grant
execute on function public.upsert_order (
  uuid,
  varchar,
  text,
  public.payment_status,
  public.billing_provider,
  numeric,
  varchar,
  jsonb
) to service_role;