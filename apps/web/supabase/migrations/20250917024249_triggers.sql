-- Triggers for accounts table
create trigger accounts_set_timestamps
before insert or update on public.accounts
for each row execute function public.trigger_set_timestamps();

create trigger accounts_set_user_tracking
before insert or update on public.accounts
for each row execute function public.trigger_set_user_tracking();

-- Triggers for accounts_memberships table
create trigger accounts_memberships_set_timestamps
before insert or update on public.accounts_memberships
for each row execute function public.trigger_set_timestamps();

create trigger accounts_memberships_set_user_tracking
before insert or update on public.accounts_memberships
for each row execute function public.trigger_set_user_tracking();

-- Triggers for invitations table
create trigger invitations_set_timestamps
before insert or update on public.invitations
for each row execute function public.trigger_set_timestamps();

-- Triggers for subscriptions table
create trigger subscriptions_set_timestamps
before insert or update on public.subscriptions
for each row execute function public.trigger_set_timestamps();

-- Triggers for subscription_items table
create trigger subscription_items_set_timestamps
before insert or update on public.subscription_items
for each row execute function public.trigger_set_timestamps();

-- Triggers for orders table
create trigger orders_set_timestamps
before insert or update on public.orders
for each row execute function public.trigger_set_timestamps();

-- Triggers for order_items table
create trigger order_items_set_timestamps
before insert or update on public.order_items
for each row execute function public.trigger_set_timestamps();