---
id: FILM-1002
title: Canon Management RLS Policies
status: draft
effort: S
dependencies: [FILM-1001]
---

# FILM-1002: Canon Management RLS Policies

## Overview

Row Level Security policies for all canon management tables, ensuring project-based access control.

## File Location

Included in: `apps/web/supabase/schemas/31-canon-management.sql`

---

## Policy Design

All canon tables follow a consistent pattern: access is granted based on project membership through the account hierarchy.

```sql
-- Access check pattern used across all policies
exists (
  select 1 from public.projects p
  where p.id = [table].project_id
  and public.has_role_on_account(p.account_id)
)
```

---

## Policies by Table

### `immutable_events`

```sql
alter table public.immutable_events enable row level security;

grant select, insert, update, delete on table public.immutable_events to authenticated;

-- Full CRUD access for project members
create policy "immutable_events_project_access" on public.immutable_events
  for all to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = immutable_events.project_id
      and public.has_role_on_account(p.account_id)
    )
  );
```

### `character_states` (Append-Only)

```sql
alter table public.character_states enable row level security;

-- Insert and Select only (no update/delete for audit integrity)
grant select, insert on table public.character_states to authenticated;

create policy "character_states_read" on public.character_states
  for select to authenticated using (
    exists (
      select 1 from public.assets a
      join public.projects p on p.id = a.project_id
      where a.id = character_states.character_id
      and public.has_role_on_account(p.account_id)
    )
  );

create policy "character_states_insert" on public.character_states
  for insert to authenticated with check (
    exists (
      select 1 from public.assets a
      join public.projects p on p.id = a.project_id
      where a.id = character_states.character_id
      and public.has_role_on_account(p.account_id)
    )
  );
```

### `world_states`

```sql
alter table public.world_states enable row level security;

grant select, insert, update on table public.world_states to authenticated;

create policy "world_states_project_access" on public.world_states
  for all to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = world_states.project_id
      and public.has_role_on_account(p.account_id)
    )
  );
```

### `narrative_threads`

```sql
alter table public.narrative_threads enable row level security;

grant select, insert, update on table public.narrative_threads to authenticated;

create policy "narrative_threads_project_access" on public.narrative_threads
  for all to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = narrative_threads.project_id
      and public.has_role_on_account(p.account_id)
    )
  );
```

### `state_deltas` (Append-Only)

```sql
alter table public.state_deltas enable row level security;

grant select, insert on table public.state_deltas to authenticated;

create policy "state_deltas_read" on public.state_deltas
  for select to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = state_deltas.episode_id
      and public.has_role_on_account(p.account_id)
    )
  );

create policy "state_deltas_insert" on public.state_deltas
  for insert to authenticated with check (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = state_deltas.episode_id
      and public.has_role_on_account(p.account_id)
    )
  );
```

### `episode_summaries`

```sql
alter table public.episode_summaries enable row level security;

grant select, insert, update on table public.episode_summaries to authenticated;

create policy "episode_summaries_access" on public.episode_summaries
  for all to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = episode_summaries.episode_id
      and public.has_role_on_account(p.account_id)
    )
  );
```

---

## Security Analysis

### Policy Evaluation Flowchart

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       RLS POLICY EVALUATION FLOW                            │
└─────────────────────────────────────────────────────────────────────────────┘

User Request (SELECT/INSERT/UPDATE/DELETE)
         │
         ▼
┌─────────────────────┐
│  Is RLS enabled?    │
│  (YES for all)      │
└──────────┬──────────┘
           │ YES
           ▼
┌─────────────────────────────────────────────────────────┐
│  Evaluate Policy Condition:                              │
│                                                          │
│  has_role_on_account(project.account_id) = true?         │
│                                                          │
│  This checks:                                            │
│  1. auth.uid() matches a user                            │
│  2. User is member of account (personal OR team)         │
│  3. Account owns the project                             │
└────────────────────────┬────────────────────────────────┘
                         │
           ┌─────────────┴─────────────┐
           │                           │
           ▼                           ▼
