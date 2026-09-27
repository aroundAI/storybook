#!/bin/bash
# webhooks-to.sh <port>
# seed.sql points the three database webhooks (account teardown, subscription delete, invitation
# insert) at http://host.docker.internal:3000/api/db/webhook. On lane B, or with your own server on
# another port, the invitation email never arrives. Run this after every `supabase db reset` to
# re-create those triggers against <port> on the current lane's database (LANE=A|B, default A).
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
port=${1:?usage: webhooks-to.sh <port>}
container=supabase_db_storybook$LANE_SFX
url="http://host.docker.internal:$port/api/db/webhook"
docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<SQL
begin;
drop trigger if exists "accounts_teardown" on public.accounts;
create trigger "accounts_teardown" after delete on public.accounts for each row
  execute function supabase_functions.http_request('$url','POST','{"Content-Type":"application/json", "X-Supabase-Event-Signature":"WEBHOOKSECRET"}','{}','5000');
drop trigger if exists "subscriptions_delete" on public.subscriptions;
create trigger "subscriptions_delete" after delete on public.subscriptions for each row
  execute function supabase_functions.http_request('$url','POST','{"Content-Type":"application/json", "X-Supabase-Event-Signature":"WEBHOOKSECRET"}','{}','5000');
drop trigger if exists "invitations_insert" on public.invitations;
create trigger "invitations_insert" after insert on public.invitations for each row
  execute function supabase_functions.http_request('$url','POST','{"Content-Type":"application/json", "X-Supabase-Event-Signature":"WEBHOOKSECRET"}','{}','5000');
commit;
SQL
echo "webhooks → $url (lane $LANE)"
