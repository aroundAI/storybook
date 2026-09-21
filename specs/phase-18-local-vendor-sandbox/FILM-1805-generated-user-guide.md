---
spec_id: FILM-1805
title: Generated User Guide
status: DRAFT
effort: L
dependencies: FILM-1804
---

# Generated User Guide

## 1. Why this exists

The product's user documentation describes a product that does not exist.
`docs/PRODUCT_DOCUMENTATION.md` tells users to connect Twitter and LinkedIn from
`/studio/[project]/platforms`; the in-app Keystatic docs
(`apps/web/content/documentation/publishing/platform-connections.mdoc`) say only
YouTube is supported and point at a "Settings → Integrations" menu. Neither has a
screenshot. Nothing regenerates them when the UI changes, so they drift the day
they are written.

With the sandbox, every user flow can be driven end to end. This spec turns those
same drives into the guide: steps and screenshots captured from the running
product, organised by flow and by persona, regenerated with one command.

## 2. The flow catalog

A checked-in `docs/user-guide/flows.yaml` is the source of truth. Each flow:

```yaml
- id: connect-a-platform
  title: Connect your channels
  route: /home/[account]/settings/platforms
  prerequisites: [create-team]
  personas: [alex, studio-spark, maria]
  why:
    alex: Every other feature assumes a connected channel.
    maria: The only step she needs before uploading.
  steps:
    - Open Settings → Platforms.
    - Choose a platform and approve access.
    - Confirm it shows as connected.
  success: The platform shows as connected, with its account name.
```

Every step names what the user does; the Playwright driver for that flow performs
exactly those steps and captures a screenshot after each. A step in the catalog
with no driver, or a driver step not in the catalog, fails generation — the same
bind-the-doc-to-the-code rule the rest of this repo uses.

## 3. Personas

Seeded from `specs/PRD.md` §3. The primary three:

| Persona | From the PRD | Journey through the product |
|---|---|---|
| **Alex** | Solo AI creator | Ideation → story → screenplay → visuals → audio → publish → read analytics |
| **Studio Spark** | Content studio | Team and roles → batch episodes → canon → multi-platform publishing → experiments |
| **Maria** | Traditional creator | Connect → upload and distribute → analytics |

Plus the PRD's secondary personas (brand/agency, educator, hobbyist) where a flow
genuinely differs for them.

A persona is concrete for the generator: a seeded account, a sandbox channel whose
performance profile fits it — a new channel for Alex, several established ones for
Studio Spark — and the set of flows it uses. Which persona uses which feature is
recorded in the catalog's `personas` and `why`. That is the "judge personas per
feature" step, and it is reviewed like code: a person decides it, the catalog
records it, the generator follows it.

## 4. Generation

- **Guide specs.** One Playwright spec per flow in `apps/e2e/tests/guide/`, gated
  behind `GUIDE=1` the way evidence specs are gated behind `CAPTURE_EVIDENCE=1`. Each
  runs its flow once per persona that uses it, against the sandbox.
- **Screenshots.** `NN-kebab-step.png`, the evidence-spec convention, at a fixed
  viewport and locale, into `docs/user-guide/img/<flow>/<persona>/`. The state
  *after* each action is captured, not only before it.
- **Pages.** A small generator writes:
  - `docs/user-guide/flows/<flow>.md` — the flow's steps with screenshots, and which
    personas use it and why;
  - `docs/user-guide/personas/<persona>.md` — the persona's whole journey, flows in
    order, linking to each flow page;
  - `docs/user-guide/README.md` — the index.
- **One command.** `pnpm guide:generate` brings up the sandbox, runs the guide specs,
  and writes the pages. A PR that changes a flow regenerates its pages and shows the
  image diff.

## 5. Prose, and the part about succeeding on social

Step text comes from the catalog, which a person writes. Where narrative is
LLM-drafted, it is marked `draft` in the page's frontmatter and stays marked until a
person reviews it. The generator never publishes unreviewed prose as final.

"How to succeed on social" is the part most at risk of overclaiming, so it is
bounded:

- **It explains what the product measures and how to read it**, organised around
  phase 17's five funnel stages — Reach, Hook, Attention, Transmission, Audience —
  and what each platform can and cannot report (the capability reference).
- **It makes no causal claim no experiment has supported.** "Videos with X do better"
  is not written unless an experiment in the product shows it. It shows *how to run
  that experiment* (FILM-1610, FILM-1724), which is the honest version of the advice.
- **Sandbox numbers are illustrative.** Every screenshot with figures carries a
  caption saying the data is simulated. Sandbox curves are invented; they are never
  presented as a benchmark for what good looks like.

## 6. Replacing the stale docs

`docs/PRODUCT_DOCUMENTATION.md` and `apps/web/content/documentation/*` are replaced
by the generated guide, or reduced to pointers at it, in the same change that first
generates it — two sources of user documentation is how the current ones drifted.
Rendering the markdown in the app's docs section is a follow-up, not this spec.

## 7. Out of scope

- In-app tours, onboarding UI, or a hosted guide site.
- Translating the guide.
- Anything beyond flows the sandbox can drive; FILM-1804's list decides which.

## 8. Acceptance criteria

- [ ] `flows.yaml` covers every flow FILM-1804 can drive, each with personas and why
- [ ] Each flow has a guide spec, and a catalog step without a driver step fails generation
- [ ] `pnpm guide:generate` produces flow pages, persona pages and an index with screenshots, from a clean checkout with the local environment up
- [ ] Every persona in the PRD's primary set has a journey page
- [ ] Every screenshot with figures is captioned as simulated data
- [ ] "Succeeding on social" makes no causal claim without a linked experiment, and is organised by the five funnel stages
- [ ] LLM-drafted prose is marked draft until reviewed
- [ ] The stale docs are replaced or reduced to pointers, in the same change

## 9. Verification

- Generate from a clean checkout and open the pages: each step's screenshot shows the
  state that step describes. Checked by a person on first generation, then by image
  diffs on each regeneration.
- Delete a step from a driver and regenerate: generation fails, naming the step.

## 10. Risk

**Screenshots of random data differ every run**, since the sandbox is random by
design. The image diffs will be noisy. The mitigation is that the guide is generated
deliberately, not on every build, and the reviewer checks layout and flow, not
figures.

**A guide that reads as advice.** Section 5's bounds are the mitigation, and they
are acceptance criteria, not style notes.
