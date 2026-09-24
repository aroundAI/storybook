# Data deletion — the operator's side of `/data-deletion`

`/data-deletion` promises three things. Since KB-22 part B (KB-20 item 3) a
job does the deleting — the hourly `vendor-data-purge` cron works through
`public.vendor_data_purges` — and the operator's part is to queue what only a
person can: a request by email, and (until KB-29 lands) a YouTube token that
can no longer be renewed.

| Trigger | Window the page promises | Where it comes from |
|---|---|---|
| A person asks (email), or deletes their account | **7 calendar days** | YouTube developer policies III.E.4 — the same figure is used for every platform, so there is one promise to keep |
| A YouTube connection is disconnected **inside our app** | **7 calendar days** | III.D: our Disconnect button is the "mechanism" the clause names |
| Access revoked at Google, or a YouTube token that can no longer be refreshed | **30 calendar days** | III.D / III.E.4 |
| Any other platform, no request | never — kept until asked | Owner decision, 2026-09-22 (Meta's terms allow it; TikTok's could not be read) |

| Trigger | Who queues the purge | Procedure |
|---|---|---|
| Account deleted | the database (`vendor_data_purges_on_delete`) | none — check it ran (below) |
| YouTube disconnected in the app | the database (`vendor_data_purges_on_disconnect`), runs after 1 hour | none — check it ran |
| A request by email | **the operator**: one insert | B |
| YouTube revoked at Google / token cannot be renewed | **the operator**, by hand, until KB-29 lands (owner decision D5) | D |

Each queued row runs within the hour after `run_after` and records what it
deleted in `result`. A row still open past `due_by` is logged at **error** as
`vendor-data-purge.overdue` — that line is the breach of the page's promise,
and the alert to set up.

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

**ClickHouse.** No cascade and no TTL; the purge job
(`packages/clickhouse/src/purge.ts`) is the only thing that deletes from it,
and its lists are the authoritative set — `verify:purge` fails if the server
holds a table they do not name:

| Table | Keyed by |
|---|---|
| `video_dim` | `video_id`; carries `account_id`, `connection_id`, `platform` |
| `video_metrics`, `video_snapshots`, `video_reach_daily`, `video_traffic_sources`, `video_audience`, `video_retention_curves` | `video_id` — **the Postgres publish id**, not the platform's video id |
| `channel_daily`, `channel_subscribers`, `channel_reach_daily` (FILM-1504) | `connection_id` |

`video_dim` is the index into the per-video tables: `video_dim.connection_id`
says which videos were a connection's — including after its account is
deleted and the Postgres rows are gone.

## Procedures

Run Postgres statements in the Supabase SQL editor for the deployment (service
role — RLS would otherwise hide other users' rows). Run ClickHouse statements
with `clickhouse-client` or the HTTP interface against the deployment's server.
**Never put a host, password or token in this file or in a ticket.**

### A. "Delete everything you hold about me"

1. Postgres: the user deletes their account from Settings → Danger Zone, or you
   do it for them from the admin area. Confirm with
   `select id from public.accounts where id = '<ACCOUNT_ID>';` → no row.
2. ClickHouse: nothing to run. Deleting the account deleted its connections,
   and each queued a purge (`reason = 'connection_deleted'`) that the hourly job
   runs. Check:

```sql
select connection_id, platform, completed_at, last_error, result
  from public.vendor_data_purges
 where account_id = '<ACCOUNT_ID>' and reason = 'connection_deleted';
```

   Every row should have `completed_at` within the hour. As a last resort, if
   the job cannot run, the statements it issues are in
   `packages/clickhouse/src/purge.ts` (`purgeStatements`): every per-video
   table by `video_id IN (the connection's publish ids)`, every per-channel
   table by `connection_id`, `video_dim` last.

### B. "Delete only what you got from <platform>"

1. Find the connection:
   `select id, account_id, platform, platform_account_name, disconnected_at from public.platform_connections where account_id = '<ACCOUNT_ID>';`
2. Queue it — the job does the rest within the hour, Postgres and ClickHouse
   both, and leaves manual entries alone:
   ```sql
   insert into public.vendor_data_purges
     (connection_id, account_id, platform, reason, due_by)
   values
     ('<CONNECTION_ID>', '<ACCOUNT_ID>', '<PLATFORM>', 'request', now() + interval '7 days');
   ```
   To stop collecting as well, ask the creator to disconnect it (or do it for
   them): the purge deletes what is held, and a live connection would collect
   again at the next sync.

### C. A YouTube connection was disconnected in the app — within 7 days

Nothing to do: the disconnect queued the purge. Check that it ran:

```sql
select c.platform_account_name, c.disconnected_at, v.completed_at, v.last_error
  from public.platform_connections c
  left join public.vendor_data_purges v
    on v.connection_id = c.id and v.reason = 'in_app_disconnect'
 where c.platform = 'youtube' and c.disconnected_at is not null
 order by c.disconnected_at desc;
```

A row with no `completed_at` a day after the disconnect means the job is
failing: `last_error` says why.

Whether the platform confirmed the revoke is in the `oauth.disconnect` log
line: `revoke` and `httpStatus`, at `warn` when it did not (KB-45). The
creator was shown the same, with a link to remove access at the platform. A
LinkedIn disconnect is always `vendor_offers_none`: LinkedIn gives apps no
revoke, so the creator removes access there (KB-25).

### D. Revoked at Google, or the YouTube token can no longer be refreshed — within 30 days

The hourly sync fails for that connection. Disconnect it in the app if it is
still listed (Settings → Platforms) — which wipes its tokens, keeps the
creator's records and queues the purge (procedure C). Automating this case is
deferred until KB-29 lands (owner decision D5): today KB-29's refresh bug
makes renewals fail for reasons of ours, not the creator's.

## After every run

The job counts every table back to zero after its deletes and fails the purge
otherwise, so `completed_at` set with `last_error` null is the proof. Its
`result` says what went, per table; `clickhouse: "disabled"` means the
deployment had ClickHouse off, so nothing had been written there.

```sql
select requested_at, completed_at, result
  from public.vendor_data_purges
 where connection_id = '<CONNECTION_ID>'
 order by requested_at desc;
```

Reply to the requester that it is done. The `vendor_data_purges` row is the
audit record — date, account, connection, reason and what was deleted — so
there is nothing else to note. Deleting here changes nothing on the platform itself — the page says so,
and so should the reply.
