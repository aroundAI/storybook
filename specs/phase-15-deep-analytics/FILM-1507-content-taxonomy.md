---
spec_id: FILM-1507
title: Content Taxonomy & Tag-Level Analytics
status: ✅ DONE
effort: M
dependencies: FILM-1506
---

# Content Taxonomy & Tag-Level Analytics

## 1. Overview

`publishes.tags` is free-text SEO keywords — uncontrolled vocabulary never read by analytics. This spec adds a **controlled per-account taxonomy** (topic / format / thumbnail_style / hook_type), tagging UI with bulk backfill, and tag-level **median** analytics: individual video performance is mostly luck; tag-level medians across 30+ videos are signal.

`hook_type` is included now so FILM-1510's aggregate layer comes for free (per FILM-1301 §9.6 Hybrid decision).

## 2. Database Schema — `apps/web/supabase/schemas/68-content-taxonomy.sql`

```sql
create table if not exists public.content_tags (
  id uuid primary key default extensions.uuid_generate_v4(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  dimension varchar(30) not null,
  slug varchar(80) not null,
  label varchar(120) not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (account_id, dimension, slug),
  check (dimension in ('topic', 'format', 'thumbnail_style', 'hook_type'))
);

create table if not exists public.publish_tags (
  publish_id uuid not null references public.publishes(id) on delete cascade,
  tag_id uuid not null references public.content_tags(id) on delete cascade,
  primary key (publish_id, tag_id)
);
-- RLS: content_tags via has_role_on_account; publish_tags via publish → episode → project chain
-- (copy the policy pattern from 38-revenue-tracking.sql)
```

## 3. Implementation Map

| File | Purpose |
|------|---------|
| `packages/features/content-analytics/src/server/taxonomy-actions.ts` | `createTagAction`, `listTagsAction`, `setPublishTagsAction`, `bulkTagPublishesAction` — each calls `upsertVideoDims([publishIds])` so `video_dim.tags` ('dimension:slug' strings) stays fresh. |
| `packages/features/content-analytics/src/components/taxonomy/tag-manager.tsx` | Vocabulary CRUD per dimension. |
| `packages/features/content-analytics/src/components/taxonomy/tag-picker.tsx` | Multi-select per dimension for a publish. |
| Existing `content-table.tsx` | Tags column + bulk-tag toolbar (backfill surface). |
| `apps/web/app/home/[account]/studio/analytics/tags/page.tsx` | Taxonomy management route. |
| `getMedianByTagAction` (in `deep-dive-actions.ts`) | Wraps `queryMedianByTag`; returns `{ insufficientSample: true }` until the account has ≥ 30 tagged videos (playbook threshold); per-tag minimum from `analytics_settings.tag_min_sample`. |

## 4. Acceptance Criteria

- [ ] Tags are account-scoped, unique per (dimension, slug); RLS blocks other accounts
- [ ] Tagging/bulk-tagging updates `video_dim.tags` within the same action
- [ ] Median-by-tag groups correctly and respects `insufficientSample` gates
- [ ] Content table shows tags and supports bulk tagging of selected rows

## 5. Verification

```bash
pnpm --filter web supabase migration up && pnpm supabase:web:typegen
pnpm --filter @kit/content-analytics test
# Manual: create topic tags, bulk-tag 3 publishes, confirm video_dim.tags + median-by-tag rows.
```
