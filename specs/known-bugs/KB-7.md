---
id: KB-7
title: "No UI to abandon, edit or delete an experiment"
status: fixed
fixed_in: ["#352"]
fixed_summary: "The Change log had no way to edit, abandon or delete an entry; delete is now allowed only while planned or abandoned, by the table as well"
severity: Low
found: 2026-09-19
---

## KB-7 — No UI to abandon, edit or delete an experiment

**Severity:** Low. **Found:** FILM-1610 review, round 4.

`abandonExperimentAction`, `updateExperimentAction` and
`deleteExperimentAction` exist, are tested, and are exported, but the
experiment log page calls none of them. That predates FILM-1610. An
experiment logged by mistake can only be started and concluded. The
table and the actions already hold the rules (the lifecycle trigger,
`assertEditable`), so a UI needs no new server work.

> **Fixed (2026-09-24), #352.** Reproduced first on `52ed2ade`: the three
> actions had no caller outside `server/index.ts` and their tests. The change
> dialog now offers **Edit** (every field while planned; once started, the
> metric, window, videos, hypothesis and expectation are locked from the same
> `frozenFields` list the action and the table use), **Abandon** (planned or
> running, with an optional reason and the local date) and **Delete**.
>
> - [x] Edit sends only what changed (`lib/experiment-edit.ts`, unit-tested),
>   and a second edit saves its own values, not the first's
>   (`apps/e2e/tests/experiments/experiments-manage.spec.ts`, "editing one
>   change and then another")
> - [x] Delete **only while planned or abandoned** — owner decision,
>   2026-09-24. A running change is abandoned first; a concluded one is the
>   record. Held by the table (`20260924143141_change-log-tags-and-delete-scope.sql`,
>   `analytics-experiments-rls.test.sql`: red before, 4 failures), the action
>   (`assertCanDelete`, returned as a value) and the page (the button is hidden)
> - [x] A refusal reaches the page in its own words on a production build, and
>   the dialog then re-reads the change instead of offering moves for the
>   state it left (found by the delete-refusal spec, watched red)
> - [x] The lifecycle guard, freeze trigger and link policies are unchanged
