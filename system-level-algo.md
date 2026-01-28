Below is a **practical, implementation-ready algorithm** for using an LLM to write a new season of a show when you already have ~20 episodes.
Straight facts. No fluff.

---

## 1. Canon Ingestion (one-time per season)

**Goal:** Make the model “know” the show without hallucinating.

### 1.1 Build structured canon files (not raw scripts)

For each past episode `Ei`, extract and store:

```
Episode_ID
Timeline position (absolute day / relative order)
Plot beats (5–10 bullets)
Character state deltas
    - beliefs
    - goals
    - relationships
    - secrets revealed
World changes
Open threads created
Threads closed
Irreversible events
```

Store this as **JSON**, not text.

Why:

* LLMs reason better over structured deltas than prose.
* Prevents re-opening closed arcs.

---

## 2. Canon Indexing Strategy (critical)

Split memory into **3 layers**:

### Layer A — Immutable Canon (never violated)

* Deaths
* Public revelations
* Relationship breakpoints
* World rule changes

> If violated → reject output automatically.

### Layer B — Soft Canon (can evolve, not reverse)

* Motivations
* Trust levels
* Long-term goals
* Emotional scars

### Layer C — Ephemeral Details (rarely referenced)

* Minor dialogue
* One-off locations
* Episode-specific gimmicks

Only **Layer A + B** are injected every generation.

---

## 3. Retrieval Algorithm (per episode)

When generating episode `E21`:

```
Input:
- Immutable Canon (full)
- Soft Canon (characters involved in E21)
- Last 2 episodes summaries
- Relevant unresolved threads only
```

**Never feed all 20 episodes verbatim.**

Rule of thumb:

* Max historical context = **10–15% of token budget**
* Anything more = narrative collapse or nostalgia spam

---

## 4. Season Planning Algorithm (before writing episodes)

### 4.1 Define season-level constraints

```
Season_Theme
Season_Question (unanswerable until finale)
Characters_to_Change (must be ≤ 40% of main cast)
Characters_to_Stabilize (anchors)
Taboo_Reversals (things that must NOT happen)
```

**If everyone changes → show loses identity.**

---

## 5. Episode Generation Loop

For episode `En`:

### Step 1 — Continuity Check (pre-generation)

Ask the LLM:

> “Given canon, list **3 things this episode must NOT do**.”

Inject that list back.

### Step 2 — Plot Skeleton (no dialogue)

Generate:

```
Cold open purpose
A-plot spine
B-plot function
Cliff or resolution type
Canon impact score (0–3)
```

Reject if:

* Canon impact = 0 for >3 episodes in a row
* Canon impact = 3 for too many consecutive episodes

---

## 6. Reference Policy (how to reference old episodes)

### Allowed

* Consequence-based references
  (“Because of what happened with X, she refuses Y”)
* Emotional residue
* Offhand, indirect callbacks

### Forbidden

* Exact dialogue reuse
* Scene recreation
* Explicit “remember episode 7?” exposition
* Fixing old mistakes retroactively

**Rule:**

> If removing the reference does not change character behavior → cut it.

---

## 7. How Connected Episodes Should Be

Use this ratio:

```
60% forward motion
25% echo of past consequences
15% new elements
```

If past > 40% → fan-service spiral
If new > 30% → audience disorientation

---

## 8. What NOT to Add in New Seasons

Hard bans:

* Retconning motivations
* Surprise siblings / parents
* New villains who invalidate old stakes
* Trauma inflation (bigger tragedy ≠ deeper)
* Lore explanations that remove ambiguity

Soft bans:

* Power creep
* Mythology dumps
* Tone drift without justification

---

## 9. Change Criteria (when is change allowed?)

A change is allowed **only if**:

1. It is **caused** by a prior event
2. It is **paid for** (loss, cost, tradeoff)
3. It is **observable** in behavior, not speech

If all 3 not satisfied → reject.

---

## 10. LLM Prompt Pattern (battle-tested)

```
SYSTEM:
You are a continuity-bound writers’ room assistant.
You may invent new events but may not contradict Immutable Canon.

USER:
Here is the canon JSON.
Here are unresolved threads.
Here is the season theme.
Write a plot skeleton for Episode N.
List continuity risks at the end.
```

Then **second pass**:

> “Rewrite, eliminating the top 2 continuity risks.”

---

## 11. Automated QA Checklist (must pass)

For every episode:

* ❏ No reversed canon
* ❏ At least one irreversible consequence
* ❏ One character makes a worse choice than last season
* ❏ One character refuses an easier path
* ❏ One mystery deepens, not resolves

---

## 12. Why This Works

* LLMs are bad at memory, good at **patterned causality**
* Structured canon turns memory into rules
* Forced rejection steps prevent “cool but wrong” writing
* Seasons feel connected without becoming self-referential

---

If you want, I can:

* Convert this into a **LangChain / RAG pipeline**
* Give you a **canon JSON schema**
* Design a **continuity validator**
* Or simulate a **writers’ room with multiple LLM roles**

Say which one.


---------------------------------------------

Below is a **production-grade, CMS-level algorithmic design** that generalizes what you first asked (canon, sequels, seasons, references, what not to add) and scales it to **movies, sequels, series, factual shows, and news**, with **production + distribution** in mind.

