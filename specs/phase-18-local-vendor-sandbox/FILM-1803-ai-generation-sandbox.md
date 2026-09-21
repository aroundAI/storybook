---
spec_id: FILM-1803
title: AI Generation Sandbox
status: DRAFT
effort: L
dependencies: FILM-1801
---

# AI Generation Sandbox

## 1. Overview

Local stand-ins for the AI vendors the studio pipeline calls, so ideation, story,
screenplay, shot list and audio can be run end to end on a laptop — without API
spend, without keys, and with outputs that are random but always consumable by the
next stage. It runs in the same process as FILM-1802, on its own ports.

| Port | Serves | How the app reaches it |
|---|---|---|
| 4110 | OpenAI-compatible: chat completions, Whisper transcription, embeddings | `OPENAI_BASE_URL` — honoured by the `openai` SDK today |
| 4111 | Anthropic-compatible: messages | `ANTHROPIC_BASE_URL` — honoured by `@anthropic-ai/sdk` today |
| 4112 | Gemini-compatible: `generateContent` | `GOOGLE_GEMINI_BASE_URL` — honoured by `@google/genai` today |
| 4113 | ElevenLabs, PlayHT, Suno, Udio | FILM-1801 (their `baseUrl` option exists but is unwired) |
| 4114 | Sync Labs lip-sync | `SYNCLABS_BASE_URL` — honoured today |
| 4115 | Voyage embeddings | FILM-1801 |

DeepSeek goes through FILM-1801 because it hardcodes a `baseURL` that beats
`OPENAI_BASE_URL`.

## 2. The hard part: LLM output the app will accept

Random prose is easy. The pipeline, though, parses and validates what the LLM
returns, so random output must be **the right shape for the prompt that asked**.
Measured across the 29 prompt files in
`packages/features/prompt-engine/src/prompts/`:

| Output declared as | Prompts | How the sandbox generates |
|---|---|---|
| `schema: { type: 'zod', definition }` | 16 | Compile the definition exactly as `llm-executor.ts` does (it evaluates the string with `z` in scope, then `schemaFn.parse`), and generate data from that schema. The output passes the app's own validation by construction |
| A JSON Schema object | 4 | Generate from the JSON Schema |
| Only `schema_for_llm` (a human-readable string) | 7 | Hand-written per-slug template |
| Nothing | 2 | Hand-written per-slug template |

None of the nine without a machine-readable schema has an `example_output` to fall
back on, so the templates are real work: nine small generators, each checked by
feeding its output through the same parsing path the app uses.

**Identifying the prompt.** The request carries the rendered prompt, not the slug.
The sandbox loads the same prompt files at start and matches a request to a slug by
its system prompt, before variable substitution. A request that matches nothing is
answered with a generic response *and logged loudly*, so a new prompt without a
generator is noticed rather than silently fed nonsense.

**Content.** Text is drawn from a small checked-in corpus, randomized per run, with
the requested structure — character names consistent within one generated story,
scene counts matching what the screenplay asked for. It needs to be coherent enough
for the next stage to consume and for a screenshot to look like the product. It
does not need to be good writing, and it is labelled as sandbox output.

## 3. Audio and embeddings

- **TTS and music** (ElevenLabs, PlayHT, Suno, Udio) return a short valid audio file
  of roughly the requested duration, with the voice and metadata the request named,
  so waveform, duration and timeline code paths all run. The files are generated
  locally (silence or a tone); nothing is downloaded.
- **Voice cloning** returns a new voice ID that later TTS calls accept.
- **Lip-sync** returns a job that completes after a short delay with a valid video
  URL served by the sandbox.
- **Embeddings** return vectors of the dimension the real model returns, random but
  stable for identical input within a run, so similarity search behaves.

## 4. What this cannot reach

- **Video generation.** There is no video-generation client:
  `packages/features/jobs/src/workers/manager.ts:44-50` is a stub. Nothing to point at
  a sandbox until one exists.
- **SQS-backed workers.** The LLM, voice and render lambdas consume SQS queues with no
  local equivalent, and their senders fail without queue URLs. Studio actions that
  enqueue rather than call inline are out of reach until a local queue exists. The
  first task under this spec is to list, per studio stage, whether it calls inline or
  enqueues — that list decides what FILM-1804 can drive.
- **Quality.** Nothing here says whether a real model would produce good output. The
  sandbox exercises the pipeline, not the prompts.

## 5. Out of scope

- Social platforms — FILM-1802.
- Research APIs (Brave, NewsAPI, Semantic Scholar, archive.org, Crossref): not AI
  generation. A later spec, if wanted.
- Evaluating prompt quality or model choice.

## 6. Acceptance criteria

- [ ] With `local.env` loaded, no studio flow reaches a real AI vendor
- [ ] Each of the 16 Zod-declared prompts gets output that passes the app's own `schemaFn.parse`
- [ ] Each of the 4 JSON-Schema prompts gets output valid against its schema
- [ ] Each of the 9 schema-less prompts has a template, and its output parses through the app's path
- [ ] An unrecognised prompt is answered and logged as unrecognised, never silently
- [ ] A new prompt file added without a generator fails a sandbox test, not a demo
- [ ] Audio responses are valid files of roughly the requested duration
- [ ] Embeddings have the real model's dimension, and identical input gives the identical vector within a run
- [ ] The inline-vs-enqueued list per studio stage exists and is linked from FILM-1804

## 7. Verification

- A sandbox test loads every prompt file, generates a response for each, and runs it
  through the prompt engine's parsing and validation. All 29 must pass.
- Drive ideation → story → screenplay → shot list in the local app with `local.env`
  loaded, and confirm no request left the machine: the sandbox ledger shows every
  call, and nothing is sent to a real vendor host.

## 8. Risk

**Schema drift.** A prompt's schema changes and its generator does not. For the 16
Zod prompts this cannot happen, because the sandbox compiles the same definition the
executor validates with. For the 13 others, the every-prompt test in §7 is the
guard.

**Shared trust boundary.** The sandbox evaluates schema definitions the same way the
executor does. The definitions are checked-in files, so this is the same trust the
app already extends to them — but if prompt templates ever become editable from the
UI, both need revisiting together.
