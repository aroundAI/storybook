# Plan: Investigate and Fix GitHub Actions Workflows

## Phase 1: Diagnosis & Analysis
- [ ] Task: List recent workflow runs to identify failing jobs.
  - [ ] Sub-task: Execute `gh run list` to get an overview of recent statuses.
  - [ ] Sub-task: Identify the specific Run IDs of the most recent failures.
- [ ] Task: Analyze failure logs for specific errors.
  - [ ] Sub-task: Use `gh run view <run-id> --log` for each failing run to extract error messages.
  - [ ] Sub-task: Document the root cause for each failure (e.g., "Linting failed in package X", "Timeout in test Y").

## Phase 2: Remediation
- [ ] Task: Fix identified CI issues.
  - [ ] Sub-task: Create a reproduction case locally if possible (e.g., run `pnpm lint` or `pnpm test` locally).
  - [ ] Sub-task: Modify `.github/workflows/` files or project code to resolve the errors.
  - [ ] Sub-task: Verify the fix locally.
- [ ] Task: Conductor - User Manual Verification 'Remediation' (Protocol in workflow.md)

## Phase 3: Verification & Commit
- [ ] Task: Push fixes and verify CI stability.
  - [ ] Sub-task: Commit changes with a descriptive message (e.g., `fix(ci): resolve build timeout in test workflow`).
  - [ ] Sub-task: Push changes to a branch/PR.
  - [ ] Sub-task: Monitor the new workflow run using `gh run watch` to ensure it passes.
- [ ] Task: Conductor - User Manual Verification 'Verification & Commit' (Protocol in workflow.md)