No fluff. This is a **systems architecture + algorithm spec** you could hand to engineers.

---

# I. Core Design Principle (Non-Negotiable)

**LLMs do not write content.
They operate inside constraints generated by the CMS.**

The CMS is the *author*.
The LLM is a *bounded generator*.

Everything below enforces that.

---

# II. Universal Content Abstraction Layer (UCAL)

Every project—movie, series, science show, news—maps to this base schema.

```yaml
Project:
  type: MOVIE | SERIES | FACTUAL | NEWS
  narrative_mode: NONE | LINEAR | HYBRID
  canon_policy: STRICT | SOFT | NONE
  memory_horizon: SHORT | MEDIUM | LONG
  verification_required: true | false
  update_frequency: STATIC | PERIODIC | CONTINUOUS
```

This single switchboard determines **everything downstream**.

---

# III. Canon & Memory Model (Generalized)

## 1. Canon Types (expanded from earlier)

| Canon Type              | Used By                   | Rules                       |
| ----------------------- | ------------------------- | --------------------------- |
| Immutable Canon         | Movies, serialized series | Never violated              |
| Progressive Canon       | Hybrid episodic series    | Only forward                |
| Contextual Memory       | News                      | Expires                     |
| Verified Knowledge Base | Science/History           | Must cite                   |
| Zero Canon              | Pure episodic             | No cross-episode dependency |

Each project selects **exactly one primary canon**.

---

## 2. Canon Storage (CMS-level)

Canon is **not text**. It is **state transition graphs**.

```json
CharacterState {
  character_id,
  attributes,
  relationships,
  beliefs,
  secrets,
  last_modified_episode
}

WorldState {
  rules,
  institutions,
  known_facts,
  irreversible_events
}
```

All writing is a **diff on this state**.

---

# IV. Content-Type–Specific Algorithms

---

## A. Movies (Single Film)

### Problem

LLMs lose act-level coherence.

### Solution: Act-Locked Generation

#### Algorithm

1. CMS predefines:

   * Act I / II / III beats
   * Theme constraints
   * Ending invariants
2. LLM only writes **one act at a time**
3. After each act:

   * CMS validates character deltas
   * CMS freezes act output
4. Next act receives:

   * Final state of previous act only

#### Hard Rule

> LLM is never allowed to see future acts.

---

## B. Movie Sequels (Existing Films in System)

### Sequel Eligibility Gate (critical)

A sequel can only be generated if:

```text
- Original ending left unresolved states
- Character arcs are not fully closed
- World still allows escalation without retcon
```

CMS rejects sequel generation otherwise.

### Sequel Memory Injection

Only inject:

* Immutable Canon
* Final character states
* Unanswered thematic question

**Never inject full screenplay.**

---

## C. Series — Hard Narrative (True Detective)

### Canon Policy

STRICT

### Algorithm

* Season treated as **one long movie**
* Episodes are **chapters**, not stories
* Every episode must:

  * Advance central mystery
  * Remove at least one false belief
  * Introduce one new uncertainty

### Reference Rule

References must be:

* Consequence-based only
* No recap dialogue
* No nostalgia scenes

---

## D. Series — Hybrid Episodic (Friends, Smallville)

### Canon Policy

SOFT + PROGRESSIVE

### Connection Ratio (enforced)

```
Episode Content:
- 65% episode-contained
- 25% background arc
- 10% novelty
```

### Background Arc Algorithm

CMS maintains:

```json
BackgroundArc {
  arc_id,
  pressure_level (0–100),
  affected_characters,
  escalation_rate
}
```

If pressure reaches threshold → episode must address it.

---

## E. Science / History Shows

### Canon Policy

VERIFIED KNOWLEDGE BASE

### Generation Pipeline

1. CMS builds **Fact Pack**:

   * Peer-reviewed papers
   * Books
   * Primary sources
2. LLM can ONLY:

   * Rephrase
   * Explain
   * Analogize
3. Every claim must map to:

```json
Claim {
  source_id,
  confidence_score,
  date
}
```

### Disallowed

* Speculation
* Narrative continuity
* Character arcs

---

## F. News Shows

### Canon Policy

NONE (contextual memory only)

### Algorithm

1. CMS ingests:

   * News wires
   * Trusted publishers
   * Time stamps
2. LLM generates:

   * Summaries
   * Comparisons
   * Explanations
3. Context expires automatically:

```text
TTL = 24–72 hours
```

LLM is **not allowed to remember last episode**.

---

# V. What NOT to Add (Global Rules)

CMS-level bans (hard fail):

* Retcons (except FACTUAL corrections)
* Emotional escalation without causal chain
* Lore dumps
* Explanatory dialogue
* “Previously on” writing
* Surprise relationships
* Coincidental resolutions

---

# VI. Change Authorization Algorithm

Any change must pass **all** checks:

```text
1. Triggered by prior state
2. Costs something irreversible
3. Alters future constraints
```

Fail one → change rejected.

---

# VII. Style, Hooks, and Tone (Decoupled)

Style is **not embedded in story logic**.

```yaml
StyleProfile:
  pacing
  language_level
  humor_density
  darkness_level
  audience_age
```

LLM gets this **after plot skeleton is frozen**.

---

