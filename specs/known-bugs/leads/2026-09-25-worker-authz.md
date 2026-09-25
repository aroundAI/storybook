# Leads from KB-33/49/47 (worker-authz, 2026-09-25)

Read in the code while auditing the LLM, voice and publish queues. Not
reproduced as bugs; each needs a decision or a run first.

- **Shot generation ignores three validated inputs.** `generateShotListAction`
  (`packages/features/episodes/src/lib/server/mutations/shot-list-actions.ts`)
  accepts `shotDurationMin`, `shotDurationMax` and `videoProvider`
  (`shot-list.schema.ts:60`), and sent them to the worker, whose handler never
  read them. KB-33 dropped them from the payload; the user's choice is still
  silently unused.
- **Single-episode regeneration ignores `surroundingEpisodes`.**
  `regenerateEpisodeOutline` (`batch-episode-actions.ts`) sent the
  neighbouring episodes to the `season-outline` handler, which has no field for
  them. Dropped from the payload by KB-33; the regeneration is written without
  its neighbours.
- **The "Delete All" dialog says the opposite of what it does.**
  `delete-all-dialog.tsx` says videos on platforms "will need to be deleted
  manually", but the action queues a platform delete per publish, and the
  publish worker removes YouTube and Facebook videos.
- **The voice worker writes `dialogue_lines` by id only**
  (`apps/web/lambda/voice-worker/voice-generation.ts:179, 243, 281`). The
  producers derive the line from the authorised episode, and the worker now
  checks the episode's project (KB-49), but not that the line is in that
  episode.
