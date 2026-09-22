---
spec_id: FILM-716
status: ✅ DONE
audited: 2026-09-23
---

# FILM-716: Master Video Record Keeping

## 1. Product Requirements Document (PRD)

### 1.1 Problem Statement
Currently, StoryBook allows publishing episodes to multiple channels (YouTube, Facebook, etc.) with videos localized for different languages. To avoid "reused content" flags from platforms like YouTube (which use pixel hashing), the system burns subtitles into the video, making each localized version visually distinct (approx. 10% difference).

However, this creates a significant issue for future IP monetization. If the studio wants to sell the rights to a series or episode to a broadcaster or streaming service, they require "clean" assets (videos without burned-in subtitles) so they can apply their own localization. We currently lack a dedicated, persistent record of the clean "Master Video".

Additionally, episodes often have localized Title Cards/Intros (e.g., text in Hindi, Spanish). These high-quality assets also need to be archived as "Master Title Cards" to avoid losing the source material. Since the same Intro/Title Card might be used across multiple episodes (e.g., a series intro), we need to avoid uploading duplicate files and wasting storage.

### 1.2 Solution Overview
Implement a **Master Asset Record Keeping** feature. This allows creators to upload and store distinct master assets. These assets:
- Are **NOT** for direct social media publishing.
- Are **clean** (Master Video) or **source quality** (Master Title Card).
- Are stored securely in **Cloudflare R2** (S3-compatible).
- Include **Smart Deduplication** logic to prevent re-uploading identical files.

### 1.3 Key Features
1.  **Master Video Upload**:
    - Upload high-quality clean video file (Master Video).
    - Support for large file sizes.
2.  **Master Title Card Upload**:
    - Upload clean or localized title card assets (Video or Image).
    - Ability to manage these assets per episode.
3.  **Smart Deduplication**:
    - Calculate SHA-256 hash of files client-side before upload.
    - Check if the hash already exists in the project.
    - If it exists, link to the existing asset instead of re-uploading.
4.  **Storage**:
    - Use Cloudflare R2 (via S3 SDK) for cost-effective storage.

### 1.4 User Stories
- **As a Producer**, I want to upload a clean Master Video so I have a pristine copy for licensing.
- **As a Producer**, I want to upload the localized title card used for this episode's intro.
- **As a Studio Admin**, I want the system to detect if I'm uploading a duplicate Video (e.g., same series intro) and link it automatically to save storage and bandwidth.
- **As an IP Seller**, I want to download the clean Master Video and Title Cards to send to a buyer.

---

## 2. Engineering Design

### 2.1 Database Schema Changes

We will leverage the existing `assets` table to store these master files, allowing for metadata and reuse. We will link them to the `episodes` table.

#### Table: `public.assets`
We will add a column to store the file hash for deduplication.
- **New Column**: `file_hash` (text, nullable) - SHA-256 hash of the file content.
- **New Types**: `master_video`, `master_title_card` (add to constraint check).

#### Table: `public.episodes`
We need to reference the specific master assets for this episode.
- **New Column**: `master_video_asset_id` (uuid) - References `public.assets(id)`.
- **New Column**: `master_title_card_asset_id` (uuid) - References `public.assets(id)`.

### 2.2 Storage Strategy (Cloudflare R2)
- **Bucket**: Reuse the project assets bucket (configured via S3 compatible env vars).
- **Paths**:
    - Master Video: `projects/{projectId}/assets/master_video/{filename}`
    - Master Title Card: `projects/{projectId}/assets/master_title_card/{filename}`
- **Deduplication Flow**:
    1.  User selects file.
    2.  Frontend calculates SHA-256 hash.
    3.  Frontend queries `checkAssetHashAction(hash, projectId)`.
    4.  **Match Found**:
        - Show "Duplicate File Detected".
        - Display existing asset details (Name, Uploaded By).
        - Offer "Use Existing" button.
        - If user clicks "Use Existing", calls `updateEpisodeAction` with the existing `assetId`.
    5.  **No Match**:
        - Proceed with standard upload flow (Pre-signed URL -> Upload -> Create Asset Record).

### 2.3 API & Server Actions

#### `packages/features/assets/src/server/asset-actions.ts`
1.  **`checkAssetHashAction(hash: string, projectId: string)`**:
    - Queries `assets` table for matching `file_hash` and `project_id`.
    - Returns minimal asset info if found.

2.  **`createAssetAction`**:
    - Update to accept `fileHash` in the payload and store it.

#### `packages/features/episodes/src/server/actions.ts`
1.  **`updateEpisodeAction`**:
    - Update schema/logic to accept `masterVideoAssetId` and `masterTitleCardAssetId`.

### 2.4 UI Implementation

#### Component: `MasterAssetManager`
A reusable component for managing a specific master asset type (Video or Title Card).
- **Props**: `type` ('master_video' | 'master_title_card'), `currentAsset`, `onAssetSelect`.
- **State**: `checkingHash`, `uploading`, `duplicateFound`.
- **View**:
    - **Empty**: Upload area (Dropzone).
    - **Has Asset**:
        - Preview (Thumbnail/Video player).
        - File Info (Name, Size, Hash).
        - Actions: "Download", "Replace".

#### Integration
- **EpisodePublishPage**: Add `MasterAssetManager` twice:
    1.  For **Master Video**.
    2.  For **Master Title Card**.

---

## 3. Implementation Plan

### Phase 1: Database & Backend
1.  **Migration**:
    - Add `file_hash` column to `assets` table.
    - Update `assets` table check constraint to include new types.
    - Add `master_video_asset_id` and `master_title_card_asset_id` to `episodes` table.
2.  **Types**: Regenerate Supabase types.
3.  **Actions**:
    - Update `createAsset` schema and action.
    - Create `checkAssetHashAction`.
    - Update `updateEpisode` schema and action.

### Phase 2: Frontend components
1.  **Schema**: Update form schemas to match new actions.
2.  **Component**: Build `MasterAssetManager` with hashing logic (`crypto.subtle.digest`).
3.  **Integration**: Add to Episode Studio > Publish tab.

### Phase 3: Verification
1.  **Test Upload**: Upload a new master video. Verify it appears.
2.  **Test Deduplication**:
    - Upload the *same file* for a different episode.
    - Verify UI prompts to "Use Existing".
    - Confirm no new file is uploaded to R2.
3.  **Test Download**: Verify the signed URL allows downloading the master.