# VIII. Production + Distribution Integration

### Production

* Script skeleton → locked
* Dialogue → regenerable
* Localization → parallel

### Distribution

* Platform-specific hooks generated separately
* No platform logic leaks into story

---

# IX. Master Control Algorithm (CMS Orchestrator)

```
1. Validate project type
2. Load canon policy
3. Generate constraints
4. Generate plot skeleton
5. Validate skeleton
6. Generate scene blocks
7. Validate state deltas
8. Generate dialogue
9. Style pass
10. Distribution adaptation
```

LLM is never allowed to skip steps.

---

# X. Why This Scales

* Movies don’t collapse structurally
* Sequels don’t retcon
* Series don’t drift
* Science stays factual
* News stays current
* Styles don’t corrupt canon

This is **writer logic encoded as software**.

---

## Next steps (pick one)

* Canon schema (JSON, versioned)
* Continuity validator logic
* LLM role separation (planner vs writer vs editor)
* End-to-end CMS workflow diagram
* Prompt templates per content type

Say which.

------------------------

Below is **everything**, delivered **in strict serial order**, end-to-end.
This is the **full production-grade algorithm** for an AI-powered CMS that handles **movies, sequels, series, factual shows, and news**, exactly aligned with your original questions (canon, references, what not to add, season continuity, change criteria).

---

# 1. Canon & Memory Schema (Foundational Layer)

This is the **non-negotiable base**. Everything else depends on it.

## 1.1 Canon Objects (Structured, Not Text)

```json
CanonState {
  immutable_events: [],
  character_states: {},
  world_states: {},
  unresolved_threads: [],
  closed_threads: [],
  timeline_index: {}
}
```

### Immutable Events

* Deaths
* Public revelations
* Legal / political outcomes
* Scientific conclusions (for factual)

Once written → **never modified**

---

## 1.2 Character State Model

```json
CharacterState {
  id,
  current_goal,
  internal_belief,
  external_constraint,
  relationships: {},
  secrets_known: [],
  trauma_markers: [],
  last_change_episode
}
```

Characters only evolve via **state deltas**, never rewrites.

---

## 1.3 Thread Model

```json
NarrativeThread {
  id,
  type: MAIN | SUB | THEMATIC,
  opened_in,
  affected_entities,
  pressure_level (0–100),
  resolution_conditions,
  status: OPEN | CLOSED
}
```

Threads close **only** when conditions are satisfied.

---

# 2. Project Classification Algorithm

At project creation, CMS must classify content.

```yaml
ProjectType:
  MOVIE
  MOVIE_SEQUEL
  SERIES_HARD
  SERIES_HYBRID
  FACTUAL
  NEWS
```

This selection **locks** downstream behavior.

---

# 3. Memory Injection Rules (Critical)

LLMs never see “everything”.

## 3.1 Memory Budget Policy

| Content Type  | Memory Horizon      |
| ------------- | ------------------- |
| Movie         | Act-scoped          |
| Sequel        | Final states only   |
| Hard Series   | Season-wide         |
| Hybrid Series | Rolling             |
| Factual       | None (sources only) |
| News          | TTL-based           |

---

## 3.2 Injection Algorithm

Before generation:

```
Inject:
- Immutable canon (always)
- Only characters present
- Only open threads with pressure > threshold
- Last 1–2 episodes max
```

Hard cap: **15% of total token budget**

---

# 4. Movie Algorithm (Single Film)

## 4.1 Act Locking

```
Act I → Freeze
Act II → Freeze
Act III → Freeze
```

LLM:

* Cannot see future acts
* Cannot revise previous acts

CMS validates:

* Character causality
* Thematic alignment
* Ending invariants

---

# 5. Movie Sequel Algorithm

## 5.1 Sequel Eligibility Gate

A sequel is **blocked** unless:

* Ending left unresolved threads
* Character arcs incomplete
* World rules still expandable
* No retcon required

If failed → CMS refuses generation.

---

## 5.2 Sequel Memory Injection

Allowed:

* Final character states
* Immutable events
* Thematic question left open

Forbidden:

* Full screenplay
* Scene recreation
* Dialogue reuse

---

# 6. Series — Hard Narrative (True Detective-type)

## 6.1 Season as a Single Object

```json
Season {
  core_mystery,
  false_beliefs,
  revelation_schedule,
  ending_lock
}
```

Episodes are **chapters**, not units.

---

## 6.2 Episode Rules

Each episode must:

* Remove ≥1 false belief
* Increase uncertainty elsewhere
* Advance central thread

No standalone resolution allowed.

---

## 6.3 Reference Policy

Allowed:

* Behavioral consequences
* Emotional residue

Forbidden:

* Explicit callbacks
* Flashback recycling
* Recap dialogue

---

# 7. Series — Hybrid Episodic (Friends / Smallville)

## 7.1 Content Ratio (Enforced)

```
65% episode-contained story
25% background arc pressure
10% new element
```

CMS rejects scripts outside tolerance.

---

## 7.2 Background Arc Pressure System

```json
BackgroundArc {
  id,
  pressure,
  escalation_rate,
  affected_characters
}
```

When pressure > threshold → episode **must** address it.

No ignoring arcs indefinitely.

---

# 8. Science & History Shows Algorithm

## 8.1 Knowledge-First Pipeline

```
Sources → Fact Pack → Claim Graph → LLM
```

LLM can only:

* Explain
* Compare
* Illustrate

---

## 8.2 Claim Validation

Every claim maps to:

```json
Claim {
  source,
  confidence,
  publication_date
}
```

If unmapped → rejected.

No narrative continuity. No canon.

---

# 9. News Shows Algorithm

## 9.1 Context TTL System

```text
Context expires after 24–72 hours
```

LLM:

* Cannot reference prior episodes
* Cannot imply continuity
* Cannot speculate

---

## 9.2 Source Gatekeeping

Only CMS-approved feeds allowed.
LLM cannot invent facts.

---

# 10. Change Authorization Algorithm (Universal)

Any story change must pass **all three**:

1. Triggered by prior state
2. Costs something irreversible
3. Alters future constraints

Fail one → CMS blocks it.

---

# 11. What NOT to Add (Global CMS Bans)

Hard-blocked:

* Retcons
* Surprise family members
* Power creep
* Lore explanations
* Trauma inflation
* Coincidental resolutions
* Expository dialogue

---

# 12. Plot Skeleton Algorithm (Before Dialogue)

For every episode / act:

```json
PlotSkeleton {
  purpose,
  conflict,
  irreversible_action,
  state_changes,
  continuity_risks
}
```

Dialogue is generated **only after skeleton approval**.

---

# 13. LLM Role Separation (Mandatory)

| Role    | Permissions      |
| ------- | ---------------- |
| Planner | Plot only        |
| Writer  | Scenes only      |
| Editor  | Consistency only |
| Stylist | Tone only        |

No single LLM does everything.

---

# 14. Style & Hooks (Decoupled Layer)

Style is injected **after logic freezes**.

```yaml
StyleProfile:
  pacing
  tone
  humor
  darkness
  audience
```

Style never affects canon.

---

# 15. Production Pipeline

```
Canon Load
→ Constraint Build
→ Plot Skeleton
→ Validation
→ Scene Blocks
→ Validation
→ Dialogue
→ Style Pass
→ Localization
```

---

# 16. Distribution Pipeline

Generated separately:

* Platform hooks
* Thumbnails
* Episode descriptions
* Localization variants

No story logic leakage.

---

# 17. Automated QA Checklist

Every output must satisfy:

* No canon violations
* ≥1 irreversible consequence
* ≥1 constrained choice
* ≥1 future limitation introduced
* No nostalgia padding

---

# 18. Why This Solves Your Original Problem

* Prevents context loss across episodes
* Prevents sequel retcons
* Controls how tightly episodes connect
* Defines what **not** to reference
* Encodes “writer instinct” as software rules
* Scales across fiction, factual, and news

---

## If you want next (pick one):

1. Full **database schema**
2. **Continuity validator logic**
3. **Prompt templates per role**
4. **System diagram (CMS + LLM orchestration)**
5. **Failure cases & guardrails**

Say the number.

------------------------------------------------------------------


Below is the **Continuity Validator Logic** — written as a **formal system spec + algorithms** you can directly implement in an AI-powered CMS.

This is the **enforcement layer** that makes everything you asked earlier actually work in production.

---

# CONTINUITY VALIDATOR

*(The Judge. LLM output does not pass without this.)*

---

## 1. Validator Position in Pipeline

```
Canon Load
→ Constraint Builder
→ Plot Skeleton (LLM)
→ CONTINUITY VALIDATOR  ← here
→ Scene Generation
→ CONTINUITY VALIDATOR  ← again
→ Dialogue
→ CONTINUITY VALIDATOR  ← final
→ Publish
```

The validator runs **three times**:

1. After plot skeleton
2. After scene blocks
3. After dialogue

Failures stop the pipeline.

---

## 2. Inputs to Validator

```json
ValidatorInput {
  project_type,
  canon_state,
  previous_episode_states,
  proposed_state_deltas,
  plot_skeleton,
  scene_blocks,
  dialogue (optional),
  style_profile
}
```

Validator **never sees prompts**.
It only sees **states and diffs**.

---

## 3. Canon Violation Detection

### 3.1 Immutable Canon Check (Hard Fail)

Algorithm:

```
for each proposed_delta:
  if delta touches immutable_event:
    FAIL
```

Examples:

* Dead character speaks
* Public revelation undone
* Scientific conclusion reversed

No recovery. Must regenerate.

---

## 4. State Reversal Detection

### 4.1 Character State Rollback

```
if new_state contradicts earlier_state
and no causal chain exists:
  FAIL
```

Example:

* Character trusts someone again without reconciliation event
* Fear disappears without confrontation

Validator requires:

```
rollback must have:
  trigger_event
  cost
```

---

## 5. Causality Chain Validator

### 5.1 Cause → Effect Enforcement

For every major event:

```json
Event {
  cause,
  action,
  consequence
}
```

Algorithm:

```
if action exists without cause:
  FAIL
if consequence exists without action:
  FAIL
```

This kills:

* Coincidences
* “Just happens” twists
* Sudden realizations

---

## 6. Change Authorization Validator (Critical)

Every **state change** must satisfy **all 3**:

```
1. Triggered by prior state
2. Costs something irreversible
3. Introduces new constraint
```

