# Data deletion — the operator's side of `/data-deletion`

`/data-deletion` promises three things, and until KB-20 item 3 automates them
every one is done by hand by whoever reads `privacy@storybook.digital`:

| Trigger | Window the page promises | Where it comes from |
|---|---|---|
| A person asks (email), or deletes their account | **7 calendar days** | YouTube developer policies III.E.4 — the same figure is used for every platform, so there is one promise to keep |
| A YouTube connection is disconnected **inside our app** | **7 calendar days** | III.D: our Disconnect button is the "mechanism" the clause names |
| Access revoked at Google, or a YouTube token that can no longer be refreshed | **30 calendar days** | III.D / III.E.4 |
| Any other platform, no request | never — kept until asked | Owner decision, 2026-09-22 (Meta's terms allow it; TikTok's could not be read) |

Nothing automates any row of this table yet. **Before a second account is
onboarded, KB-20 item 3 must exist** — the owner being both the only user and
the operator is what makes "we delete within 7 days" true today.

## Where the data is

**Postgres (Supabase).** Since KB-22, **Disconnect deletes nothing in
Postgres**: it wipes the connection's tokens and sets
`platform_connections.disconnected_at`, and the connection's `publishes` — with
their revenue entries, tags, experiment membership and tasks — stay, as do its
YPP targets and publishing defaults. A connection **cannot be deleted on its
own**, not even from the SQL editor: the trigger
`platform_connections_refuse_delete` refuses it (SQLSTATE 23001) while its
account exists. Only deleting the account (Settings → Danger Zone) removes it,
cascading everything through `accounts`.

What in Postgres came from the vendor, and is therefore in scope for a
platform deletion: `revenue_records` rows with `source = 'api'` on the
connection's publishes, and the connection's `youtube_report_jobs`. Rows with
`source = 'manual'` are the creator's own and are never part of it.

**ClickHouse.** Nine tables, no cascade, no TTL, nothing in the app deletes
from them:

| Table | Keyed by |
|---|---|
| `video_dim` | `video_id`; carries `account_id`, `connection_id`, `platform` |
| `video_metrics`, `video_snapshots`, `video_reach_daily`, `video_traffic_sources`, `video_audience`, `video_retention_curves` | `video_id` |
| `channel_daily`, `channel_subscribers` | `connection_id` |

`video_dim` is the index into the other seven: `video_dim.connection_id` says
which videos were a connection's — including after its account is deleted and
the Postgres rows are gone.

## Procedures

Run Postgres statements in the Supabase SQL editor for the deployment (service
role — RLS would otherwise hide other users' rows). Run ClickHouse statements
with `clickhouse-client` or the HTTP interface against the deployment's server.
**Never put a host, password or token in this file or in a ticket.**

### A. "Delete everything you hold about me"

1. Postgres: the user deletes their account from Settings → Danger Zone, or you
   do it for them from the admin area. Confirm with
   `select id from public.accounts where id = '<ACCOUNT_ID>';` → no row.
2. ClickHouse, by account:

```sql
-- what is there, and which connections it belonged to
SELECT connection_id, platform, count() AS videos
FROM video_dim WHERE account_id = '<ACCOUNT_ID>'
GROUP BY connection_id, platform;

-- the seven video tables; video_dim goes LAST, it is the index the others use
ALTER TABLE video_metrics          DELETE WHERE video_id IN (SELECT video_id FROM video_dim WHERE account_id = '<ACCOUNT_ID>');
ALTER TABLE video_snapshots        DELETE WHERE video_id IN (SELECT video_id FROM video_dim WHERE account_id = '<ACCOUNT_ID>');
ALTER TABLE video_reach_daily      DELETE WHERE video_id IN (SELECT video_id FROM video_dim WHERE account_id = '<ACCOUNT_ID>');
ALTER TABLE video_traffic_sources  DELETE WHERE video_id IN (SELECT video_id FROM video_dim WHERE account_id = '<ACCOUNT_ID>');
ALTER TABLE video_audience         DELETE WHERE video_id IN (SELECT video_id FROM video_dim WHERE account_id = '<ACCOUNT_ID>');
ALTER TABLE video_retention_curves DELETE WHERE video_id IN (SELECT video_id FROM video_dim WHERE account_id = '<ACCOUNT_ID>');
-- the two channel tables, one statement per connection_id from the first query
ALTER TABLE channel_daily       DELETE WHERE connection_id = '<CONNECTION_ID>';
ALTER TABLE channel_subscribers DELETE WHERE connection_id = '<CONNECTION_ID>';
-- last
ALTER TABLE video_dim DELETE WHERE account_id = '<ACCOUNT_ID>';
```

### B. "Delete only what you got from <platform>"

1. Find the connection:
   `select id, platform, platform_account_name, disconnected_at from public.platform_connections where account_id = '<ACCOUNT_ID>';`
2. Postgres — the vendor's rows only; manual entries stay:
   ```sql
   delete from public.revenue_records r
    using public.publishes p
    where p.id = r.publish_id
      and p.platform_connection_id = '<CONNECTION_ID>'
      and r.source = 'api';
   delete from public.youtube_report_jobs where platform_connection_id = '<CONNECTION_ID>';
   -- so a reconnect collects the history again rather than resuming after it
   update public.publishes
      set metadata = metadata - 'sync', duration_seconds = null
    where platform_connection_id = '<CONNECTION_ID>';
   ```
3. ClickHouse: procedure A's statements with `connection_id = '<CONNECTION_ID>'`
   in place of the `account_id` predicate, `video_dim` last.

### C. A YouTube connection was disconnected in the app — within 7 days

The connection is still in Postgres, marked disconnected:

```sql
select id, platform_account_name, disconnected_at
  from public.platform_connections
 where platform = 'youtube' and disconnected_at is not null;
```

Then procedure B steps 2 and 3 for each id. (Before KB-22 a disconnect had
already deleted the Postgres rows, manual ones included; it no longer does.)

### D. Revoked at Google, or the YouTube token can no longer be refreshed — within 30 days

The hourly sync fails for that connection. Disconnect it in the app if it is
still listed (Settings → Platforms) — which wipes its tokens and keeps the
creator's records — then procedure C.

## After every run

```sql
-- ClickHouse mutations are asynchronous; wait until nothing is pending …
SELECT table, command, is_done FROM system.mutations WHERE is_done = 0;
-- … then prove the rows are gone
SELECT count() FROM video_dim WHERE account_id = '<ACCOUNT_ID>';   -- 0
SELECT count() FROM channel_daily WHERE connection_id = '<CONNECTION_ID>';   -- 0
```

Reply to the requester that it is done, and note the date, the account id,
which procedure ran and the `system.mutations` ids somewhere the next audit can
find. Deleting here changes nothing on the platform itself — the page says so,
and so should the reply.
