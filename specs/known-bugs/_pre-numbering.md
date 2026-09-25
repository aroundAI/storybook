# Fixed before the register numbered its entries

Frozen: these fixes predate `KB-<n>` numbers, so they have no file of
their own. Rows copied verbatim from the old register's *Fixed* table.

| ID | Bug | Fixed in |
|---|---|---|
| — | `analytics_experiments`, `content_tags`, `hook_tests` authors blocked user deletion | #264 |
| — | GitHub deploy workflows never applied migrations; tests could not stop a deploy | #264 |
| — | CI tested `@kit/mailers-core`, which does not exist; `@kit/mailers` never ran | #264 |
| — | The experiment lifecycle was held only by the actions; a direct API call could reopen, back-date or forge an experiment | #264 (round 4) |
| — | A server action after the session ended showed "An unexpected response was received from the server" instead of going to sign-in: middleware redirected the action's request, which Next's client cannot follow. Fixed for every action under `/home` | #264 (round 5) |
