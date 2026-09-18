---
spec_id: FILM-1702
title: Language Dimension Reconciliation
status: DRAFT
effort: L
dependencies: FILM-1606
---

# Language Dimension Reconciliation

## 1. Overview

There are two `language` columns in this product, they mean different things,
different halves of the analytics feature read different ones, and nothing
reconciles them. On top of that, both default to `'en'`, which makes "English"
double as the bucket for *never set*.

**Source A — `publishes.language`.** `varchar(5) NOT NULL DEFAULT 'en'`, added
by `20251224180000_add_multi_language_analytics.sql:12-13` alongside
`dubbed_version_id`. This is the language of *this particular publish*.
`dim-sync.ts:47,163` selects it and writes it to `video_dim.language`, so it is
the value every ClickHouse query can filter on — `buildDimConditions`
(`queries-advanced.ts:139-142`) supports `scope.language`, and the raw CSV
export uses it (`apps/web/app/api/reports/scheduled/route.ts:371`).

**Source B — `platform_connections.language`.** `varchar(5) NOT NULL DEFAULT
'en'`, added by `20251223150000_add_platform_connection_language.sql:14-15` and
commented *"Target language for this channel"*. This is the language the
channel was created to serve. `server/language-analytics.ts` reads it at `:155`
and `:634`, maps connection → language at `:165`, then publish → language via
`publishes.platform_connection_id` at `:170-173`.

**The entire Language tab is built on Source B. Everything else is built on
Source A.** They agree only when routing worked. A publish that landed on the
wrong channel, or a channel carrying mixed content, makes them disagree
silently, and no surface exposes the disagreement.

## 2. English is also the unknown bucket

This is the part that invalidates conclusions rather than merely confusing
them.

Both columns are `NOT NULL DEFAULT 'en'`. The database therefore never stores
NULL, and a publish created without anyone choosing a language is recorded as
English, indistinguishably from one deliberately published in English. On top
of that the readers coalesce *again* — `language-analytics.ts:165` and `:644`
use `c.language || 'en'` (note `||`, so an empty string also becomes English),
and `dim-sync.ts:163` uses `row.language ?? 'en'`.

The consequence: **every "English outperforms" reading of the Language tab is
unfalsifiable**, because the English bucket contains both English content and
all content whose language nobody set. On a project that has never used the
dubbing pipeline, the English bucket is simply "everything".

The important detail for whoever implements this: it **cannot be fixed in the
readers**. Changing `'en'` to `'unknown'` in `language-analytics.ts` changes
nothing, because the value arriving from the database is already `'en'`. The
schema cannot currently express "never set". Fixing it requires either making
the column nullable or adopting a sentinel, plus a decision about what the
existing rows mean — and those existing rows are unrecoverable, since the
information was never captured.

That backfill decision is a judgement call about historical data and is the
reason this spec is L rather than M.

## 3. The decision: model both, default to the publish

Both columns are legitimate and answer different questions.

**For Source B (channel target).** It is the *editorial* dimension — the unit a
budget is allocated to, and the unit the Language tab's own question is about
("should we keep doing Spanish?"). It is non-null by construction for any
connected channel, it works for platforms that expose no per-asset language
metadata, and all six existing Language tab queries already use it.

**For Source A (publish).** It is the *asset* dimension, and the only one that
can be correct when one channel posts multiple languages — which is precisely
what the migration named `add_multi_language_analytics` says the product is
heading toward. It is what `video_dim.language` carries, so it is the only one
the ClickHouse layer can filter on, and therefore the only one that lets the
Language tab and the Deep Dive tab ever agree or cross-filter.

**Neither should be discarded.** Picking one arbitrates a product question by
fiat. Instead:

- `video_dim` gains `channel_language` beside the existing `language`, written
  by `dim-sync.ts` from the publish's connection.
- The Language tab's dimension becomes an explicit, visible toggle — **Content
  language** vs **Channel target language** — defaulting to content.
- The active choice is named on the card, so a reader always knows which
  question the number answers.
- The divergence becomes a *product surface*, not a bug: "N publishes whose
  language differs from their channel's target" is a routing diagnostic worth
  having.

This also moves the Language tab onto ClickHouse like every other tab, which is
what finally lets the platform filter reach it (FILM-1709).

