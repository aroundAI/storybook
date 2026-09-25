# Leads from FILM-514 (retiring Suno and Udio), 2026-09-25

Read in the code while removing the two music vendors; not reproduced.

- **Closed:** the 2026-09-23 spec-audit lead "The live Suno dialogs need `SUNO_API_KEY`, which `sst.config.ts` does not pass to the server" is closed by FILM-514: the dialogs, the actions and the key read are deleted. Strike it in `leads/2026-09-23-spec-audit.md` once that file is on `main` (#356).
- The package `AudioStudio` (`packages/features/audio-generation/src/components/AudioStudio.tsx`) is exported from `@kit/audio-generation/components` and rendered by no page; the live Audio Studio is `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/audio-studio/`. It and its dialogue-side components may be dead in the same way `MusicTrackList` was.
- No spec owns ElevenLabs music (`elevenlabs-music-actions.ts`, `core/elevenlabs-music-core.ts`, the music half of `audio-asset-actions.ts`). FILM-504 was the music-generation spec and described only the retired vendor.
- `generateMusicElevenLabsAction` answers a repeated prompt from the asset library (`findOrCreateAudioAsset`), so a "regenerate" routed through it would return the same audio. A real regenerate for a finished music track needs a force-new option.
- `apps/web/supabase/schemas/30-film-studio.sql` lists `udio` in the `external_api_keys` provider check, which no migration ever added: the schema mirror has drifted from `migrations/`.
