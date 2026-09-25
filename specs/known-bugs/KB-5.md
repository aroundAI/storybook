---
id: KB-5
title: "README gives the wrong local Supabase ports"
status: fixed
fixed_in: ["#349"]
fixed_summary: "`deploy.sh` deployed when migrations failed; `db diff` could still read the partial `schemas/`; docs and the MCP tool named old local ports; `STORAGE_PROVIDER=s3` (templates and the SST default) silently meant Supabase; 203 spec citations pointed at moved or changed code"
severity: Low
found: 2026-09-19
---

## KB-5 — README gives the wrong local Supabase ports

> **Fixed (2026-09-24), #349.** Also stale:
> `apps/web/content/documentation/authentication/configuration.mdoc` (InBucket
> on 54324) and, in code, `packages/mcp-server/src/tools/database.ts`, whose
> database tool defaulted to `127.0.0.1:54322`. A guard in
> `packages/shared/__tests__/local-supabase-config.test.ts` fails any local
> 54xxx/55xxx port in docs or dev tooling that `config.toml` does not set.

**Severity:** Low. **Found:** the `db diff` removal (#265).

`README.md` ("Database Management" section) says Supabase is on
`http://localhost:54321` and email on `:54325`; this repo's
`config.toml` runs them on `55321` and `55324`.
