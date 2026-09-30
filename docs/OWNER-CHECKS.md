# Owner checks

Spec items that no test in this repository can settle, because they need a real
model, a real vendor account, a real device or a person's judgement. Each has a
number (`OC-n`), and the spec item it settles names that number. Everything a
test can prove is already a test; what is left is here, as a checklist you can
work through in one sitting per area.

**How to record a result.** Put one line under the check in this file, in the
form `2026-10-04 pass, 20 of 20 outputs parsed` or `2026-10-04 fail: <what you
saw>`. Then tick the spec item (`met: true`, `evidence: "docs/OWNER-CHECKS.md:<line>"`)
in the same PR. A failure is a known bug: file it under `specs/known-bugs/`.

**Never with production credentials.** Every check below runs against the local
stack or your own vendor test accounts. The runs that spend money say so.

## OC-1 · The model behaves (Gemini, the default) — about 45 minutes, a few cents

Run each prompt at least 20 times through the local job queue
(`./scripts/local-env.sh up`, then the studio flow in `apps/e2e/tests/sandbox/`,
or a script that calls `executeLLM` with the template).

| Spec item | Run | Pass |
|---|---|---|
| FILM-304 outputs are parseable JSON | 20 runs of each of the four story templates | 20 of 20 parse after the executor's retry, and the number that needed the retry is written down |
| FILM-304 deterministic structure, consistent format | the same 20 runs | every output validates against its Zod schema; a rejection is counted, not hidden |
| FILM-305 3 to 5 story ideas | 20 runs of story ideation on one premise | every run returns 3 to 5 ideas (the schema allows 1 to 5; a run with 1 or 2 is a failure of the prompt) |
| FILM-305 costs accurate | one story run; read the cost the app logs, then the vendor's usage page | within 10% |
| FILM-1122 unsourced claims marked `needs_source` | 20 claims, 10 with a source and 10 without | the 10 without are marked, and none of the 10 with is |
| FILM-1123 critical issues, unsourced claims, citation format | a fixture with three seeded faults (a false claim, an unsourced claim, a malformed citation) | each fault is reported; the malformed citation is only checked by the model, since the skill drops `citations_valid` |
| FILM-1133 anchor script is a valid broadcast script, claims attributed | 10 runs on a fixture rundown | each script has anchor, graphic and transition cues, and every claim names its source |
| FILM-1134 producer rundown is valid | 10 runs | each rundown validates; the total runtime is the model's own figure, since nothing reconciles it |

Results:

## OC-2 · Other vendors' models — 15 minutes, a few cents

FILM-304 says the templates work with Claude, GPT-4 and Gemini; all four pin
Gemini. Set `LLM_PROVIDER` to each of the other two with your test key, run
each template once, and note whether the output validates.

Results:

## OC-3 · Meta (Instagram and Facebook), your own test app — 30 minutes

| Spec item | Do | Pass |
|---|---|---|
| FILM-707 consent screen shows the right permissions | connect an Instagram Professional account from the Platforms page | the dialog lists exactly `instagram_basic`, `instagram_manage_insights` and `pages_read_engagement` |
| FILM-803 Reel plays, reach, impressions | run the analytics sync for one Reel | views and reach match Instagram's own insights within rounding |
| FILM-803 engagement | same Reel | likes, comments, saves and shares match |
| FILM-803 audience demographics | same account, once it has 100 followers | countries, cities and gender/age appear |

Results:

## OC-4 · TikTok, your own developer account — 20 minutes

FILM-802: connect a TikTok account and run the analytics sync for one video.
Views, likes, comments and shares match the TikTok app within rounding. Saves
and watch time stay empty, by design.

Results:

## OC-5 · X and LinkedIn sign-in — 20 minutes

FILM-714 and FILM-715: with your own developer apps, connect an X account and a
LinkedIn personal account from the Platforms page, then disconnect each. The
local stand-ins already prove the flow; this proves your credentials and
redirect URLs.

Results:

## OC-6 · Your channel's numbers — 20 minutes

| Spec item | Do | Pass |
|---|---|---|
| FILM-1504 | pick one video and one day; compare views, impressions and CTR on the analytics page with YouTube Studio | the same figures; write down whether CTR is a percentage or a ratio |
| FILM-1506 | after the hourly sync, count published videos and `video_dim` rows | equal |

Results:

## OC-7 · Live fetches — 10 minutes

| Spec item | Do | Pass |
|---|---|---|
| FILM-1121 DOI lookup fills the citation | add a fact with a real DOI (10.1038/171737a0) | title, authors and year fill in |
| FILM-1141 extracted facts appear in the Facts list | upload a short PDF and a URL on the Research page and wait for the job | the facts appear (text extraction from a URL is a test now) |

Results:

## OC-8 · Screen reader — 30 minutes, VoiceOver on macOS

FILM-DS-04, FILM-204 and FILM-207: with VoiceOver on, sign in, open the asset
gallery and upload an image. It announces the tabs and cards by name, and the
upload status while uploading (success is not announced today: note it).
Also walk the sidebar and confirm each section is announced by its label.

Results:

## OC-9 · High-contrast mode — 10 minutes

FILM-DS-04: turn on macOS Increase contrast (or Windows contrast themes), open
the studio, a form and the legal pages, and note anything unreadable.

Results:

## OC-10 · How long the slow jobs take — 30 minutes, a few dollars

Time each from the click to the result, on a project with a real screenplay:
story ideas under 15 s (FILM-305), full story under 30 s (FILM-305), screenplay
under 30 s (FILM-306), shot list under 40 s (FILM-307), one voice line under
30 s (FILM-501), a dialogue action's queueing under 60 s (FILM-502), and a
100-line batch under 10 minutes with 3 workers (FILM-503). Write the times down
whatever they are; a miss is a known bug.

Results:
