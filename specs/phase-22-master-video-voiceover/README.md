# Phase 22: Master-video voiceover — upload the video, get the voices

A second way to make an episode. The creator already has the picture: a
video rendered in Remotion, and a subtitle file in which every line carries
its speaker, its timing and its emotion. StoryBook's job is to make that
video speak: voice every line with ElevenLabs, in the character's voice and
the tagged emotion, fitted to the subtitle's timing, and hand back something
that drops onto the video with no editing. Ideation, Story, Screenplay and
the Shot List are skipped, because the video already exists.

## The problem, in one table

Read 2026-10-06 on `main` at `ff3e56b`:

| | Today | Consequence |
|---|---|---|
| How an episode starts | Always Ideation → Story → Screenplay → Shot List → Audio. `getTabUnlockState` in `episode-workspace-tabs.tsx` opens Audio only once a shot list exists | A finished Remotion video has no way in; the creator would have to fake a screenplay and a shot list |
| Master video | `episodes.master_video_asset_id` exists, uploaded from the Publish tab's `master-asset-manager.tsx`, described as "for record keeping" | The video can be uploaded, but nothing uses it |
| Subtitles | `captions` and `caption_segments` exist; SRT is only *written*, from `dialogue_lines` (`captions-actions.ts`). No SRT, VTT or JSON parser | An emotion-tagged subtitle file cannot be read |
| Dialogue | `dialogue_lines` has `character_name`, `emotion`, `timeline_start_seconds`, and `shot_id` is optional | A subtitle cue maps onto a dialogue line with no schema change to its core |
| ElevenLabs | Plain `POST /v1/text-to-speech/{voice}` in `lambda/voice-worker/voice-generation.ts`. `[...]`, `(...)` and `*...*` are stripped from the text before the call, `emotion` is never sent, and duration is *estimated* at 150 wpm | The emotion tags the creator wrote are thrown away, and nobody knows whether a line fits its cue |
| Voices | `character_details.elevenlabs_voice_id` per character; `voice_profiles` is deprecated | A series' cast exists only through character assets, which a voiceover-only channel does not have |
| Putting audio on video | None on the server. FILM-607's guard (`film-607-edit-suite-retired.test.ts`) bars `ffmpeg-static` and a render worker from the web app. StorybookStudio (Phase 20) mixes, ducks and renders on the creator's machine | StoryBook voices the lines; the Studio or the creator's own Remotion render puts them under the picture |

## The new flow

```
 Remotion (creator's machine)          StoryBook (Phase 22)                         Out
┌──────────────────────────┐   ┌───────────────────────────────────────────┐   ┌──────────────────────────────┐
│ master.mp4               │──▶│ 1. Master   upload video + subtitles      │   │ A. Studio: master video +     │
│ subtitles.json / .srt    │──▶│             (FILM-2201, FILM-2202)        │   │    dialogue lane → mixed,     │
│   speaker, emotion,      │   │ 2. Cast     speaker → ElevenLabs voice,   │   │    ducked, QA'd render →      │
│   start, end, text       │   │             from the series' voice format │──▶│    deliver_edit (FILM-2210)   │
└──────────────────────────┘   │             (FILM-2203)                   │   │                              │
              ▲                │ 3. Voice    eleven_v3 per cue, emotion →  │   │ B. Remotion: voiceover.json + │
              │                │             audio tags, measured length,  │──▶│    per-line files; <Audio> at │
              │                │             fit to the cue (FILM-2204)    │   │    each cue (FILM-2206)       │
              │                │ 4. Review   video plays with the voices;  │   └──────────────────────────────┘
              │                │             regenerate, retime, approve   │
              │                │             (FILM-2205)                   │
              └────────────────┤ timings.json: "fit the video to the audio"│
                               │ when a line cannot fit its cue (FILM-2206)│
                               └───────────────────────────────────────────┘
```

**Upload.** The creator chooses "Master video" when creating the episode. The
Master tab takes the video (presigned R2 upload, as the Publish tab does today)
and the subtitle file. The cues are parsed, checked against the video's
length, and written as `caption_segments` (the subtitles as given) and as
`dialogue_lines` (one per spoken cue, `timeline_start_seconds` = cue start,
`emotion` and `character_name` from the tags).

**Cast.** Each speaker found in the file is matched to a voice in the series'
voice format: Babu to Babu's voice, NARRATOR to the narrator. An unknown
speaker is the one question the creator is asked before voicing.

**Voice.** One job voices every line with the account's ElevenLabs key on
`eleven_v3`, the emotion becoming audio tags (`[whispers]`, `[excited]`,
`[sighs]`), each line measured, not estimated. A line longer than its cue is
retried faster within limits, then flagged.

**Review.** The episode's video plays in the browser with the voiced lines
scheduled at their cues, no mixing involved. Every line can be played alone,
regenerated, re-tagged or nudged; approving the voiceover unlocks the output.

**Out.** Either (A) "Open in Studio": the edit package carries the master
video as the picture and the lines on the dialogue bus; the Studio's
existing rough cut, ducking, QA and delivery finish it and `deliver_edit`
marks the episode ready. Or (B) "Download for Remotion": a `voiceover.json`
and the line files, which a three-line `<Sequence><Audio/></Sequence>` loop
in the composition places. When lines did not fit, the same download carries
`timings.json`, the cue times the audio needs, so the creator can re-render
the video to the voice instead of squeezing the voice to the video.

## Formats (series presets)

Each of these is a project (series) with a voice format (FILM-2203). The
format is a starting template: cast slots, default model and emotion style,
pacing and the audio tags it expects. Every value is editable per series.

| Format | Shape | Cast slots | Voice direction |
|---|---|---|---|
| Babu Chondro: Algorithms of Life | Single narrator, reflective | Babu | Warm, measured, small pauses; `[thoughtful]`, `[chuckles]` |
| Cassy (history teacher) | Single presenter, explanatory | Cassy | Clear, animated on dates and twists; `[curious]`, `[emphatic]`. Owner to confirm the format (open question 1) |
| Detective Guy | Narrator + characters | Detective, suspects (per episode) | Noir narration, low and dry; characters by speaker tag |
| News | Anchor (+ optional field reporter) | Anchor, Reporter | Neutral, crisp, fixed pace; few tags |
| Comic talk / pop culture | Two-host banter | Host A, Host B | Fast, overlapping, `[laughs]`, `[sarcastic]`; Text to Dialogue candidate (open question 3) |
| Tech Video Journalist | Single presenter, energetic | Presenter | Bright, fast, punchy cuts |
| Tech News in images (IG) | Image carousel | Narrator | See open question 2: a voice needs a video; images become a slideshow master in Remotion first |
| Horror stories | Narrator + occasional character | Narrator, character | Slow, quiet, `[whispers]`, `[nervous]`, long pauses |
| Reddit stories (AITAH) | Narrator reading the post; quoted people | OP, quoted voices | Conversational, first person; `[incredulous]`, `[annoyed]` |

## Specs and dependency order

```
FILM-2201 (master-video episode) ─┬─→ FILM-2202 (subtitle import) ─┬─→ FILM-2204 (cue-timed voicing) ─→ FILM-2205 (review + preview)
FILM-2203 (voice formats + cast) ─┘                                └──────────────────────────────────────┐   │
                                                                                                           ▼   ▼
                                                                           FILM-2206 (edit package master track + Remotion handoff)
                                                                                                           │
                                                                                                           ▼
                                                                           FILM-2210 (Studio: master-video rough cut and render)
```

| Spec | Repo | Milestone | Effort | Covers |
|------|------|-----------|--------|--------|
| [FILM-2201](./FILM-2201-master-video-episode.yaml) | StoryBook | M1 | M | `episodes.workflow` (`generative` / `master_video`), the choice at creation, the Master and Voice tabs and their unlock rules |
| [FILM-2202](./FILM-2202-subtitle-import.yaml) | StoryBook | M1 | M | One parser for JSON, SRT and VTT with speaker and emotion tags; cues to `caption_segments` and `dialogue_lines`; checks against the video's length |
| [FILM-2203](./FILM-2203-voice-formats-and-cast.yaml) | StoryBook | M1 | M | `projects.voice_format`: cast (speaker → voice), model, emotion style, pacing; the nine format templates; speaker matching on import |
| [FILM-2204](./FILM-2204-cue-timed-voicing.yaml) | StoryBook | M1 | L | `voice-master` job on the voice worker: `eleven_v3`, emotion → audio tags, timestamps for a measured length, fit to the cue, flags; cost estimate first |
| [FILM-2205](./FILM-2205-voiceover-review.yaml) | StoryBook | M2 | L | The Voice tab: video with the lines scheduled over it, per-line play, regenerate, re-tag, nudge, approve |
| [FILM-2206](./FILM-2206-master-video-handoff.yaml) | StoryBook | M2 | M | The master video and voiced lines in `get_edit_package`; the Remotion download (`voiceover.json`, line files, `timings.json`); the MCP tools for the flow |
| [FILM-2210](./FILM-2210-studio-master-video-rough-cut.yaml) | Studio | M2 | M | The rough-cut builder places the master video as the picture and the lines on the dialogue bus; ducking, QA and delivery as Phase 20 |

