---
spec_id: FILM-1718
title: Stage Diagnosis
status: DRAFT
effort: M
dependencies: FILM-1714, FILM-1715
---

# Stage Diagnosis

## 1. Overview

Five stage bands are more useful read together than separately. The pattern
across them names which part of the funnel is the constraint, which is the
question a creator actually has.

```
Reach        above
Hook         above
Attention    below
Transmission above
Audience     below
```

tells you what to change. A single composite score of the same five numbers
tells you nothing.

**This spec depends only on FILM-1714 and FILM-1715 — deliberately not on the
genome.** `metrics → diagnosis` must work from day one; `metrics + genome →
creative explanation` enriches it later. Coupling them would make the diagnosis
wait seven months for enough tagged videos to be meaningful.

## 2. The patterns

| Pattern | Diagnosis (what is measured) |
|---|---|
| Reach below, others above | Content signals are strong relative to distribution — investigate packaging and distribution |
| Reach above, rest weak | Distribution is not the constraint; content signals are weak relative to comparable videos |
| Hook above, Attention below | Openings hold, later retention is weaker than comparable videos |
| Attention above, Transmission below | Attention is strong; transmission is weaker relative to comparable videos |
| Attention and Transmission above, Audience below | Consumption is strong; follow conversion is weaker than comparable videos |
| All above | Strong across every measurable stage |

### The table is a precedence list, not a partition

The rows above are **ordered**, and the first match wins. They are deliberately
not mutually exclusive and not exhaustive:

- bands are three-valued (`below | typical | above`), and the rows are phrased
  only in `above`/`below` terms, so `typical` satisfies neither side
- combinations like *Reach below, Hook below, the rest above* match no row

So the contract is: **evaluate in order, first match wins, and a fully-judged
combination matching nothing yields `no_clear_pattern`** — a named outcome
distinct from §4's "too few judged stages". Both are absent states; they are
absent for different reasons and must not share a sentence.

`no_clear_pattern` is a real and common answer. A video whose five stages are
all `typical` has no diagnosis worth making, and saying so is better than
forcing it into the nearest row.

## 3. The wording is measurement, not cause

"Packaging is the limit" is an inference the metrics do not prove. The cause
could be packaging, timing, topic, seasonality, or a metric that is
under-reported on that platform.

So diagnosis **describes what was measured** and points at where to look.
Hypothesis belongs to the creative-insight layer above it, and causation
belongs only to an experiment.

```
measurement → diagnosis → hypothesis
```

never

```
measurement → pretend-causality
```

Concretely: "Attention is strong; transmission is weaker relative to comparable
videos" — not "enjoyed but not worth passing on", which asserts a viewer's
mental state from a share count.

## 4. Patterns over partial data

Most videos will not have five judged stages. A stage can be unbound (the
platform exposes no equivalent), dark (its inputs are not ingested),
`not_judgable` (too young), or `insufficient_cohort` (too few peers).

**A pattern must be computed over judged stages only, and must say how many it
had.** "Content is outperforming distribution" inferred from two judged stages
out of five is a different claim from the same sentence over five, and the
difference must be visible.

Where too few stages are judged to distinguish patterns, the diagnosis is a
named absent state — not the nearest matching pattern.

This is the same discipline as everything else in the phase: *cannot say* is a
real answer, and it never renders as a weak one.

## 5. Boundary with FILM-1616

FILM-1616 keeps a low-CTR flag (threshold `0.03`) and a retention-cliff flag in
the weekly diagnostics table, and states explicitly that they are **a breakage
check, not strategy** — "did something break this week", deliberately kept
visually distinct from the deep-dive cards, because "users will read a low-CTR
flag as a content verdict".

Two rules keep these from colliding:

- **The stage layer contains no absolute thresholds.** Every figure is relative
  to the channel's own cohort. Reach *benchmarks* CTR; it never *flags* it.
- **The diagnostics table gets no bands.** It keeps its absolute flags.

Same underlying number, two framings, and neither borrows the other's language.

## 6. Out of scope

- Explaining *why* a pattern occurred — FILM-1717.
- Any recommendation. This spec names the constraint; recommending a change
  requires evidence and belongs above.
- Rendering — FILM-1719.
- Cross-platform patterns. A pattern is computed within one platform, because
  its inputs are.

## 7. Acceptance criteria

- [ ] A pattern is computed from the set of judged stage bands
- [ ] The pattern set is closed, named, and exhaustively tested
- [ ] Patterns are evaluated in a documented precedence order, first match wins
- [ ] A fully-judged combination matching no pattern yields `no_clear_pattern`
- [ ] `no_clear_pattern` is distinguishable from "too few judged stages" — different causes, different sentences
- [ ] `typical` bands are handled explicitly, not treated as either `above` or `below`
- [ ] The number of judged stages is reported alongside the diagnosis
- [ ] Too few judged stages yields a named absent state, not the nearest pattern
- [ ] Unbound, dark, `not_judgable` and `insufficient_cohort` stages are excluded from the pattern and counted separately
- [ ] No diagnosis string asserts a cause or a viewer's mental state
- [ ] No diagnosis depends on the content genome
- [ ] No absolute threshold appears in this layer
- [ ] The diagnosis never contradicts the bands it was computed from
- [ ] A video with all stages dark produces a coverage statement, not a diagnosis

## 8. Verification

```bash
pnpm --filter @kit/content-analytics test
pnpm turbo typecheck --force && pnpm lint
```

Pure function over five optional bands — exhaustively testable without a
database, and it should be tested exhaustively rather than by example:

- every combination of five three-valued bands (3^5 = 243, plus the unjudged
  cases) resolves to exactly one outcome — a pattern, `no_clear_pattern`, or
  **If FILM-1726 adds a Monetisation stage this becomes 3^6 = 729.** The
  resolution must therefore be a function over the stage list, not an
  enumeration written against five — a constraint on the implementation, not a
  reason to wait for that decision.

  the too-few-judged state
- an all-`typical` video yields `no_clear_pattern`, not the nearest row
- a pattern computed over two judged stages is distinguishable in the output
  from the same pattern over five
- a stage that is dark and a stage that is `below` produce different patterns
- a snapshot test over the diagnosis strings, so causal language cannot be
  introduced without a reviewer seeing the diff

## 9. Risk

**The copy is the risk, not the logic.** The mapping is a small pure function;
the sentences are what users act on, and each is one edit away from becoming a
causal claim. The snapshot test in §8 exists so that edit is always visible in
review.

**Partial-data patterns are the subtle failure.** A confident sentence built on
two judged stages reads identically to one built on five unless the output
carries the count — and the count is the kind of detail that gets dropped
during UI work. FILM-1719 must render it.