## 4. Why this depends on FILM-1606

FILM-1606 replaces `queryMedianByTag` with
`querySegmentPerformance({ scope, segment: { kind: 'tag' | 'language' | 'content_type' | 'connection' } })`
— one SQL body, one `GROUP BY` selected from a closed lookup, measured at a
checkpoint age rather than as a lifetime sum. Its §2 already states that
"Language is not a `content_tags` dimension and must not be forced into one".

That is the query this spec's toggle should drive. Building a second
language-aggregation path here would recreate exactly the duplication this
spec exists to remove. If FILM-1606 has not landed, this spec waits.

## 5. Implementation map

| File | Change |
|------|--------|
| `apps/web/supabase/migrations/<timestamp>_publishes-language-default.sql` | The `default 'en'` decision from §2, whichever way it goes — a hand-written migration, mirrored into `schemas/30-film-studio.sql`. Not generated with `db diff` (root `CLAUDE.md`). |
| `packages/clickhouse/src/migrations/` | New migration adding `channel_language` to `video_dim`. |
| `packages/clickhouse/src/types.ts` | `VideoDim.channel_language`. |
| `packages/features/content-analytics/src/server/dim-sync.ts` | Resolve the connection's language and write it; stop coalescing to `'en'` if §2 changes the sentinel. |
| `packages/clickhouse/src/queries-advanced.ts` | `buildDimConditions` gains `channelLanguage`; `DimScope` gains the field. |
| `packages/features/content-analytics/src/server/language-analytics.ts` | Retire the Postgres connection-join path in favour of `querySegmentPerformance`. This is the bulk of the work — six queries. |
| `components/language-analytics-dashboard.tsx` | The dimension toggle, and passing it down. |
| `components/language-analytics-cards.tsx` | `LANGUAGE_NAMES`/`LANGUAGE_FLAGS` currently render flags only in the Platform × Language matrix header (`:285`); add the name, since a flag is not a language. |

## 6. Out of scope

- Re-shelling the Language tab's cards onto `AnalyticsCard` — FILM-1707.
- The provenance chip naming which dimension is active — FILM-1705 provides the
  chip; this spec provides the fact it displays.
- Making the platform filter reach the Language tab — FILM-1709.
- Any change to `dubbed_versions`, captions or the dubbing pipeline itself.

## 7. Acceptance criteria

- [ ] A publish whose language was never set is distinguishable from one deliberately in English, in the database and on screen
- [ ] The historical interpretation of existing `'en'` rows is recorded in this spec before any backfill runs
- [ ] `video_dim` carries both the publish language and the channel's target language
- [ ] The Language tab reports from ClickHouse, not from a Postgres connection join
- [ ] The Language tab and the Deep Dive tab, given the same scope and window, report the same figure for the same language
- [ ] The active dimension is named on screen; a reader never has to guess which language a percentage refers to
- [ ] Switching the dimension changes the numbers, and both settings are reachable
- [ ] Publishes whose language differs from their channel's target are countable, and that count is surfaced somewhere
- [ ] No reader coalesces a missing language to a real language code
- [ ] A language with too few videos to be meaningful renders dimmed with its n, per FILM-1606's convention, rather than being hidden

## 8. Verification

```bash
pnpm --filter @kit/content-analytics test
pnpm --filter @kit/clickhouse test
./scripts/local-env.sh verify
pnpm turbo typecheck --force && pnpm lint
```

The seeded fixture must include, and the tests must assert on:

- a publish with an explicitly set non-English language
- a publish whose language was never set
- a publish routed to a channel whose target language differs from its own
- a channel carrying two languages

Cross-check by hand that the Language tab and a Deep Dive query scoped to the
same language return the same number. They cannot today, which is the point.

## 9. Risk

**This spec will move numbers that are already on screen.** Separating unknown
from English will shrink the English bucket on essentially every existing
project, and any conclusion a user has drawn from the Language tab may reverse.
That is a correction, not a regression, but it needs to be communicated rather
than shipped quietly — and it is the reason §7 requires the historical
interpretation to be written down *before* the backfill, not after.

The second risk is scope creep into FILM-1606. If that spec's
`querySegmentPerformance` lands with a different shape than assumed here, this
spec's §5 needs revising rather than working around it.