**Milestones.** M1 closes when a 60-second horror episode (one narrator, an
emotion-tagged SRT) goes from upload to a downloaded `voiceover.json` whose
lines all start at their cues, in under five minutes and with no question
asked but the voice. M2 closes when a two-speaker Detective Guy episode is
reviewed in the browser, one line regenerated, opened in the Studio and
delivered as a mixed, ducked render that sets the episode ready. M3 (later,
not yet specced) is banter through Text to Dialogue and localization:
FILM-2007's `localize_episode` already dubs `dialogue_lines` at
`timeline_start_seconds`, so a master-video episode can be dubbed with the
same job once M1 lands.

## Locked decisions (proposed, for the owner)

**StoryBook voices; it does not mix.** No server-side mux, so FILM-607's guard
stands. The mix happens in the Studio (A) or in the creator's Remotion render
(B). Both read the same lines at the same times.

**A cue is a dialogue line.** No new dialogue table. A master-video episode's
`dialogue_lines` have no `shot_id`, a `timeline_start_seconds` from the cue,
and a link to the `caption_segments` row they came from. Everything that
already reads dialogue lines (FILM-2001's package, FILM-2007's dubbing,
captions export) works on them unchanged.

**The subtitle file is the script.** StoryBook does not rewrite the text. Tags
in the text are delivery directions, not words; the spoken text is the cue
with its tags removed, and the tags go to ElevenLabs as audio tags.

**Measured, never estimated.** A voiced line's length comes from ElevenLabs'
character timestamps (or the decoded file), stored as
`generation_metadata.measuredDurationSeconds`. The 150-wpm estimate stays for
the generative workflow only.

**Fit the voice to the cue first; offer the reverse.** A line is placed at its
cue start. It may run into the silence before the next cue; past that it is
retried faster within the format's bounds; past that it is flagged, never
silently squeezed or cut. Because the picture comes from Remotion, the
creator can instead take `timings.json` and re-render the video to the voice.

**Formats are templates, series own the values.** The nine formats are code
constants copied into `projects.voice_format` when a series picks one, like
`projects.brand` and `projects.edit_policy` (FILM-2004).

**Claude can drive it too.** Every step has an MCP tool (FILM-2206), as Phase 19
requires of every workflow.

## Open questions (owner)

1. **Cassy.** "Advance changed? History Teacher another?": is Cassy the
   history teacher, or are these two formats? The table assumes one.
2. **Tech News in images (IG).** A carousel has no timeline to voice. Is the
   plan a Remotion slideshow (images become a master video, then this flow
   applies), or a voice-free carousel that stays outside Phase 22?
3. **Banter formats.** ElevenLabs' Text to Dialogue voices several speakers
   in one call, with more natural turn-taking, but returns one clip for many
   cues. Per-cue TTS (the default here) keeps exact timing. Text to Dialogue
   for Comic talk only, after M2?
4. **The subtitle file.** Which format does the Remotion project emit today:
   JSON (`@remotion/captions` `Caption[]` or your own), SRT or VTT, and how
   are speaker and emotion written? FILM-2202 accepts all three with the
   conventions it lists; a sample file decides the default.
5. **Language.** Is Babu Chondro in English, Bengali or both? `eleven_v3`
   speaks Bengali; the language goes in the voice format.
6. **Who mixes by default?** (A) the Studio or (B) your Remotion render. The
   specs build both; the default decides which the Voice tab offers first.
