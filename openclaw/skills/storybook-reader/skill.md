# Skill: Storybook Reader

## Purpose
Read the shot list from the Storybook app and download the OpenClaw manifest with all associated assets (character images, location images) to a local working directory.

## Trigger
"Read shot list for episode {episodeTitle}" or "Download manifest for episode {episodeId}"

## Prerequisites
- Storybook app is running (localhost:3000 or production URL)
- User is logged in to Storybook in Chrome

## Steps

### 1. Navigate to Visual Studio
1. Open Chrome
2. Navigate to the episode's Visual Studio page
3. Wait for the shot list to fully load (look for shot cards with scene numbers)

### 2. Export OpenClaw Manifest
1. Find the "Export for OpenClaw" button in the toolbar (near the existing "Export VEO" button)
2. Click it
3. A JSON file `openclaw-manifest.json` will be downloaded to the Downloads folder
4. Move it to the working directory: `~/Desktop/openclaw-output/{episode-slug}/`

### 3. Download All Assets
For each shot in the manifest:

#### Character Images
1. For each character in `shot.ingredients.characters`:
   - Download `character.imageUrl` to `~/Desktop/openclaw-output/{episode-slug}/characters/{character-name}.png`
   - Update `character.localPath` in the manifest

#### Location Images
1. For each unique location in `shot.ingredients.location`:
   - Download `location.imageUrl` to `~/Desktop/openclaw-output/{episode-slug}/locations/{location-name}.png`
   - Update `location.localPath` in the manifest

### 4. Create Shot Folders
For each shot in the manifest:
1. Create directory: `~/Desktop/openclaw-output/{episode-slug}/Scene-{N}/Shot-{N.M}/`
2. Copy relevant character images into the shot folder
3. Copy location image into the shot folder

### 5. Save Updated Manifest
Save the manifest with all `localPath` fields populated back to:
`~/Desktop/openclaw-output/{episode-slug}/openclaw-manifest.json`

## Output
- Local directory with all assets organized per shot
- Updated manifest with local file paths
- Ready for `flow-image-generator` skill

## Error Handling
- If Storybook is not reachable, wait 10 seconds and retry (max 3 retries)
- If an image URL returns 404, log the error but continue (mark as missing in manifest)
- If the "Export for OpenClaw" button is not found, fall back to "Export VEO" and extract from ZIP
