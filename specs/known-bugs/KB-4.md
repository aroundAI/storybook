---
id: KB-4
title: "`config.toml` still points `db diff` at `schemas/`"
status: fixed
fixed_in: ["#349"]
fixed_summary: "`deploy.sh` deployed when migrations failed; `db diff` could still read the partial `schemas/`; docs and the MCP tool named old local ports; `STORAGE_PROVIDER=s3` (templates and the SST default) silently meant Supabase; 203 spec citations pointed at moved or changed code"
severity: Low
found: 2026-09-19
---

## KB-4 — `config.toml` still points `db diff` at `schemas/`

> **Fixed (2026-09-24), #349.** The proposed fix below would have done nothing:
> with no `schema_paths`, CLI 2.117.0 walks `supabase/schemas/` by default
> (`internal/db/diff/diff.go`, `loadDeclaredSchemas`), which is where ours
> lives. `schema_paths` is also read by `db reset --experimental`, which builds
> from it instead of `migrations/`. It now names a glob that matches nothing,
> so `db diff` stops with "no files matched pattern"; the database is built
> from `migrations/` as before. Guard:
> `packages/shared/__tests__/local-supabase-config.test.ts` (red on `main`: the
> glob matched 50 files). Not proved by running `db diff`, by rule.

**Severity:** Low. **Found:** the `db diff` removal (#265).

`apps/web/supabase/config.toml` sets `schema_paths = ["./schemas/*.sql"]`.
`schemas/` is incomplete, so a stray `supabase db diff` proposes dropping
live tables. #265 removed every script and doc that suggested running it;
this setting is what makes running it harmful.

**Proposed fix:** remove `schema_paths` (it is read only by `db diff`), or
keep it once `schemas/` is reconciled. Needs a decision; nothing else
reads it.
