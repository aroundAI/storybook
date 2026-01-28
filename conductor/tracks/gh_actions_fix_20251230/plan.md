# Plan: Investigate and Fix GitHub Actions Workflows

## Phase 1: Diagnosis & Analysis
- [x] Task: List recent workflow runs to identify failing jobs.
  - [x] Sub-task: Execute `gh run list` to get an overview of recent statuses.
  - [x] Sub-task: Identify the specific Run IDs of the most recent failures.
- [x] Task: Analyze failure logs for specific errors.
  - [x] Sub-task: Use `gh run view <run-id> --log` for each failing run to extract error messages.
  - [x] Sub-task: Document the root cause for each failure (e.g., "TypeScript errors in apps/web", "Vitest coverage version mismatch").

## Phase 2: Remediation
- [x] Task: Fix identified CI issues. [fa93996]
  - [x] Sub-task: Create a reproduction case locally if possible (e.g., run `pnpm lint` or `pnpm test` locally).
  - [x] Sub-task: Modify `.github/workflows/` files or project code to resolve the errors.
  - [x] Sub-task: Verify the fix locally.
- [x] Task: Conductor - User Manual Verification 'Remediation' (Protocol in workflow.md) [d148eaf]

## Phase 3: Verification & Commit
- [x] Task: Push fixes and verify CI stability. [70d88a4f]
  - [x] Sub-task: Commit changes with a descriptive message (e.g., `fix(ci): resolve build timeout in test workflow`).
  - [x] Sub-task: Push changes to a branch/PR.
  - [x] Sub-task: Monitor the new workflow run using `gh run watch` to ensure it passes.
- [ ] Task: Conductor - User Manual Verification 'Verification & Commit' (Protocol in workflow.md)
