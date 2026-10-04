# @kit/desktop-integration

Contracts and services shared between StoryBook and StorybookStudio (Phase 20).

This package starts empty so the Phase 20 specs can add to it in parallel.
What will live here:

- `BrandSchema` and `EditPolicySchema` (FILM-2004)
- `EditPackageSchema` and its builder (FILM-2001)
- the edit-sessions service (FILM-2002)
- `ExplainWhyReportSchema`, `QaResultSchema` and the delivery service (FILM-2003)

The schemas are defined once, here. A script copies them to
`storybookstudio/src/studio/contracts/`, and each repo has a drift test.
Server-only code goes under `src/server/` and is exported as `./server`.
