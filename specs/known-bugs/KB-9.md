---
id: KB-9
title: "Hook Lab reads another account's retention (cross-tenant)"
status: fixed
fixed_in: ["#269 (removed)"]
fixed_summary: "Hook Lab: a cross-tenant retention read, and a feature that could not be used and measured the wrong point"
severity: High
found: 2026-09-20
---

## KB-9 — Hook Lab reads another account's retention (cross-tenant)

> **Resolved by removal (2026-09-20).** Hook Lab's code and tables are gone,
> so nothing reads a variant's video any more. Kept here as the record of
> what was found; the same-account rule it lacked is a requirement of
> FILM-1724.

**Severity:** High — a data leak across accounts, though it needs the
other account's publish id (a UUID), and Hook Lab has no page for adding
variants, so only a direct API call reaches it. **Found:** Hook Lab review,
2026-09-20. **Fix it on its own, before anything else here.**

`hook_variants_create` checks that the caller can reach the *test*, never
that `publish_id` belongs to the test's account. `queryRetentionCurve`
then reads ClickHouse by `video_id` alone, and ClickHouse has no row-level
security. The refresh writes that curve into the caller's variant.

**Reproduced** on a production build, as account A's owner through
PostgREST: a variant linked to account B's video was accepted (201), and
"Refresh retention" on the page stored B's retention (0.4242, a value only
B's curve had) and showed it in A's test.

`hook_tests` has the same shape of gap: `project_id` is not checked to be
in `account_id` (the FILM-1608 composite-key pattern). Neither table has a
pgTAP test.

**Proposed fix:** the FILM-1610 same-account rule. The variant insert and
update policies require the publish's project to be in the test's account;
`hook_tests` gets a composite `(project_id, account_id)` key; the retention
read goes through a publish the caller can see, as FILM-1610's
`linkedPublishes` does. pgTAP for each, including a user in two accounts,
seen failing first.
