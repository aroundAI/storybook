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

## The edit package (FILM-2001)

- Contract: `src/edit-package.schema.ts` (`EditPackageSchema`, `MediaRef`,
  `MediaEntry`, `EditPackage`).
- Server: `getEditPackage(client, {accountId, episodeId, ifNoneMatch})` from
  `@kit/desktop-integration/server`; the MCP tool is `get_edit_package`.
- Fixtures for the fork's builder tests: `fixtures/edit-package/{5,20,60}-shots.json`,
  regenerated from `fixtures/edit-package/seed.ts` with
  `UPDATE_FIXTURES=1 pnpm --filter @kit/desktop-integration exec vitest run __tests__/edit-package-fixtures.test.ts`.
- Copy the contracts into the fork: `node scripts/sync-studio-contracts.mjs`.