┌──────────────────┐         ┌──────────────────┐
│   TRUE = Allow   │         │   FALSE = Deny    │
│                  │         │   (empty result)  │
│  Row visible     │         │   Row invisible   │
│  Write allowed   │         │   Write blocked   │
└──────────────────┘         └──────────────────┘
```

### Access Control Matrix

| Operation | immutable_events | character_states | world_states | narrative_threads | state_deltas | episode_summaries |
|-----------|-----------------|------------------|--------------|-------------------|--------------|-------------------|
| SELECT | ✅ Project member | ✅ Project member | ✅ Project member | ✅ Project member | ✅ Project member | ✅ Project member |
| INSERT | ✅ Project member | ✅ Project member | ✅ Project member | ✅ Project member | ✅ Project member | ✅ Project member |
| UPDATE | ✅ Project member | ❌ Blocked | ✅ Project member | ✅ Project member | ❌ Blocked | ✅ Project member |
| DELETE | ✅ Project member | ❌ Blocked | ❌ Blocked | ❌ Blocked | ❌ Blocked | ❌ Blocked |

### Cross-Account Access Prevention Proof

**Theorem**: A user in Account A CANNOT access canon data from Account B.

**Proof**:

```sql
-- Given:
-- User U1 is member of Account A
-- Project P1 belongs to Account A
-- Project P2 belongs to Account B (B ≠ A)

-- When U1 queries immutable_events:
SELECT * FROM public.immutable_events;

-- Policy evaluates for each row:
exists (
  select 1 from public.projects p
  where p.id = immutable_events.project_id
  and public.has_role_on_account(p.account_id)
)

-- For row belonging to P1 (Account A):
-- p.account_id = A
-- has_role_on_account(A) = TRUE (U1 is member)
-- Row IS returned ✅

-- For row belonging to P2 (Account B):
-- p.account_id = B
-- has_role_on_account(B) = FALSE (U1 is NOT member of B)
-- Row is NOT returned ❌

-- Therefore: U1 only sees data from projects in accounts they belong to.
-- QED
```

**Key guarantees**:
1. **No direct project_id bypass**: Cannot query by project_id directly to access other accounts
2. **No FK traversal bypass**: Policy is re-evaluated on joined tables
3. **No service role exposure**: Policies apply to `authenticated` role only

### Append-Only Enforcement Rationale

**Why restrict UPDATE/DELETE on audit tables?**

| Table | Restricted | Reason |
|-------|------------|--------|
| `character_states` | UPDATE, DELETE | Append-only ensures complete state history; audit integrity |
| `state_deltas` | UPDATE, DELETE | Immutable audit log; enables rollback and drift detection |
| `immutable_events` | - | DELETE blocked implicitly by FK references |
| `narrative_threads` | DELETE | Threads should transition to 'abandoned', not be deleted |

**Implementation**:

```sql
-- Note: GRANT statements intentionally omit update/delete
grant select, insert on table public.character_states to authenticated;
grant select, insert on table public.state_deltas to authenticated;

-- If someone tries to update/delete:
-- ERROR: permission denied for table character_states
```

### Attack Vector Analysis

| Attack Vector | Description | Mitigation | Status |
|---------------|-------------|------------|--------|
| **Direct project_id injection** | Attacker crafts request with different project_id | RLS policy checks account membership, not just project_id | ✅ Blocked |
| **IDOR via UUID guessing** | Attacker guesses UUID of another project's data | RLS blocks access regardless of valid UUID | ✅ Blocked |
| **SQL injection via event_key** | Malicious event_key bypasses policy | event_key is in data, not query; parameterized queries | ✅ Blocked |
| **Role escalation** | User tries to gain admin access | has_role_on_account checks actual membership | ✅ Blocked |
| **Cross-tenant enumeration** | Counting hidden rows | RLS returns empty set, not error | ✅ Blocked |
| **State modification** | Editing historical states | No UPDATE grant on append-only tables | ✅ Blocked |
| **Audit log deletion** | Deleting evidence of changes | No DELETE grant on state_deltas | ✅ Blocked |
| **FK bypass via orphan** | Creating record with non-existent FK | FK constraints + insert policy validates ownership | ✅ Blocked |

### Privilege Escalation Prevention

```sql
-- The has_role_on_account function signature:
CREATE OR REPLACE FUNCTION public.has_role_on_account(account_id uuid)
RETURNS boolean AS $$
  -- Returns TRUE only if auth.uid() is member of the account
  -- This is the single source of truth for access control
