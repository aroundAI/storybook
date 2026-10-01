# Lead: Instagram publishing for a Business-Manager Page role may need two scopes we do not request (2026-10-01)

Found writing FILM-1729's publishing-scope audit
(docs/platform-capability-reference.md, "Publishing scopes"). Not reproduced
against a live account; recorded so it is checked, not forgotten.

- **`ads_management` and `ads_read` for Instagram publishing.** Meta's content
  publishing guide
  (https://developers.facebook.com/docs/instagram-platform/content-publishing,
  read 2026-10-01) lists, for Facebook Login, `instagram_basic`,
  `instagram_content_publish` and `pages_read_engagement`, and adds: if the
  app user has a Page role through Business Manager, the app also needs
  `ads_management` and `ads_read`. `META_OAUTH_CONFIG.scopes`
  (packages/features/publishing/src/oauth/meta/config.ts) requests neither.

  Who it would affect: a creator whose Instagram account is linked to a Page
  they reach through a Business Manager role rather than directly. Their
  container creation or `media_publish` would be refused.

  To close it: one publish from the owner's account (FILM-1725), noting how
  its Page role is granted. If refused for that reason, it becomes a KB;
  adding the two scopes widens the Meta consent screen for every user, so it
  is the owner's call, and every existing Meta connection would need to
  reconnect to gain them.