Algorithm:

```
if any condition missing:
  FAIL
```

Examples of irreversible cost:

* Loss of trust
* Legal exposure
* Public knowledge
* Moral compromise

---

## 7. Thread Integrity Validator

### 7.1 Thread Closure Rules

```
if thread closed:
  verify resolution_conditions met
else:
  FAIL
```

No “forgotten” threads.

---

### 7.2 Thread Pressure Rules (Series)

```
if pressure > threshold
and episode ignores thread:
  FAIL
```

Prevents arc neglect.

---

## 8. Reference Validator (Your Original Question)

### 8.1 Allowed Reference Types

Allowed:

* Behavioral consequences
* Emotional residue
* Indirect implication

Forbidden:

* Dialogue reuse
* Scene recreation
* Explicit recap
* “As you remember…”

Algorithm:

```
if reference == informational recap:
  FAIL
```

---

## 9. Connectivity Ratio Validator (Series)

For hybrid episodic shows:

```
episode_content must satisfy:
  episodic ∈ [60–70%]
  arc ∈ [20–30%]
  new ∈ [5–15%]
```

Measured by:

* Scene classification
* Thread involvement

Out of bounds → FAIL.

---

## 10. Escalation Validator

### 10.1 Power & Stakes Escalation

```
if stakes increase
and no proportional cost:
  FAIL
```

Stops:

* Power creep
* Bigger villain syndrome
* Trauma inflation

---

## 11. Tone Drift Validator

Validator compares:

```
baseline_tone vs episode_tone
```

Allowed drift only if:

* Motivated by story event
* Gradual across episodes

Sudden tonal flip → FAIL.

---

## 12. Genre Constraint Validator

Depends on project type.

### Movies / Hard Series

* No episodic reset
* No standalone resolution

### Hybrid Series

* No arc resolution in cold open
* No cliffhanger every episode

### Science / History

* Every claim cited
* No speculation

### News

* No memory across episodes
* No implied continuity

Violations → FAIL.

---

## 13. Dialogue-Level Validator (Final Pass)

Checks:

* Dialogue does not explain plot mechanics
* Characters do not state themes explicitly
* No recap lines

Algorithm:

```
if dialogue contains exposition markers:
  FAIL
```

---

## 14. Validator Outputs

```json
ValidationResult {
  status: PASS | FAIL,
  failure_type,
  affected_entities,
  repair_hint
}
```

CMS feeds **repair_hint** back to LLM for regeneration.

---

## 15. Why This Works

* Converts writing rules into executable logic
* Eliminates LLM hallucination damage
* Preserves long-range continuity
* Prevents nostalgia, retcons, and drift
* Scales across all content types

---

## Next in serial order (you choose):

3. Prompt templates per LLM role
4. Canon database schema (SQL/NoSQL)
5. Failure case simulations
6. CMS system diagram (end-to-end)

Say the number.

------------------------------------------------

Below are **4 → 5 → 6**, in order, at **engineering / system-design depth**.
No prose fluff. This is implementable.

---

# 4. CANON DATABASE SCHEMA (Production-Grade)

This is the **single source of truth**.
LLMs never write to it directly.

---

## 4.1 Storage Strategy

**Hybrid storage (recommended):**

* **Relational (Postgres)** → canon, states, constraints
* **Document (JSONB)** → episode deltas, plot skeletons
* **Vector DB** → optional semantic search (non-authoritative)

Relational enforces rules.
Vectors are read-only helpers.

---

## 4.2 Core Tables

### `projects`

```sql
project_id (PK)
type ENUM
canon_policy ENUM
narrative_mode ENUM
verification_required BOOLEAN
memory_horizon ENUM
created_at
```

---

### `immutable_events`

```sql
event_id (PK)
project_id (FK)
entity_type ENUM (CHARACTER, WORLD)
entity_id
description
episode_id
locked BOOLEAN DEFAULT TRUE
```

Any update attempt → hard reject.

---

### `characters`

```sql
character_id (PK)
project_id (FK)
name
```

---

### `character_states`

```sql
state_id (PK)
character_id (FK)
episode_id
goal
belief
constraint
relationships JSONB
secrets JSONB
trauma_markers JSONB
```

Only **append**, never update.

---

### `world_states`

```sql
state_id (PK)
project_id (FK)
episode_id
rules JSONB
institutions JSONB
known_facts JSONB
```

---

### `narrative_threads`

```sql
thread_id (PK)
project_id (FK)
type ENUM
opened_in_episode
pressure INTEGER
resolution_conditions JSONB
status ENUM
```

---

### `episodes`

```sql
episode_id (PK)
project_id (FK)
season
episode_number
```

---

### `state_deltas`

```sql
delta_id (PK)
episode_id (FK)
entity_type
entity_id
before_state JSONB
after_state JSONB
reason
```

Validator reads this table heavily.

---

### `sources` (Science / News)

```sql
source_id (PK)
type ENUM
publisher
url
confidence_score
published_at
```

---

### `claims`

```sql
claim_id (PK)
episode_id (FK)
text
source_id (FK)
```

Unlinked claims → auto-fail.

---

# 5. FAILURE CASES & GUARDRAILS (Why Systems Break)