$$ SECURITY DEFINER;

-- Security considerations:
-- 1. Function is SECURITY DEFINER to access memberships table
-- 2. Always uses auth.uid() - cannot be spoofed
-- 3. No way to impersonate another user
-- 4. No way to claim membership in account you don't belong to
```

---

## Test Cases

### 1. Cross-Account Isolation Test

```sql
-- Setup: Two accounts with separate projects
-- User A in Account A with Project PA
-- User B in Account B with Project PB

-- Test as User A:
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "user-a-uuid"}';

-- Insert to own project (should succeed)
INSERT INTO public.immutable_events (project_id, event_type, event_key, established_in, season, episode_number, description)
VALUES ('project-a-uuid', 'death', 'character:x:dead', 'episode-uuid', 1, 1, 'Test');
-- Expected: SUCCESS

-- Insert to other project (should fail)
INSERT INTO public.immutable_events (project_id, event_type, event_key, established_in, season, episode_number, description)
VALUES ('project-b-uuid', 'death', 'character:y:dead', 'episode-uuid', 1, 1, 'Test');
-- Expected: ERROR (new row violates policy)

-- Select from other project (should return empty)
SELECT * FROM public.immutable_events WHERE project_id = 'project-b-uuid';
-- Expected: 0 rows
```

### 2. Append-Only Enforcement Test

```sql
-- Insert a character state
INSERT INTO public.character_states (...) VALUES (...);
-- Expected: SUCCESS

-- Try to update
UPDATE public.character_states SET state_type = 'physical' WHERE id = 'state-uuid';
-- Expected: ERROR - permission denied

-- Try to delete
DELETE FROM public.character_states WHERE id = 'state-uuid';
-- Expected: ERROR - permission denied
```

### 3. State Deltas Immutability Test

```sql
-- Insert a state delta
INSERT INTO public.state_deltas (episode_id, entity_type, entity_id, before_state, after_state)
VALUES ('episode-uuid', 'character', 'char-uuid', '{}', '{"state":"grieving"}');
-- Expected: SUCCESS

-- Attempt modification
UPDATE public.state_deltas SET after_state = '{"state":"happy"}';
-- Expected: ERROR - permission denied

-- Attempt deletion
DELETE FROM public.state_deltas WHERE id = 'delta-uuid';
-- Expected: ERROR - permission denied
```

### 4. Unauthenticated Access Test

```sql
-- As anonymous role
SET LOCAL ROLE anon;

SELECT * FROM public.immutable_events;
-- Expected: ERROR - permission denied (no grant to anon)

INSERT INTO public.immutable_events (...) VALUES (...);
-- Expected: ERROR - permission denied
```

---

## Security Notes

1. **Append-only tables**: `character_states` and `state_deltas` do not allow UPDATE or DELETE to preserve audit trail
2. **No service_role grants**: Policies are for authenticated users only
3. **Project isolation**: All access is scoped through project → account hierarchy
4. **Defense in depth**: Both GRANT and RLS policies provide redundant protection

---

## Acceptance Criteria

- [ ] All 6 tables have RLS enabled
- [ ] Appropriate GRANT statements for each table
- [ ] Append-only tables restricted to SELECT/INSERT
- [ ] Policies use existing `has_role_on_account` function
- [ ] No cross-project data leakage possible
- [ ] Attack vector analysis completed and all vectors mitigated
- [ ] Test cases documented for security validation

