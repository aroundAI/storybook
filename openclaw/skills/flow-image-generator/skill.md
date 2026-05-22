# Skill: Flow Image Generator

## Purpose
Generate first-frame and last-frame images for shots using Google Flow's Nano Banana Pro image generation engine. These frames provide deterministic start/end states for video generation.

## Trigger
"Generate frames for episode {episodeTitle}" or "Generate first frame for shot {shotId}"

## Prerequisites
- Chrome is logged into Google Flow (flow.google.com)
- Manifest is downloaded with all asset paths populated (run `storybook-reader` first)
- Character and location images are available locally

## Decision Logic

Before generating, read the manifest to determine what each shot needs:

### Shot needs a GENERATED first frame when:
- `shot.firstFrameSource === 'generated'`
- `shot.inheritLastFrame === false`
- `shot.firstFrameDescription` exists

### Shot INHERITS first frame when:
- `shot.inheritLastFrame === true`
- Copy `previousShot.output.lastFrameLocalPath` to `currentShot.output.firstFrameLocalPath`
- **DO NOT generate an image** — just copy the file

### Shot needs a last frame when:
- `shot.lastFrameDescription` exists
- Always generate (needed by next shot if it's a continuation)

## Steps for Each Frame Generation

### 1. Navigate to Flow Image Generation
1. Go to flow.google.com
2. Click on "Create" or "New Generation"
3. Select "Image" mode (Nano Banana Pro)

### 2. Upload Reference Images

Based on `shot.frameStrategy`:

| Frame Strategy | What to Upload |
|---------------|----------------|
| `character_focus` | Primary character image as ingredient |
| `environment_focus` | Location image as ingredient |
| `two_shot` | Both character images as ingredients + location |
| `group` | All character images as ingredients + location |
| `detail_insert` | Location image only |

**How to upload ingredients on Flow:**
1. Click the "+" or "Add Reference" button
2. Select "Upload Image" 
3. Navigate to the local file path from the manifest
4. Upload the image
5. Repeat for additional ingredients

### 3. Write the Prompt
1. Click on the prompt input field
2. Paste the `firstFrameDescription` or `lastFrameDescription` from the manifest
3. **Important:** Do NOT over-describe character appearances — the reference images handle that. Focus on composition, camera angle, lighting, and positioning.

### 4. Configure Settings
- Output format: PNG or JPG
- Aspect ratio: 16:9 (for video frames)
- Quality: High

### 5. Generate
1. Click "Generate"
2. Wait for the image to appear (typically 5-15 seconds)
3. Review the generated image briefly — if it's obviously wrong (no character visible, wrong scene), retry once with slightly adjusted prompt

### 6. Download
1. Right-click (or use download button) on the generated image
2. Save to: `~/Desktop/openclaw-output/{episode-slug}/Scene-{N}/Shot-{N.M}/first-frame.png` or `last-frame.png`
3. Update manifest: `shot.output.firstFrameLocalPath` or `shot.output.lastFrameLocalPath`

## Processing Order

Process shots in **sequence order** because continuation shots need the previous shot's last frame:

```
For each shot in manifest.shots (sorted by sequence):
  1. If shot.inheritLastFrame:
     → Copy previous shot's last-frame.png → current shot's first-frame.png
  2. Else if shot.firstFrameDescription:
     → Generate first frame on Flow
  3. If shot.lastFrameDescription:
     → Generate last frame on Flow
  4. Save updated manifest
```

## Error Handling
- If Flow fails to generate: retry once with same prompt. If still fails, add "(Plain background, simple composition)" to prompt and retry.
- If upload fails: verify file exists at local path, retry upload
- If session expires: navigate to flow.google.com and wait for auto-redirect to logged-in state
- After each frame: save manifest to disk (crash recovery)

## Output
- First frame images saved to shot folders
- Last frame images saved to shot folders
- Updated manifest with all frame `localPath` fields populated
- Ready for `flow-video-generator` skill