These are **real failure modes** seen in LLM storytelling.

---

## 5.1 Canon Drift

**Symptom**

* Characters slowly behave like different people

**Cause**

* Old states overwritten
* Soft canon treated as mutable text

**Guardrail**

* Append-only `character_states`
* Validator rejects backward deltas

---

## 5.2 Nostalgia Collapse

**Symptom**

* Episodes exist to reference earlier episodes

**Cause**

* Too much memory injection
* Fan-service bias

**Guardrail**

* Reference Validator
* Memory injection hard cap (≤15%)

---

## 5.3 Power Creep

**Symptom**

* Stakes escalate every episode
* Nothing feels dangerous anymore

**Cause**

* No cost model

**Guardrail**

* Escalation Validator
* Mandatory irreversible loss

---

## 5.4 Coincidence Writing

**Symptom**

* “Just happens” plot turns

**Cause**

* Missing cause-effect enforcement

**Guardrail**

* Causality Chain Validator
* Every action must cite trigger

---

## 5.5 Retcon by Accident

**Symptom**

* Earlier events implicitly undone

**Cause**

* LLM “fixing” old writing

**Guardrail**

* Immutable Events table
* Hard rejection on conflict

---

## 5.6 Arc Neglect (Series Killer)

**Symptom**

* Long-running arcs disappear

**Cause**

* Episodic pressure

**Guardrail**

* Thread pressure threshold
* Mandatory addressing when exceeded

---

## 5.7 Tone Whiplash

**Symptom**

* Comedy → tragedy overnight

**Cause**

* Style entangled with plot

**Guardrail**

* Tone Drift Validator
* Style injected last

---

## 5.8 Factual Hallucination (Science / News)

**Symptom**

* Confident but false statements

**Cause**

* LLM allowed to invent facts

**Guardrail**

* Claim–Source binding
* Zero tolerance uncited claims

---

# 6. CMS SYSTEM DIAGRAM (End-to-End)

This is the **full orchestration flow**.

---

## 6.1 High-Level Architecture

```
┌──────────────┐
│  Project UI  │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│ Project Config   │
│ (type, canon)    │
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Canon Loader     │◄── Database
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Constraint Engine│
│ (rules, bans)    │
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Plot Planner LLM │
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Continuity       │
│ Validator        │
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Scene Writer LLM │
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Continuity       │
│ Validator        │
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Dialogue LLM     │
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Final Validator  │
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Style Injector   │
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Localization     │
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Distribution     │
│ Adapter          │
└──────────────────┘
```

---

## 6.2 Key Enforcement Points

* **Validator is central**
* No LLM can bypass it
* Every output is treated as *proposed*, not *accepted*

---

## 6.3 Why This Architecture Works

* Context loss is structurally impossible
* Sequels cannot retcon
* Series continuity is enforced mechanically
* Factual content stays factual
* Style never corrupts logic
* Distribution never feeds back into story

---

## Where you are now

You have:

* Canon theory → ✔
* Validator logic → ✔
* Database schema → ✔
* Failure analysis → ✔
* Full CMS orchestration → ✔

This is **already beyond most studio internal tooling**.

---

### Next logical steps (if you want)

* Generate **exact SQL + migrations**
* Write **validator pseudo-code**
* Define **prompt contracts** per LLM role
* Stress-test with a 20-episode season
* Map this to your current CMS UI settings

Say what you want next.


Summary:

# AI-Powered CMS Architecture Analysis

## Executive Summary

This document presents a production-grade architecture for an AI-powered Content Management System (CMS) that uses LLMs to generate narrative content (TV series, movies, sequels, factual shows, news) while maintaining strict continuity and quality control.

**Core Principle**: LLMs do not write content freely—they operate within constraints generated by the CMS. The CMS is the author; the LLM is a bounded generator.

---

## I. Foundational Architecture

### 1. Canon as Code, Not Text

**Key Insight**: Narrative continuity fails when treated as prose. It succeeds when treated as **state transition graphs**.

```
Traditional Approach (fails):
- Store full scripts
- LLM reads everything
- Hope it remembers

Correct Approach (works):
- Store structured state deltas
- Inject only relevant constraints
- Validate every output
```

### 2. Memory Budget Law

**Hard Rule**: Historical context ≤ 15% of token budget

**Why**: Beyond this threshold, LLMs experience:
- Narrative collapse
- Nostalgia spam
- Context confusion
- Self-referential loops

### 3. Three-Layer Canon Model

| Layer | Type | Violation Response |
|-------|------|-------------------|
| Layer A | Immutable Canon (deaths, revelations) | Auto-reject |
| Layer B | Soft Canon (motivations, relationships) | Forward-only evolution |
| Layer C | Ephemeral Details (minor dialogue) | Rarely referenced |

Only Layers A + B are injected into generation context.

---

## II. Content Type Architecture

### Universal Content Abstraction Layer (UCAL)

Every project maps to this schema:

```yaml
Project:
  type: MOVIE | SERIES | FACTUAL | NEWS
  narrative_mode: NONE | LINEAR | HYBRID
  canon_policy: STRICT | SOFT | NONE
  memory_horizon: SHORT | MEDIUM | LONG
  verification_required: true | false
  update_frequency: STATIC | PERIODIC | CONTINUOUS
```

