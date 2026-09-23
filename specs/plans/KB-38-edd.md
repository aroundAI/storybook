# KB-38 — Engineering Design Document

**Ticket:** KB-38, "R2 presigned uploads don't bind content type or size" (reserved by KB-28 in the lead's KB list; its FILM-CC-04 entry is added by this PR, §31 D4). Found by KB-28, whose EDD records it at §8.1, §8.4, §19 and R3 (`specs/plans/KB-28-edd.md` on `fix/kb-28-project-assets-insert-scope`).
**Branch:** `fix/kb-38-r2-presign-bind-type-size`, stacked on `origin/fix/kb-28-project-assets-insert-scope` @ `27a578e8` (#313, open; rebased from `f9943881` after #313 moved onto main `ef44ffce`).
**Size:** S–M. No migration. An adapter change, a route change within KB-28's route, one shared client helper, five uploaders, tests.
**Status:** Implemented (Phase 2). Approved 2026-09-23 with every recommended default (D1–D4). §0a records the owner's answers and what changed between plan and code.

---

## 0a. Changes after approval

| # | What | Why | Where |
|---|---|---|---|
| B1 | **Q1 answered: browser uploads work in production today.** So R2 does not reject the empty-body `x-amz-checksum-crc32=AAAAAA==` that every URL has carried since 2026-01-07. It either ignores the parameter or does not check it against the body. This change does **not** repair a broken upload path, and the plan's words saying it might are withdrawn (§30 R2, §31 Q1). | Owner | §30, §31 |
| B2 | **Removing that checksum is still right, and safe.** It is the CRC32 of zero bytes, so it asserts nothing about the file. A server that did check it would refuse every real upload. The URL without it is exactly what SDKs before 3.729 produced, and what Cloudflare's own presigned-URL examples show. Keeping it would make correctness depend on R2 continuing to ignore a parameter the URL claims. Only the presign client drops it: server-side `upload()` keeps the SDK default, where the checksum is of the real body. MinIO accepts the URL with or without it (§0.2), so the removal is proven not to change acceptance there. | Owner's Q1, reasoning | §10, §15 |
| B3 | **Q3 answered: 500 MB is right** for edit-suite exports and master videos. There is one list, `UPLOAD_CONSTRAINTS`. | Owner | §30 R4 |
| B4 | **D1:** the audio library upload goes to KB-57, with the findings handed over verbatim in §31. **D2:** MinIO is not in CI. The integration test is committed but skipped unless `S3_LOCAL_ENDPOINT` is set, and its local output is in the PR. **D3:** the owner applies the env comment line; this branch does not touch `deployment/config`. **D4:** the KB-38 entry is added to FILM-CC-04, marked Fixed, with a row in the Fixed table. | Owner | §31 |
| B5 | **KB-70** (lead-assigned) is the `STORAGE_PROVIDER=s3` → Supabase fallback. It is added to FILM-CC-04 as Open, not fixed. | Coordinator | §8.5, FILM-CC-04 |
| B6 | **No `exports` entry for `@kit/edit-suite`.** The web Vitest config needs an explicit alias for every package sub-path, and KB-31 edits that file. So the helper test imports the edit-suite helper by relative path instead. `package.json` is untouched. | Avoids a shared-file conflict | §7, §15, §26 |
| B7 | **`scripts/s3-local.sh`** starts the MinIO the integration test needs (pinned image `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z`, 127.0.0.1:19138, throwaway credentials, bucket created with `mc`). Docker Hub no longer serves `minio/minio`. | Makes the red/green run repeatable | §26 |
| B8 | The integration test sends requests through `node:http`, not `fetch`: the web Vitest environment is happy-dom, whose `fetch` applies browser rules, and its setup file needs a DOM, so the node environment is unavailable. Each PUT sets `Content-Length` from its body, as a browser does. That browsers really do this is shown separately, in Chromium (§26). | Test infrastructure | §26 |

---

## 0. What the reproduction showed (2026-09-23, local only, no R2, no production config)

### 0.1 What the signer signs today

`R2StorageAdapter.getSignedUploadUrl` (`packages/features/storage/src/adapters/r2.ts:94-119`) passes `ContentType` to `PutObjectCommand` and calls `getSignedUrl(client, command, { expiresIn })`. It looks as if the type is bound. It is not. The installed presigner, `@aws-sdk/s3-request-presigner@3.965.0`, removes it on purpose (`dist-cjs/index.js:48-49`):

```js
prepareRequest(requestToSign, { unsignableHeaders = new Set(), … } = {}) {
    unsignableHeaders.add("content-type");
```

In `@smithy/signature-v4`, `getCanonicalHeaders` skips an unsignable header unless it is also in `signableHeaders` (`dist-cjs/index.js:92-98`). I signed with dummy credentials (`$SP/kb38/sign-probe.mjs`) and read the URL each variant produces:

| Signing call | `X-Amz-SignedHeaders` | Other query |
|---|---|---|
| **Today:** `PutObjectCommand{ContentType}` | **`host`** | `x-amz-checksum-crc32=AAAAAA==`, `x-amz-sdk-checksum-algorithm=CRC32` |
| `+ ContentLength` | `content-length;host` | same checksum |
| `+ ContentLength`, `signableHeaders: {content-type}` | `content-length;content-type;host` | same checksum |
| same, client built with `requestChecksumCalculation: 'WHEN_REQUIRED'` | `content-length;content-type;host` | **none** |

Today's URL binds **nothing but the host and key**. It also carries a second defect. Since SDK 3.729.0 the default `requestChecksumCalculation` is `WHEN_SUPPORTED` (AWS: "the SDK provides default integrity protections by automatically calculating a CRC32 checksum for uploads"). A presigned PUT has no body at signing time, so the URL carries the CRC32 of an **empty** body (`AAAAAA==`). What R2 does with that is not documented. See §31 Q1.

### 0.2 What an S3 server does with today's URL (MinIO RELEASE.2025-09-07, local container)

`$SP/kb38/minio-probe.mjs`, output in `$SP/kb38/minio-probe.out`. Each row signs a fresh URL for a 1000-byte `image/png`, then PUTs what the row describes with Node's `fetch`, which sets `Content-Length` from the body the way a browser does.

| PUT | **A: today's signing** | **B: proposed** | C: B without `WHEN_REQUIRED` |
|---|---|---|---|
| Matching type and size (legitimate) | 200, stored 1000 B `image/png` | **200, stored** | 200, stored |
| `Content-Type: text/html` | **200, stored as `text/html`** | **403 SignatureDoesNotMatch, not stored** | 403, not stored |
| No `Content-Type` | **200, stored `binary/octet-stream`** | **400 AccessDenied, not stored** | 400, not stored |
| 5000-byte body | **200, stored 5000 B** | **403, not stored** | 403, not stored |
| 500-byte body | **200, stored 500 B** | **403, not stored** | 403, not stored |

On an S3-compatible server that implements SigV4 (MinIO), the defect is real and B closes it. MinIO ignores the empty-body checksum: A's legitimate row is 200. So column C tells us nothing about R2 (§31 Q1).

### 0.3 What Cloudflare documents for R2

- Presigned URLs, "Best practices": *"Restricting Content-Type: Specify the allowed `Content-Type` in your SDK's parameters. The signature will include this header, so uploads will fail with a `403/SignatureDoesNotMatch` error if the client sends a different `Content-Type` for an upload request."* (https://developers.cloudflare.com/r2/api/s3/presigned-urls/). R2 therefore enforces a **signed** `Content-Type`. Cloudflare's own JS v3 example passes only `ContentType`, though, and §0.1 shows that produces an unsigned header. The docs are right about R2 and wrong about what that SDK call signs. The presigner README gives the fix: *"For headers that are not `x-amz-*` you are able to add them to the set of `signableHeaders` to be enforced in the presigned urls request"* (https://github.com/aws/aws-sdk-js-v3/blob/main/packages/s3-request-presigner/README.md). The upstream report is aws/aws-sdk-js-v3#3497, *"Content-Type is not signed by default when specified"*.
- Same page: *"`POST` (multipart form uploads via HTML forms) is not currently supported."* So S3's `content-length-range` POST-policy condition is **not available on R2**. The only size control a presigned R2 PUT can carry is an exact, signed `Content-Length`.
- **Content-Length:** Cloudflare's pages say nothing about it (the presigned-URLs page and the S3 compatibility table, https://developers.cloudflare.com/r2/api/s3/api/, were both read). What rests on it:
  - SigV4 verification covers every header named in `X-Amz-SignedHeaders`.
  - MinIO rejects a mismatch (§0.2).
  - A third-party R2 client documents *"the size is signed into that part's URL"* (https://cfnet.alos.no/articles/r2/presigned-urls.html).

  R2's behaviour on a signed `Content-Length` is **unverified against R2 itself** (§31 Q2, §25 gate).

---

## 1. Start With the User

**Who.** Every creator who uploads through the browser: covers, character, location and prop images, shot frames and videos, episode and publish thumbnails, master assets, publish videos and edit-suite exports. Production stores all of these in Cloudflare R2 (owner, KB-28 D6).

**Problem.** KB-28 made the presign route decide *who* may upload, *where*, and *what type* they say they are sending. But the URL the route hands back binds none of the "what". Whoever holds it (the user, or anyone the URL leaks to within its 15-minute life) can PUT:
- any bytes, under any `Content-Type` (for example `text/html`, served from the public R2 domain under a victim's project path);
- of any size (a 5 GB file on a URL issued for a 200 KB cover), billed to the platform's storage.

The Supabase bucket limits KB-28 added (500 MB, MIME list) don't exist on R2.

**After the fix:**
- An upload URL is good for exactly one file: the type and the byte count the uploader declared when asking for it. The route checks both against the product's limits before it signs.
- Storage refuses a PUT whose `Content-Type` or size differs. Nothing is written.
- Legitimate uploads look and behave exactly as today.

**What they see.** On the happy path, nothing changes. A file over the product ceiling for its kind (image 10 MB, video 500 MB, audio 50 MB, from `UPLOAD_CONSTRAINTS`) is now refused **before** the upload starts, with a message that names the size and the limit, in the uploader's existing error slot. Uploaders with no client-side limit could previously send more on R2: the master asset manager and the edit-suite export.

**Persists:** uploaded objects, as today. **Does not persist:** refused uploads. A refused PUT writes nothing (§0.2).

## 2. Define the Complete User Journey

| Stage | User action | System response | User-visible result | Next |
|---|---|---|---|---|
| Entry | Opens any upload control in their project | Unchanged | Upload control | Pick a file |
| Pick | Chooses a file | Component's existing checks | Preview / progress | — |
| Presign | — | `POST /api/storage/presign {bucket, path, contentType, size}`. The route checks bucket, path, type, **size ≤ category ceiling**, and write role, then signs **type and exact length** into the URL | Progress continues | — |
| Upload | — | Browser PUTs the file with the `headers` the route returned. The browser sets `Content-Length` itself. R2 verifies the signature over host, `content-type` and `content-length` | Progress to 100% | — |
| Record | — | Component's server action saves the URL (unchanged) | Success toast / image shown | Leave, replace |
| Too large | Picks a 12 MB image as a master asset | Route answers 400 `File is 12.0 MB; images may be at most 10 MB` | That text in the component's error toast | Pick a smaller file |
| Tampered PUT | (Attacker) PUTs other bytes, type or size to a URL | Storage 403 `SignatureDoesNotMatch` | — | — |
| Stale tab across the deploy | Uploads from a page loaded before the deploy (old bundle, sends no `size`) | Route 400 `Missing required fields: bucket, path, contentType, size` | Component error text | Reload the page (§24) |
| Cancel / navigate away | — | PUT aborted; URL expires unused | Nothing saved | — |
| Refresh / re-entry | — | Unchanged | Same stored URLs | — |

## 3. Explicitly Define the Happy Path

The reference path is an owner uploading a project cover (`project-cover-settings.tsx:43-88`) on R2:

1. The owner picks `cover.png` (`image/png`, 184 320 bytes). The component checks `image/*` and 5 MB, as today.
2. `uploadProjectCover` → `uploadWithPresignedUrl` → **`requestPresignedUpload({bucket:'project-assets', path, contentType:'image/png', size:184320})`** posts that JSON to `/api/storage/presign`.
3. The route authenticates, then checks the bucket, the path and the type as KB-28 does. It then maps `image/png` → category `image` → ceiling 10 MiB, finds 184 320 ≤ ceiling, and calls `rpc can_write_project_storage` → true.
4. `R2StorageAdapter.getSignedUploadUrl('project-assets', path, {contentType:'image/png', contentLength:184320, expiresIn:900})` signs with a presign-only client (`requestChecksumCalculation:'WHEN_REQUIRED'`) and `signableHeaders:{content-type}`. The URL has `X-Amz-SignedHeaders=content-length;content-type;host` and no checksum parameter.
5. The route returns `200 {uploadUrl, publicUrl, expiresIn, headers:{'Content-Type':'image/png'}}`.
6. The browser runs `fetch(uploadUrl, {method:'PUT', body:file, headers})`. The browser sends `Content-Length: 184320` from the `File` (a forbidden header, set by the user agent), plus `Content-Type: image/png`.
7. R2 recomputes the signature over the three headers, it matches, and the object is stored. `updateProjectCoverImage` saves the URL, and the toast and image appear exactly as today.

**Success** means the object exists with the declared size and type, and a PUT differing in either would have been refused.

## 4. Define Every Important Alternate Path

| Trigger | System behaviour | User-visible | Recovery | Final state |
|---|---|---|---|---|
| `size` missing, not an integer, ≤ 0 | Route 400 (schema) | Component error | Reload (stale bundle) | Nothing signed |
| `size` > ceiling for the type's category | Route 400 `File is X MB; <category> may be at most Y MB`, logged `reason:'size'` | That text | Smaller file | Nothing signed |
| `size` at exactly the ceiling | Signed | Normal | — | Stored |
| PUT with a different `Content-Type` | R2 403 `SignatureDoesNotMatch` (documented, §0.3) | Uploader's existing "upload failed" | — | Nothing stored |
| PUT with no `Content-Type` | Refused (MinIO: 400) | Same | — | Nothing stored |
| PUT body longer or shorter than declared | Signature mismatch → 403 (MinIO-verified; R2 unverified, §31 Q2) | Same | — | Nothing stored |
| Declared type in different case (`IMAGE/PNG`) | Route lowercases, signs `image/png`, returns `headers` with `image/png` | Normal | — | Stored as `image/png` |
| Thumbnail blob whose bytes are not the declared type (e.g. Safari's `canvas.toBlob('image/webp')` falls back to PNG in `use-video-upload`) | Header and size match what was signed → stored under the declared type, as today | Normal | — | Same as today |
| URL reused within its 15 min | Same key overwritten with bytes of the same size and type | — | — | As today (the key is timestamped per upload) |
| Stranger / bucket / path / type refusals | Unchanged from KB-28 (403/400) | Unchanged | — | — |
| R2 refuses the signed `content-length` itself (the §31 Q2 risk) | Every PUT 403 | Every upload fails | Roll back the app (§25) | Nothing stored |
| Supabase provider (local, CI) | Route checks size; the Supabase adapter ignores length (bucket limits apply at PUT); returns `headers` | Normal | — | Stored |

## 5. Establish the User-Facing Contract

- **Request:** `POST /api/storage/presign {bucket, path, contentType, size, expiresIn?}`. `size` is new and **required**: an integer number of bytes, > 0.
- **Response 200:** `{uploadUrl, publicUrl, expiresIn, headers}`. `headers` is new: the exact request headers the PUT must carry (today `{'Content-Type': <canonical type>}`). `Content-Length` is not in it, because the browser sets that from the body and cannot be told otherwise. The declared `size` must therefore equal the body's byte length.
- **Errors:** 400 `Missing required fields: bucket, path, contentType, size` (was `…contentType`) · 400 `File is 12.0 MB; images may be at most 10 MB` (new) · all KB-28 statuses unchanged.
- **PUT contract:** `PUT uploadUrl`, body = the same bytes (`File`/`Blob`) whose size was declared, headers = `response.headers`. Anything else is refused by storage.
- **UI:** no new states. Components already show an error for a failed presign or PUT.

## 6. Convert the User Experience Into Functional Requirements

| ID | Requirement | Verification |
|---|---|---|
| FR-1 | The R2 signer puts `content-type` and `content-length` in `X-Amz-SignedHeaders`, with the declared values | Unit: parse the URL; red on current adapter (`SignedHeaders=host`) |
| FR-2 | The R2 presign URL carries no `x-amz-checksum-*` / `x-amz-sdk-checksum-algorithm` (no empty-body checksum) | Unit; red on current adapter |
| FR-3 | A PUT with a different `Content-Type`, no `Content-Type`, a longer body or a shorter body is refused and stores nothing; the matching PUT succeeds | Integration against local MinIO with the real adapter; red on current adapter (§0.2 column A) |
| FR-4 | The route requires `size` (integer > 0) and refuses sizes above `UPLOAD_CONSTRAINTS[category].maxSize` for the declared type; exactly-max passes | Route unit tests (per category, max and max+1); red on KB-28's route (a missing size signs 200) |
| FR-5 | The route passes the canonical (lowercased) type and the declared size to the adapter, and returns the adapter's `headers` | Route unit test on the R2 provider |
| FR-6 | Every browser uploader declares the byte length of the exact body it PUTs, and PUTs with the returned `headers` | Structural test (every `/api/storage/presign` caller is one of two helpers); helper unit tests; E2E through the cover UI (dev and production build) |
| FR-7 | The B2 adapter signs the same way (same class, same helper) | Unit |
| FR-8 | Server-side `upload()` (lambdas, audio actions) is unchanged | Diff review: the presign client is separate; `upload()` untouched |
| FR-9 | The production env file's storage header comment says what the code does (every runtime upload → the one `STORAGE_PROVIDER`); no value changes | One-line diff, delivered per decision D3 |

## 7. Define Non-Functional Requirements

- **Security:** after this, a URL admits one upload of one declared type and exact size, at most the category ceiling. The ceiling comes from one list, `UPLOAD_CONSTRAINTS`.
- **Performance:** one extra integer check in the route. The same number of requests. The browser's PUT is unchanged in size.
- **Compatibility:** the response gains a field, and the request gains a required field. Old bundles fail cleanly with 400 until reloaded (§24).
- **Dependencies:** none new. The lockfile and every `package.json` are unchanged (§0a B6).
- **Observability:** refusals log `reason:'size'` with `{declared, limit, category}`.
- **Cost:** it removes the unbounded-bytes-per-URL exposure. There is still no per-user quota (§19).

## 8. Analyze the Existing System

### 8.1 Components

- **Route:** `apps/web/app/api/storage/presign/route.ts` (KB-28's version): zod `{bucket, path, contentType, expiresIn?}` (`:56-61`); bucket allowlist (`:91`), path pattern (`:95`), type allowlist on the lowercased value (`:99`), `rpc can_write_project_storage` (`:106-121`). It signs `storage.getSignedUploadUrl(bucket, path, contentType, exp)` (`:130-135`) with the **raw** `contentType`, not the lowercased one it checked.
- **Adapter interface:** `getSignedUploadUrl(bucket, path, contentType, expiresIn?)` → `{uploadUrl, publicUrl, expiresIn}` (`packages/features/storage/src/types.ts:73-78, 32-39`). There is one caller, the route (grep; positive control: the route file matches).
- **R2 adapter:** `r2.ts:61-68` builds one `S3Client` (region `auto`, endpoint `https://${accountId}.r2.cloudflarestorage.com`). It is used both for server `upload()` (`:71-92`, with a `Body`, so its checksum is a real one) and for presigning (`:94-119`). `bucket` is a key prefix inside `R2_BUCKET_NAME` (`:78,100`).
- **B2 adapter:** the same code at `b2.ts:98-123`. It is not the production provider.
- **Supabase adapter:** `createSignedUploadUrl(path)` ignores the type (`supabase.ts:54-76`). The bucket's `allowed_mime_types` / `file_size_limit` (KB-28) apply at PUT.
- **Limits:** `UPLOAD_CONSTRAINTS` (`packages/features/assets/src/lib/upload-validation.ts:6-48`): image 10 MiB, video 500 MiB, audio 50 MiB. `ALLOWED_PROJECT_ASSET_TYPES` (`:57-61`) is the union of the three.
- **Provider:** `STORAGE_PROVIDER` picks one adapter for every factory upload (`factory.ts:31-45`). Production is R2 (owner). Local, CI and `scripts/local-env.sh:88` use `supabase`.

### 8.2 Every browser uploader: the §8.4 matrix of KB-28, at code level

Every row below reaches R2 in production. "Needs" is what KB-38 changes.

| # | Presign client (file:line) | Used by | Body PUT | Needs |
|---|---|---|---|---|
| U1 | `packages/features/storage/src/client/presigned-upload.ts:35-80` `uploadWithPresignedUrl` (fetch) | `uploadProjectCover` → `project-cover-settings.tsx:69`, `create-film-project-form.tsx:242`; `uploadAvatar` → `update-account-image-container.tsx:58`, `update-team-account-image-container.tsx:39` (refused by the route today: **KB-53**) | `File` | Becomes the shared helper: sends `size: file.size`, PUTs with `headers` |
| U2 | `apps/web/lib/presigned-upload.ts:33-78`: a **verbatim duplicate** of U1 | `episode-thumbnail-settings.tsx:446`, `master-asset-manager.tsx:205,436`, `publish-screen.tsx:278`, `frame-uploader.tsx:62`, `project-intro-settings.tsx:387` (refused by the path pattern: **KB-39**), `uploadPublishVideo` → `publish-screen.tsx:717`; `uploadShotVideo`/`uploadImage` have zero callers | `File` | Delete the duplicate and re-export U1's function. Keep the three path wrappers, which now go through U1 |
| U3 | `packages/features/assets/src/components/image-uploader/use-image-upload.ts:131-189` (FILM-207; fetch presign + XHR PUT for progress) | Asset image uploader | `File` | Presign via the shared `requestPresignedUpload({…, size: file.size})`; XHR sets `headers` from the response (`@kit/assets` already depends on `@kit/storage`) |
| U4 | `packages/features/episodes/src/hooks/use-video-upload.ts:325-420` (two presigns: video via XHR, thumbnail via fetch) | Shot video upload | `File` and a `canvas.toBlob` `Blob` | Both presigns via the shared helper with `file.size` / `thumbnailBlob.size` (the blob exists before presigning); both PUTs use the returned `headers` (`@kit/episodes` already depends on `@kit/storage`) |
| U5 | `packages/features/edit-suite/src/lib/presigned-upload.ts:34-126` `uploadToR2Presigned` (XHR) | `export-dialog.tsx:91` (bucket `EXPORT_UPLOAD_BUCKET`, `video/mp4`) | Rendered `Blob` | Own helper, because `@kit/edit-suite` does not depend on `@kit/storage` and adding that dependency would change the lockfile. Send `size: blob.size`, apply the returned `headers`, surface the route's error text |
| — | `apps/e2e/tests/storage/project-assets-upload.spec.ts:177,206` (KB-28's spec) | Test | Buffer | Add `size` to its two direct presign calls |

There are no other callers of `/api/storage/presign` (grep for the literal across `apps/` and `packages/`; positive control: the route's own doc comment matches).

### 8.3 The server-side audio uploads (asked: in scope here, or KB-57?)

| Path | What it uploads | Content type | Verdict |
|---|---|---|---|
| `voice-actions.ts:295` (dialogue TTS), `:738` (voice preview) | ElevenLabs buffer | literal `audio/mpeg` | Not KB-38's class: server-made bytes, fixed type |
| `sfx-actions.ts:89`, `elevenlabs-music-actions.ts:82`, `core/sfx-core.ts:76`, `core/elevenlabs-music-core.ts:80`, `audio-asset-actions.ts:576,693` | Generated buffer | literal `audio/mpeg` | Same |
| **`audio-asset-actions.ts:798-859` `uploadAudioFileAndCreateAssetAction`** (the audio library dialog, `upload-audio-dialog.tsx:129-140`) | Client base64 → `Buffer` | **client-sent `contentType`, unchecked**; `fileSizeBytes` client-sent and never compared to the buffer; key `${audioType}/${ts}-${fileName}` with only whitespace replaced | **Same class** (type not bound), but no presign is involved. It uploads to R2 **before** any project check (`uploadAudioAssetAction` runs after the object exists), so a stranger's upload lands whatever the insert then does. That ordering is KB-57's subject |

**Recommendation (D1): leave `audio-asset-actions.ts` to KB-57.** The type check, the size check against the real buffer, key sanitisation, and moving `can_write_project` *before* the upload all live in the same ~25 lines and the same caller. Splitting them across two PRs means two edits to one function and two refusal paths through one dialog. There is also a product decision inside it that KB-57 must make anyway. The dialog accepts `audio/x-m4a` (`upload-audio-dialog.tsx:212`), which `UPLOAD_CONSTRAINTS.audio` does not list (`audio/mp4` is listed). A server allowlist would start refusing `.m4a` files that work today. KB-38 hands KB-57 this row verbatim (§31).

### 8.4 Where the change enters

It enters in three places:
- the two S3 presign sites (`r2.ts`, `b2.ts`), through one helper;
- the adapter interface;
- KB-28's route. The only changes there are the ones signing requires: the `size` field, the size ceiling, passing canonical type and length, and returning `headers`. Its authorisation logic is untouched.

Then the five browser presign clients, collapsed to two helpers.

### 8.5 The stale env comment (asked)

The text `Storage - Smart Routing (videos→R2, images→Supabase)` is in exactly one file: **`deployment/config/production.env:89`**. `deployment/config` is a git **submodule** (`aroundAI/storybook-deployment-config`, `.gitmodules`). It is not checked out in this worktree, and this repo does not track the file. None of the templates carry it (`production.env.example`, `staging.env.example`, `tailorist.env.example`, `local.env`; the root `.env.*.example`). Line 89 contradicts line 91 of the same file (`# ALL runtime uploads go to Cloudflare R2`). I located it with `grep -n` on that string and printed only comment lines and variable *names* around it, never a value. The edit is a one-line comment change in another repository, so how it is delivered is decision **D3**.

Side finding: the three templates set `STORAGE_PROVIDER=s3` (`production.env.example:55`, `staging.env.example:54`, `tailorist.env.example:58`, and the root `.env.aws.example:38`, `.env.hybrid.example:32`). `getStorageProvider()` maps `s3` to **`supabase`** (`factory.ts:41-44`, the `default` branch). A deploy from a template would silently use Supabase Storage. That is not changed here (values are off-limits), and is reported in §31.

## 9. Define the Desired System Behavior

| User action | App logic | Service | Data | Response | Visible |
|---|---|---|---|---|---|
| Presign | Route: KB-28 checks, then `size` ≤ ceiling, then rpc | Adapter signs type + length (R2/B2) or plain (Supabase) | — | 200 `{…, headers}` | Progress |
| PUT (matching) | — | R2 verifies SigV4 over host, content-type, content-length | Object stored | 200 | Done |
| PUT (tampered) | — | Signature mismatch | — | 403 | — |
| Presign, too large | Route 400 | — | — | Error text | Toast/error |

## 10. High-Level Architecture

There are no new components. The trust boundary is unchanged: the browser ↔ the presign route ↔ R2. The route is the gate for **who / where / declared what** (KB-28, plus the size ceiling here). The **signature** carries the declared type and length to R2, the only party that sees the bytes. That is how the declaration becomes binding. The contents themselves (magic bytes) remain unverified server-side, because the payload is `UNSIGNED-PAYLOAD` (§19).

A separate presign `S3Client` exists because `requestChecksumCalculation: 'WHEN_REQUIRED'` must apply to presigning (no body, so no meaningful checksum). It must not change `upload()`, whose checksum covers a real body and which works in production today (lambdas and audio actions depend on it).

## 11. Architecture and Flow Diagrams

```
Browser                         /api/storage/presign                        R2 (S3 API)
  │ POST {bucket,path,contentType,size}│                                          │
  │──────────────────────────────────▶│ auth → bucket → path → type                │
  │                                   │ → size ≤ UPLOAD_CONSTRAINTS[cat].maxSize   │
  │                                   │ → rpc can_write_project_storage            │
  │                                   │ → adapter.getSignedUploadUrl(b, p,         │
  │                                   │     {contentType, contentLength, exp})     │
  │                                   │     presignClient (WHEN_REQUIRED)          │
  │                                   │     signableHeaders {content-type}         │
  │                                   │     SignedHeaders=content-length;          │
  │                                   │                   content-type;host        │
  │◀── 200 {uploadUrl, publicUrl, expiresIn, headers:{Content-Type}} ─────────────│
  │ PUT uploadUrl  Content-Type: <signed>  Content-Length: <UA-set = body bytes>   │
  │──────────────────────────────────────────────────────────────────────────────▶│ SigV4 check
  │◀─────────────────────────── 200 stored  |  403 SignatureDoesNotMatch ─────────│
```

## 12. End-to-End Data Flow

- **Source:** the `File`/`Blob` in the browser.
- **Declaration:** `{contentType: file.type, size: file.size}` → route validation (allowlist, ceiling) → canonicalisation (lowercase type).
- **Signing:** the type and the length go into the SigV4 canonical request → URL.
- **Upload:** the PUT carries the same bytes. R2 recomputes the signature from the headers the request actually has.
- **After:** persistence and retrieval are unchanged.

**Loss points:** none new. The orphan-on-record-save-failure case is pre-existing (§12 of KB-28).

**Incorrect transformation risk:** a helper that declares one body and PUTs another. It would fail closed (403), which is the reason for FR-6's structural test.

## 13. Data Model

No entities change. The authoritative "what may be stored" is `UPLOAD_CONSTRAINTS` (types and ceilings per category). New pure helper: `uploadCategoryForType(type) → 'image' | 'video' | 'audio' | null`, beside it in `upload-validation.ts`, so the route derives the ceiling from the same list it derives the allowlist from.

## 14. Database Design and Changes

None. No migration, no policy, no types regeneration. Supabase bucket limits (KB-28) are unchanged.

## 15. Low-Level Design

**`packages/features/storage/src/adapters/s3-presign.ts` (new, server-only)**
```ts
export function createPresignClient(config: S3ClientConfig): S3Client
  // new S3Client({ ...config, requestChecksumCalculation: 'WHEN_REQUIRED' })

export async function presignPut(client, { bucket, key, contentType, contentLength, expiresIn }):
    Promise<{ uploadUrl: string; headers: Record<string, string> }>
  // getSignedUrl(client, new PutObjectCommand({ Bucket, Key, ContentType, ContentLength }),
  //              { expiresIn, signableHeaders: new Set(['content-type']) })
  // headers = { 'Content-Type': contentType }
```

**`types.ts`**
```ts
export interface SignedUploadRequest { contentType: string; contentLength: number; expiresIn?: number }
getSignedUploadUrl(bucket: string, path: string, request: SignedUploadRequest): Promise<SignedUploadResult>
SignedUploadResult += headers: Record<string, string>   // exactly what the PUT must send
```
An options object, not a fifth positional argument. `contentLength` and `expiresIn` are both numbers, so a stale positional caller would otherwise sign an expiry as a length without a type error.

**`r2.ts` / `b2.ts`:** the constructor also builds `this.presignClient = createPresignClient({region, endpoint, credentials})` (B2: its own region and endpoint). `getSignedUploadUrl` calls `presignPut(this.presignClient, {bucket: this.bucketName, key: \`${bucket}/${path}\`, …})`. The constructor option type gains `endpoint?: string`, defaulting to today's value. It is a constructor argument only, with **no env variable**, so the integration test can point the real adapter at local MinIO while production construction is byte-for-byte unchanged. `upload()` and the rest stay untouched.

**`supabase.ts` / `local.ts`:** new signature. Supabase returns `headers: {'Content-Type': contentType}`; local still throws.

**Route (within KB-28's file; the only changes are the ones signing requires):**
1. The schema adds `size: z.number().int().positive()`. The 400 text becomes `Missing required fields: bucket, path, contentType, size`.
2. `const type = contentType.toLowerCase()`; the allowlist check uses `type` (as today).
3. `const category = uploadCategoryForType(type)`; `if (size > UPLOAD_CONSTRAINTS[category].maxSize) refuse('size', \`File is ${mb(size)} MB; ${plural(category)} may be at most ${mb(max)} MB\`, 400)`. `category` cannot be null after step 2, because the allowlist is the union of the categories. The code narrows it with an explicit guard that refuses as `type`, not a non-null assertion.
4. Permission check: unchanged.
5. `storage.getSignedUploadUrl(bucket, path, { contentType: type, contentLength: size, expiresIn: exp })`.
6. Return `{ uploadUrl, publicUrl, expiresIn, headers }`.
7. The header comment drops "Binding the content length into the R2 signature is KB-38" and states what is now bound.

**Client, `@kit/storage/client` (`client/presigned-upload.ts`):**
```ts
export interface PresignedUpload { uploadUrl: string; publicUrl: string; expiresIn: number; headers: Record<string, string> }
export async function requestPresignedUpload(req: { bucket; path; contentType; size: number; expiresIn?: number }): Promise<PresignedUpload>
  // POST; on !ok throw new Error(body.error ?? `Presign failed (${status})`)
export async function uploadWithPresignedUrl(file, bucket, path)   // requestPresignedUpload(... size: file.size) → fetch PUT with .headers
```
`size` is required in the type, so an uploader cannot compile without declaring it.

**U2** `apps/web/lib/presigned-upload.ts`: replace its body with `export { uploadWithPresignedUrl } from '@kit/storage/client'` plus the three existing path wrappers. **U3/U4:** call `requestPresignedUpload`; XHR does `for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)`; fetch passes `headers`. **U5:** the same change in its own helper. Its test imports it by relative path (§0a B6).

No retries, flags, caching, transactions or locking are involved.

## 16. API and Event Design

`POST /api/storage/presign` (contract in §5):
- Auth, authorisation, idempotency (none, as before) and rate limits (none) are unchanged.
- **Compatibility:** additive response; the request gains a required field; every in-repo caller changes in the same PR.
- **Versioning:** none. The client and server bundles deploy together, and a stale tab fails closed (§24).

There are no events.

## 17. State and Lifecycle Design

A signed URL is: issued → used (one successful PUT per matching body; repeatable until expiry with the same size and type) → expired (≤ 3600 s, default 900 s). This is unchanged, apart from what a "matching body" is. There are no other states.

## 18. Failure and Error Handling

| Failure | Behaviour | Visible | Recovery |
|---|---|---|---|
| Size over the ceiling | 400 with a reason | Specific message | Smaller file |
| Stale client without `size` | 400 | Generic component error | Reload |
| PUT mismatch (bug in a helper) | 403 from storage | "Upload failed: 403" | The fix is in code; FR-6's tests exist to catch it first |
| R2 rejects the signed content-length (§31 Q2) | All PUTs 403 | All uploads fail | Roll back the deploy (§25); the gate catches it in minutes |
| Presign client misconfigured | Route 500 (as today) | Upload-failed text | — |

## 19. Security

- **Closed:** type substitution (e.g. `text/html` on a public R2 domain under a victim-looking path) and unbounded size per URL. Both are verified on MinIO, and documented by Cloudflare for type.
- **Bound per URL:** one declared type from the allowlist, and one exact byte count ≤ the category ceiling. This is the tightest R2 allows, since POST-policy `content-length-range` does not exist on R2 (§0.3).
- **Residual, stated rather than assumed away:**
  1. **Bytes are not verified** (`X-Amz-Content-Sha256=UNSIGNED-PAYLOAD`). A caller can store HTML bytes labelled `image/png`. They are served as `image/png`, which browsers do not render as a document. Magic-byte checks remain client-side (FILM-CC-01). Signing a SHA-256 of the body is possible in principle, but it needs the client to hash up to 500 MB and relies on R2's checksum support, which Cloudflare lists as limited. It is out of scope, recorded in §29.
  2. **No quota:** a writer can request many URLs. Rate limiting is outside this ticket, as it was in KB-28.
  3. **Replay within expiry** overwrites the same key with a same-size, same-type body, as today.
  4. **Server-side audio library upload** accepts any client type: KB-57 (D1).
- **Tenant isolation:** unchanged (KB-28's rpc runs before signing).
- **Secrets:** tests use dummy credentials (`test-key`/`test-secret`) and a local MinIO with throwaway root credentials. No production values are read. The only production file touched, if D3 says so, is a comment line identified by its text.

## 20. Performance and Scale

The route adds an O(1) integer check. The signer computes one extra header in HMAC input. Upload volume is small (KB-28 §20). No change is measurable.

## 21. Accessibility and Client Behavior

No new UI. The size refusal reuses each component's existing error surface (toast or inline message). Browser compatibility:
- `Content-Length` for `File`/`Blob` bodies is set by every browser's fetch and XHR, and cannot be set by script.
- `Content-Type` is set explicitly from `headers`.
- CORS preflight already carries `content-type` today (it is a non-simple header value), so the bucket's CORS rule needs nothing new. `Content-Length` never appears in a preflight.

## 22. Observability and Operations

- **Route:** `warn` `{userId, bucket, path, reason:'size', declared, limit}` on a size refusal.
- **R2:** signature mismatches appear as 403s at R2, not in app logs. A spike of client "Upload failed: 403" reports after deploy is the §25 rollback trigger.
- **Expected vs failure:** an operator distinguishes them by whether the route logged a refusal (expected) or the route returned 200 and the PUT failed (a helper bug, or Q2).

## 23. Configuration and Feature Flags

No flags. The fix is not optional. No new env variables: `endpoint` is a constructor option only. Production R2 construction is unchanged, apart from the extra presign client built from the same values.

## 24. Compatibility

- **Clients:** the only callers are in this repo, and all change in the PR.
- **Browsers that loaded the old bundle before the deploy:** their presign lacks `size` → 400 until reload. This fails closed and needs a one-time reload. Accepting a missing `size` during a grace period would reopen the hole for anyone who omits it, so no grace period is proposed.
- **Existing objects and URLs:** unaffected.
- **Deploy order:** there is none beyond "app ships as one". No DB is involved.
- **KB-28:** stacked. If #313 changes its route before merging, this branch rebases onto it.

## 25. Migration and Rollout Strategy

1. Merge after #313.
2. Deploy as normal.
3. **Validation gate:** the owner, right after deploy, uploads one project cover in production and confirms it displays. That is the first time the signed `content-length`, and the absence of the empty-body checksum, meet real R2 (Q1/Q2). If it fails with 403, roll back the app. Nothing else depends on this change, and no data is written.
4. Optionally, and **the owner's call**: a probe as themselves, presigning a 1000-byte cover and PUTting 5000 bytes, to see R2's 403 in production. I will not do this, because it needs production access.

**Rollback:** revert the app deploy.

## 26. Testing Strategy

| Layer | File | Cases | Red first? |
|---|---|---|---|
| Unit: signer | `apps/web/app/api/storage/presign/__tests__/s3-presign.test.ts`. This lives in `apps/web`, which CI's unit list runs, rather than `@kit/storage`, which it does not. KB-28 set the precedent, and `scripts/test-units.sh` is left alone because KB-31 edits it | R2 adapter with dummy credentials: `SignedHeaders === 'content-length;content-type;host'`; no `x-amz-checksum-*`; key `project-assets/<path>` under `R2_BUCKET_NAME`; `X-Amz-Expires` equals the request; `headers` equals `{'Content-Type': 'image/png'}`; signatures differ when only the length or only the type differs (proves both are in the signature, not only listed). B2: the same assertions | Yes. The current adapter gives `SignedHeaders=host` and carries the checksum |
| Integration: real PUTs | `…/__tests__/s3-presign.s3-local.test.ts` (`@vitest-environment node`), skipped unless `S3_LOCAL_ENDPOINT` is set | The real `R2StorageAdapter` (constructor `endpoint` = local MinIO): matching → 200 and stored; `text/html` → refused, not stored; no type → refused; +4000 bytes → refused; −500 bytes → refused | Yes. Run against the current signing (§0.2 A shows all five 200); the PR records the run. **CI skips it** (no MinIO service; D2) |
| Unit: route | extend KB-28's `route.test.ts` | Missing `size` → 400 (**red on KB-28's route: 200**); `0`, `-1`, `1.5` → 400; image 10 MiB → 200, +1 → 400 with message; video 500 MiB / +1; audio 50 MiB / +1; R2: signer called with `{contentType:'image/png', contentLength:N, expiresIn:900}`; `IMAGE/PNG` signs `image/png`; response has `headers`. KB-28's existing assertions updated to the new argument shape | Yes |
| Unit: helpers | `…/__tests__/presign-client.test.ts` | `requestPresignedUpload` posts `size`, returns `headers`, throws the route's error text; `uploadWithPresignedUrl` PUTs with exactly `headers`; edit-suite `uploadToR2Presigned` (fake XHR) posts `size: blob.size` and sets each returned header | Yes (the current helpers send no `size`) |
| Structural | `…/__tests__/presign-callers.test.ts` | The set of source files containing `'/api/storage/presign'` (apps/, packages/, excluding tests and `node_modules`) equals {the route, `@kit/storage` client helper, edit-suite helper}. Positive control: the helper file is found | Yes (today U2, U3 and U4 also match) |
| E2E | KB-28's `apps/e2e/tests/storage/project-assets-upload.spec.ts` | Owner cover through the UI (the shared helper declares size; first **and second** upload); member direct presign with `size` → PUT 200; stranger with `size` → 403. New: owner presign without `size` → 400; image declared at 10 MiB + 1 → 400 with the message | The UI case goes red if the helper omits `size` |
| Mutation guards | `tooling/mutation-guards/kb-38.json` (unit kind) | (1) drop `signableHeaders` → signer test red; (2) drop `ContentLength` → red; (3) drop `WHEN_REQUIRED` → checksum test red; (4) route: remove the ceiling check → red; (5) shared helper: omit `size` → helper test red | Each recorded |

**Not driven end to end:** the edit-suite export dialog (it needs WebCodecs rendering; KB-28 recorded the same). It is covered by the helper test and the structural test. The shot-video hook (U4) in a browser: its first-frame extraction needs a decodable video in headless Chromium. It is covered by the shared helper's tests and typecheck. U4's thumbnail and video presign calls both go through the typed helper.

**Browser-level R2 proof (not committed as a test):** a one-off Playwright script (Chromium) that PUTs a `File` via `fetch` and via `XMLHttpRequest` to URLs from the real adapter pointed at MinIO. It shows that browsers send the exact `Content-Length` and the returned `Content-Type`, and that a mismatch is refused. Output goes into the PR. Everything runs against 127.0.0.1.

## 27. Production-Build Verification

`pnpm --filter web build:test`, then `NODE_ENV=test VENDOR_SANDBOX=1 next start -p 3117`, sandboxed per the brief:
- `STORAGE_PROVIDER` is unset (the Supabase provider).
- **Preflight aborts if any `R2_*` or `B2_*` variable is set in the server's environment**, so no R2 or B2 client can be built.
- No other vendor is on this path.

Run the storage E2E spec against it under the DB lock. This proves that the **built** client bundles send `size` and the route accepts it.

What it cannot prove: R2 itself (no R2 calls, by rule). The R2 signing is proven by the signer tests and against MinIO. The remainder is §25's gate: one real upload after deploy.

## 28. Requirement Traceability

| User outcome | Flow | Req | Design | Component | Data/API | Test | Prod verification |
|---|---|---|---|---|---|---|---|
| URL admits only the declared type | Tampered PUT | FR-1, FR-3 | §15 signer | `s3-presign.ts`, `r2.ts` | signed URL | signer unit, MinIO integration | §25 gate / owner probe |
| URL admits only the declared size | Tampered PUT | FR-1, FR-3 | §15 | same | same | same | same (Q2) |
| Uploads work on R2 | Happy | FR-2 | §10 presign client | `r2.ts` | URL has no checksum | signer unit | §25 gate (Q1) |
| Oversize refused before upload | Too large | FR-4, FR-5 | §15 route | route | `size`, `headers` | route unit, E2E | test:prod |
| Every uploader complies | Happy | FR-6 | §15 client | U1–U5 | request/PUT | helper unit, structural, E2E | test:prod |
| B2 consistent | — | FR-7 | §15 | `b2.ts` | — | signer unit | n/a (not deployed) |
| Server uploads unaffected | — | FR-8 | §10 | `r2.ts upload()` | — | diff review | existing behaviour |
| Env comment accurate | — | FR-9 | §8.5 | `production.env:89` | — | one-line diff | owner (D3) |

## 29. Architectural Alternatives and Trade-offs

| Decision | Alternatives | Why this one |
|---|---|---|
| Exact signed `Content-Length` | POST policy with `content-length-range` | R2 does not support POST uploads (Cloudflare, §0.3) |
| `signableHeaders: {content-type}` | Hoist the type into the query string | Only `x-amz-*` headers are hoisted (`moveHeadersToQuery`); `signableHeaders` is the SDK's documented path |
| Separate presign client with `WHEN_REQUIRED` | Set it on the one client | The one client also does server `upload()` with real bodies; changing its checksum behaviour widens the blast radius to every lambda and audio upload for no gain |
| Route returns `headers` | Clients hard-code `Content-Type: file.type` | One source for "what was signed". Survives the lowercasing, and survives any future signed header |
| Options object for `getSignedUploadUrl` | Fifth positional argument | Two adjacent `number` parameters invite a silent swap |
| One shared client helper (+ edit-suite's own) | Patch five copies in place | Five copies are how the next uploader forgets `size`; `size` is required by type in the helper. Edit-suite stays separate to avoid a lockfile change |
| Sign the body's SHA-256 | — | Binds bytes, but costs a full-file hash in the browser (up to 500 MB) and depends on R2 checksum support; out of scope, residual §19.1 |
| Local MinIO as the S3 stand-in | Stub `fetch` | Only a real SigV4 server shows that a mismatch is refused |

## 30. Risk Register

| Risk | Impact | Detection | Mitigation | Contingency |
|---|---|---|---|---|
| R1: R2 rejects a signed `content-length` (Q2) | All uploads 403 | §25 gate, minutes after deploy | SigV4 semantics; MinIO passes; third-party R2 client signs it | Roll back; fall back to signing only `content-type` plus the route ceiling (size bound per URL lost) |
| R2: removing the empty-body checksum changes what R2 accepts | None expected | §25 gate | Owner (Q1): uploads work today with it, so R2 does not enforce it. The URL without it is what SDKs before 3.729 sent, and MinIO accepts both (§0a B2) | Roll back |
| R3: a helper declares a different body than it PUTs | That uploader 403s | Helper tests, E2E | Declared from the same object PUT; typed helper | Fix the helper |
| R4: exports or master videos > 500 MB now refused | Those uploads fail with a clear message | User report | It is the product ceiling (FILM-CC-01); owner confirmed 500 MB (Q3) | Raise the one list |
| R5: stale tabs across the deploy | One failed upload, then reload | — | Fails closed | — |
| R6: B2 behaves differently | None (not deployed) | — | Same code | — |
| R7: rebase conflicts with #313 or KB-31 | Merge friction | Git | Touch KB-28's files only where §15 says; avoid KB-31's files | Rebase |

## 31. Open Questions and Assumptions

**Decisions for the owner (recommended default in bold):**
- **D1 (decided: KB-57): audio library upload.** Handed over verbatim:

  > **`packages/features/audio-generation/src/server/audio-asset-actions.ts:798-859`, `uploadAudioFileAndCreateAssetAction`** (called by `apps/web/app/home/[account]/studio/[projectSlug]/audio-library/_components/upload-audio-dialog.tsx:129-140`). It takes the file as base64 from the client and uploads it server-side through `getStorageAdapter()` to the `audio-assets` prefix. On production's R2 that is the one bucket, served from the public R2 domain.
  > 1. `contentType` is the client's value, unchecked (`UploadAudioFileSchema`: `z.string().min(1)`). It becomes the stored object's `Content-Type`, so `text/html` is storable.
  > 2. `fileSizeBytes` is client-sent and never compared with `buffer.length`. The stored size is whatever the base64 decodes to.
  > 3. The key is `${audioType}/${Date.now()}-${fileName.replace(/\s+/g, '_')}`. Only whitespace is replaced, and there is no `sanitizeFilename`.
  > 4. The object is uploaded **before** any project check. `uploadAudioAssetAction`, which inserts the row, runs after the object exists, so a caller who is not a project writer still leaves an object behind.
  > 5. Product question inside the fix: the dialog accepts `audio/x-m4a` (`upload-audio-dialog.tsx:212`), and `UPLOAD_CONSTRAINTS.audio` lists `audio/mp4` but not `audio/x-m4a`. A server allowlist taken from `UPLOAD_CONSTRAINTS` would start refusing `.m4a` files that upload today.
  >
  > Every other server-side audio upload (`voice-actions.ts:295,738`, `sfx-actions.ts:89`, `elevenlabs-music-actions.ts:82`, `core/sfx-core.ts:76`, `core/elevenlabs-music-core.ts:80`, `audio-asset-actions.ts:576,693`) stores bytes the server generated, under the literal type `audio/mpeg`. None of them is this class.
- **D2 (decided: not yet).** The integration test is committed and skipped in CI. It runs locally with `./scripts/s3-local.sh up` and `S3_LOCAL_ENDPOINT`, and its output is in the PR. Adding a MinIO service to the Unit Tests job is a small follow-up. It touches `.github/workflows/workflow.yml`, which FILM-1110 also edits.
- **D3 (decided: the owner applies it).** The comment is at `deployment/config/production.env:89`, in the private submodule, not in this repo, and this branch does not touch it. The replacement line is in the PR's "Before deploy (owner)" section:
  Line 89 becomes: `# Storage - every runtime upload uses STORAGE_PROVIDER (one provider for all; the content-type router is unused). Production: Cloudflare R2`
- **D4 (decided).** The KB-38 entry is added to FILM-CC-04, marked Fixed, with one Fixed-table row. KB-70 is added beside it, Open.

**Questions (the design does not depend on the answers, but the risk register does):**
- **Q1 (answered: yes, uploads work).** Every presigned URL since 2026-01-07 has carried `x-amz-checksum-crc32=AAAAAA==`, and uploads succeed, so R2 does not enforce it. This change removes the parameter for correctness (§0a B2); it does not repair anything.
- **Q2:** Does R2 enforce a signed `content-length`? It is unverified against R2 (§0.3). The §25 gate answers it on the first production upload.
- **Q3 (answered: yes).** 500 MB is the limit for edit-suite exports and master videos.

**Assumptions.** Production is R2 (owner). Browsers set `Content-Length` from a `File`/`Blob` body (to be shown in the one-off browser run, §26). No production values were read: the submodule file was searched for one comment string and only comment lines and variable names were printed.

**Found, not fixed here (for the lead to file or route):**
- The config templates set `STORAGE_PROVIDER=s3`, which the factory silently maps to `supabase` (§8.5).
- Cloudflare's JS v3 presigned-URL example implies `ContentType` is signed. It is not, with `@aws-sdk/s3-request-presigner` (§0.1). This is informational.
- KB-53 (avatars) and KB-39 (intro) uploaders go through the shared helper and are unaffected; their route refusals remain.

## 32. Implementation Plan

1. **Tests first (red):**
   - The signer unit test against the current adapter; record `SignedHeaders=host` plus the checksum failures.
   - The route `size` tests against KB-28's route (missing size → 200).
   - The helper and structural tests.
   - The MinIO integration test against the current adapter (records five 200s).
2. **Signer:**
   - `s3-presign.ts`, the options-object interface, `r2.ts`/`b2.ts` presign clients and the `endpoint` constructor option.
   - Supabase and local signatures.
   - Signer unit and MinIO integration green.
   - Red-before-green by removing each of `signableHeaders`, `ContentLength` and `WHEN_REQUIRED` in turn.
3. **Route:**
   - `uploadCategoryForType` in `upload-validation.ts`; the route's size check, canonical type and `headers`.
   - Update KB-28's route assertions; route tests green; red-before-green.
4. **Clients:**
   - The shared helper; U2 re-export; U3, U4, U5.
   - Helper and structural tests green; `pnpm typecheck`.
5. **E2E:**
   - Update KB-28's spec (size, new refusals).
   - Dev server on :3117 (DB lock first, then a heavy slot), then `build:test` plus the sandboxed `next start` (§27).
6. **Browser proof:** the one-off Chromium run against MinIO; save the output for the PR.
7. **Mutation guards:** `tooling/mutation-guards/kb-38.json`; run `--only` each entry.
8. **Records:**
   - FILM-CC-04 KB-38 entry (D4).
   - FILM-CC-01 evidence for the size criteria: the route and the R2 signature now enforce them server-side.
   - The env comment per D3.
   - `pnpm lint:fix`, `pnpm format:fix`.

There is no DB impact at any step. Each step's rollback is to revert its commit.

## 33. Definition of Done

- The R2 (and B2) presigned URL signs `content-length` and `content-type` and carries no empty-body checksum (unit, red then green).
- Against a real SigV4 server, mismatched type, missing type, larger body and smaller body are refused and store nothing; the matching PUT succeeds (MinIO, red then green, output in the PR).
- The route requires `size` and enforces the `UPLOAD_CONSTRAINTS` ceiling per category, with a clear message (unit, E2E).
- Every uploader declares the byte length of the body it PUTs and sends the returned headers (helper tests, structural test, UI E2E on dev and production build).
- Server-side `upload()` is unchanged.
- Typecheck, lint and format are clean. The mutation guards are recorded.
- The KB-38 record is updated. The env comment is resolved per D3. The §25 gate is written into the PR's "Before deploy / after deploy" section for the owner.

## 34. Final Consistency Pass

**Forward.** The problem: an upload URL binds only the key, so its holder can store any type and any size. The outcome: one URL, one declared type and exact size, within the product ceiling. The flow: unchanged for users, apart from oversize files being refused up front. The system: the route validates the declaration, the signer binds it, and R2 enforces the signature. The data: none new. Tests: signer, MinIO, route, helpers, structure, E2E. Production: the §25 gate.

**Reverse.** After deploy, the route signs `PutObject` with `SignedHeaders=content-length;content-type;host` and no checksum, for a declared size ≤ the ceiling. Browsers PUT the same `File`/`Blob` with the returned `Content-Type`, and their own `Content-Length` equals that size. R2 accepts it, and refuses any request whose type or length differs. That is the §1–§3 behaviour. The one thing this chain cannot prove without production is R2 honouring the signed length (Q2), which is why §25 gates on it.

The two directions converge. The one residual gap is the unverified bytes (§19.1), and it is stated rather than implied closed.
