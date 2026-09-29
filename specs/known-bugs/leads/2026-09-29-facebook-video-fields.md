# Lead: the Facebook provider reads a Video field Meta does not document (2026-09-29)

Found writing the Meta sandbox's publishing side (FILM-1802 part 2). Not
reproduced against a live Page; recorded so it is checked, not forgotten.

- ~~**`permalink_url` on a Video.** `facebook-provider.ts` (`getVideoStatus`)
  asks `GET /{video-id}?fields=status,permalink_url` and returns the
  permalink. The Video node reference
  (https://developers.facebook.com/docs/graph-api/reference/video/, re-read
  2026-09-29) lists `id, created_time, description, embed_html, format, event,
  from, icon, name, picture, place, source, updated_time` — neither
  `permalink_url` nor `status`. `status` (with `video_status`) *is*
  documented, in the Reels publishing guide
  (https://developers.facebook.com/docs/video-api/guides/reels-publishing/).
  `permalink_url` is documented on neither page.

  So the sandbox serves `status` and does not invent `permalink_url`. To
  close it: one call against a real Page (the owner's, as for PR 0) — if
  Meta returns `permalink_url`, cite where it is documented (or record it as
  observed-but-undocumented in the capability reference's ledger); if not,
  build the permalink from the Page and video ids instead of reading it.~~
  **Not a bug — observed on the owner's Page, 2026-09-29:** Meta returns it,
  as a relative path (`/reel/{id}/`), which `getVideoStatus` already prefixes
  with `https://www.facebook.com`. Recorded as observed in the capability
  reference's ledger; the sandbox now serves it, relative.
- ~~**`DELETE /{video-id}`.** The publish worker deletes Facebook videos
  (`facebook-provider.ts`, `deleteVideo`). The Video node reference re-read
  the same day has Reading, Publishing and Edges sections and no Deleting
  section, so the documented response is unknown. The sandbox does not serve
  it yet; the same live check settles it.~~ **Not a bug — observed on the
  owner's Page, 2026-09-29:** `{ "success": true }`, which `deleteVideo`
  accepts. Recorded in the ledger; the sandbox now serves it.