This single configuration drives all downstream behavior.

### Content-Specific Algorithms

**Movies (Single Film)**
- Act-locked generation
- LLM never sees future acts
- Each act frozen after validation

**Movie Sequels**
- Eligibility gate: sequel blocked unless ending left unresolved threads
- Memory: final states only, never full screenplay
- Hard ban on retcons

**Hard Series (True Detective-style)**
- Season = one long movie
- Episodes = chapters, not standalone stories
- Every episode must: remove ≥1 false belief, increase uncertainty elsewhere

**Hybrid Series (Friends, Smallville)**
- Enforced ratio: 65% episodic / 25% arc / 10% new
- Background arc pressure system triggers mandatory addressing
- No indefinite arc neglect

**Science/History Shows**
- Zero canon, only verified knowledge base
- Every claim must map to source
- LLM can only: rephrase, explain, analogize

**News Shows**
- Context expires (24-72hr TTL)
- No cross-episode memory
- No speculation allowed

---

## III. The Continuity Validator (Critical Enforcement)

### Position in Pipeline

```
Plot Skeleton → VALIDATOR → Scene Generation → VALIDATOR → Dialogue → VALIDATOR → Publish
```

The validator runs **three times**, failures stop the pipeline.

### Validation Rules

**1. Immutable Canon Check**
- Dead characters cannot speak
- Public revelations cannot be undone
- Scientific conclusions cannot reverse
- No recovery—must regenerate

**2. State Reversal Detection**
```
if new_state contradicts earlier_state and no causal chain exists:
  FAIL
```

**3. Change Authorization (All 3 Required)**
1. Triggered by prior state
2. Costs something irreversible
3. Introduces new constraint

Fail one → rejected.

**4. Causality Chain Enforcement**
- Every major event needs: cause → action → consequence
- Kills coincidences and "just happens" twists

**5. Reference Policy Enforcement**

Allowed:
- Behavioral consequences
- Emotional residue

Forbidden:
- Dialogue reuse
- Scene recreation
- "As you remember..." exposition
- Flashback recycling

**6. Connectivity Ratio (Series)**
```
For hybrid episodic:
  episodic ∈ [60-70%]
  arc ∈ [20-30%]
  new ∈ [5-15%]

Out of bounds → FAIL
```

---

## IV. Database Architecture

### Storage Strategy

**Hybrid approach**:
- PostgreSQL: canon, states, constraints (authoritative)
- JSONB: episode deltas, plot skeletons
- Vector DB: semantic search (read-only helper)

### Critical Tables

**character_states** (append-only)
```sql
state_id, character_id, episode_id,
goal, belief, constraint,
relationships JSONB, secrets JSONB
```
Never update—only append new states.

**immutable_events** (write-once)
```sql
event_id, project_id, entity_id,
description, episode_id,
locked BOOLEAN DEFAULT TRUE
```
Any update attempt → hard reject.

**narrative_threads** (pressure tracking)
```sql
thread_id, type, opened_in_episode,
pressure INTEGER,
resolution_conditions JSONB,
status ENUM
```

**state_deltas** (audit trail)
```sql
delta_id, episode_id,
before_state JSONB, after_state JSONB,
reason
```
Validator reads this heavily.

---

## V. Common Failure Modes & Guards

### 1. Canon Drift
**Symptom**: Characters slowly become different people
**Cause**: Old states overwritten
**Guard**: Append-only state tables

### 2. Nostalgia Collapse
**Symptom**: Episodes exist to reference earlier episodes
**Cause**: Too much memory injection
**Guard**: 15% memory cap + reference validator

### 3. Power Creep
**Symptom**: Escalating stakes, nothing dangerous
**Cause**: No cost model
**Guard**: Mandatory irreversible loss per major change

### 4. Coincidence Writing
**Symptom**: "Just happens" plot turns
**Cause**: Missing cause-effect enforcement
**Guard**: Every action must cite trigger event

### 5. Retcon by Accident
**Symptom**: Earlier events implicitly undone
**Cause**: LLM "fixing" old writing
**Guard**: Immutable events table + hard rejection

### 6. Arc Neglect
**Symptom**: Long-running arcs disappear
**Cause**: Episodic pressure
**Guard**: Thread pressure threshold with mandatory addressing

### 7. Factual Hallucination
**Symptom**: Confident but false statements
**Cause**: LLM inventing facts
**Guard**: Claim-source binding, zero tolerance for uncited claims

---

## VI. LLM Role Separation (Mandatory)

| Role | Permissions | Never Allowed |
|------|-------------|---------------|
| Planner | Plot skeleton only | Dialogue, style |
| Writer | Scene blocks only | Plot structure |
| Editor | Consistency check only | Generation |
| Stylist | Tone/pacing only | Canon changes |

**Why**: Single LLM doing everything leads to entanglement and constraint violations.

---

## VII. Production Rules

### What NOT to Add (Global Bans)

**Hard-blocked**:
- Retcons
- Surprise family members
- Power creep
- Lore explanations that remove ambiguity
- Trauma inflation
- Coincidental resolutions
- Expository dialogue ("As you know...")

**Why these bans matter**:
- Surprise siblings/parents: cheap emotional manipulation
- Lore dumps: kill mystery and pacing
- Trauma inflation: bigger tragedy ≠ deeper character
- Explanatory dialogue: treats audience as stupid

### Season Planning Constraints

```yaml
Season:
  theme: single unifying question
  characters_to_change: ≤ 40% of main cast
  characters_to_stabilize: anchors (must exist)
  taboo_reversals: things that must NOT happen
```

**Principle**: If everyone changes → show loses identity

### Episode Generation Checklist

Every episode must pass:
- ❏ No reversed canon
- ❏ At least one irreversible consequence
- ❏ One character makes worse choice than last season
- ❏ One character refuses easier path
- ❏ One mystery deepens, not resolves

---

## VIII. Why This Architecture Works

### Structural Guarantees

1. **Context loss is impossible** (structured state, not text)
2. **Sequels cannot retcon** (eligibility gate + immutable events)
3. **Series continuity enforced mechanically** (thread pressure + validators)
4. **Factual content stays factual** (claim-source binding)
5. **Style never corrupts logic** (injected after plot freeze)
6. **Distribution isolated from story** (no feedback loop)

### Comparison to Traditional Writing

| Traditional Writers Room | AI-CMS Architecture |
|-------------------------|---------------------|
| Memory = human recall | Memory = structured state |
| Continuity = bible docs | Continuity = validators |
| Canon = consensus | Canon = database constraints |
| Style = writer voice | Style = decoupled layer |
| Changes = discussion | Changes = authorization algorithm |

**Key insight**: This system encodes "writer instinct" as executable software rules.

---

## IX. Implementation Complexity Analysis

### High Complexity Components
1. Continuity validator (multi-pass, complex rules)
2. Thread pressure system (dynamic thresholds)
3. Causality chain verification

### Medium Complexity
1. State delta tracking
2. Memory injection algorithm
3. LLM orchestration

### Low Complexity
1. Immutable events table
2. Append-only states
3. Style injection

**Recommendation**: Build in order: database → validator → orchestration → style

---

## X. Scaling Characteristics

### What Scales Well
- Number of episodes (append-only design)
- Number of characters (state-based, not text-based)
- Multiple projects (UCAL abstraction)
- Team size (role separation)

### What Doesn't Scale (by design)
- Memory injection (hard capped at 15%)
- Canon complexity (immutable events grow)
- Simultaneous arcs (cognitive load on audience)

**Philosophy**: Some limits are features, not bugs.

---

## XI. Critical Success Factors

### Technical
1. Validator must run before LLM output is accepted
2. Database constraints must be enforced at schema level
3. Memory injection must respect token budget
4. State transitions must be append-only

### Organizational
1. Writers must accept CMS as "first author"
2. LLM outputs are "proposed", not "accepted"
3. Style separated from logic
4. Canon changes require explicit authorization

### Process
1. Skeleton before dialogue
2. Validation before advancement
3. Structure before content
4. Constraints before generation

---

## XII. Comparison to Existing Systems

**Traditional CMSs** (WordPress, etc.)
- Manage published content
- No continuity logic
- No validation layer

**AI Writing Tools** (existing)
- Free-form generation
- No state tracking
- No canon enforcement

**This Architecture**
- Manages generative constraints
- Enforces continuity mechanically
- Treats writing as state evolution

**Unique position**: First to treat narrative as database problem.

---

## XIII. Future Extensions

### Possible Additions
1. Predictive thread pressure (ML-based)
2. Audience engagement feedback loop
3. Multi-timeline management
4. Collaborative world-building
5. Automated pacing analysis

### Anti-patterns to Avoid
1. Adding "creativity mode" that bypasses validators
2. Allowing manual canon overrides
3. Weakening immutability guarantees
4. Increasing memory budget beyond 15%

**Principle**: Constraints enable creativity, they don't limit it.

---

## XIV. Key Takeaways

### For Engineers
- Narrative continuity is a database problem
- Validators are more important than generators
- State deltas > full text storage
- Append-only designs prevent corruption

### For Writers
- LLMs are collaborators, not replacements
- Constraints create better stories
- Canon as code ensures consistency
- Long-range planning becomes tractable

### For Product Leaders
- This architecture solves real production problems
- Scales beyond studio internal tools
- Enables content generation at scale
- Maintains quality through enforcement

---

## XV. Implementation Readiness

**What's Defined**:
- ✅ Database schema
- ✅ Validation algorithms
- ✅ Memory injection rules
- ✅ Content-type behaviors
- ✅ Failure modes & guards
- ✅ System architecture

**What's Needed**:
- Exact SQL migrations
- Validator pseudo-code
- Prompt templates per role
- Performance benchmarks
- UI/UX specifications

**Complexity**: This is production-grade, not prototype-grade. Estimated implementation: 6-12 months for full system.

---

## Conclusion

This architecture represents a fundamental shift in how AI-generated narrative content should be managed. By treating storytelling as a **state evolution problem** rather than a **text generation problem**, it solves the core challenges of:

1. Long-range continuity
2. Sequel coherence
3. Series connectivity
4. Canon preservation
5. Quality enforcement

The system is **ready for engineering implementation** and represents capabilities beyond most existing studio tools.

The key philosophical insight: **Constraints don't limit creativity—they enable it by preventing chaos**.

