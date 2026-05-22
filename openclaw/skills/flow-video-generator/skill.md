# Skill: Flow Video Generator

## Purpose
Generate videos for each shot using Google Flow's Veo 3.1 engine with the "Ingredients-to-Video" workflow. Uses character/location reference images and first/last frame controls for deterministic, consistent output.

## Trigger
"Generate videos for episode {episodeTitle}" or "Generate video for shot {shotId}"

## Prerequisites
- Chrome is logged into Google Flow
- First/last frames are generated (run `flow-image-generator` first)
- Manifest is populated with all frame local paths

## Steps for Each Shot

### 1. Navigate to Video Generation
1. Go to flow.google.com
2. Click "Create" or start a new generation
3. Select "Video" mode (Veo 3.1)

### 2. Upload Ingredients (Reference Images)

For consistent character and location appearance across shots:

1. **Characters:** For each character in `shot.ingredients.characters`:
   - Click "Add Ingredient" or "+" button
   - Upload the character image from `character.localPath`
   - Flow will use this as a visual anchor for character consistency

2. **Location:** If `shot.ingredients.location` exists:
   - Upload the location image from `location.localPath`
   - This sets the environment style/mood

### 3. Set First Frame (if available)

This is where the cut-vs-continuation decision matters:

| Scenario | Action |
|----------|--------|
| `shot.inheritLastFrame === true` | Upload the file at `shot.output.firstFrameLocalPath` (which is a copy of previous shot's last frame) as "First Frame" |
| `shot.firstFrameSource === 'generated'` | Upload the generated first frame from `shot.output.firstFrameLocalPath` as "First Frame" |
| No first frame available | Skip — let Veo choose the starting composition |

**How to set First Frame on Flow:**
1. Look for "First Frame" or "Starting Image" option
2. Click to upload
3. Select the first-frame.png from the shot folder

### 4. Set Last Frame (if available)

If `shot.output.lastFrameLocalPath` exists:
1. Look for "Last Frame" or "Ending Image" option  
2. Upload the last-frame.png
3. This creates a controlled "motion arc" between two known states

### 5. Paste VEO Prompt

1. Click on the prompt input field
2. Paste `shot.veoPrompt` from the manifest
3. **Do NOT modify the prompt** — it's already optimized for Veo 3.1

### 6. Configure Settings
- **Duration:** `shot.duration` seconds (typically 8s)
- **Aspect Ratio:** 16:9
- **Resolution:** 1080p (or highest available)

### 7. Generate
1. Click "Generate"
2. Wait for the video to be generated (typically 30-120 seconds)
3. **Do NOT navigate away** — Flow may cancel the generation

### 8. Wait for Completion
- Check every 15-30 seconds if the video has finished generating
- Flow shows a progress indicator or thumbnail when complete
- If generation takes more than 5 minutes, it may have failed — check for error messages

### 9. Download Video
1. Once complete, click the download button on the generated video
2. Save to: `~/Desktop/openclaw-output/{episode-slug}/Scene-{N}/Shot-{N.M}/video.mp4`
3. Update manifest: `shot.output.videoLocalPath` = local path
4. Update manifest: `shot.status` = `'completed'`

### 10. Save Manifest
After each video download, save the updated manifest to disk for crash recovery.

## Processing Order

**CRITICAL:** Process in strict sequence order because continuation shots depend on previous shots.

```
For each shot in manifest.shots (sorted by sequence):
  1. Upload ingredients (characters + location)
  2. Upload first frame (generated or inherited)
  3. Upload last frame (if available)
  4. Paste VEO prompt
  5. Set duration + aspect ratio
  6. Generate
  7. Wait for completion
  8. Download video
  9. Update manifest
  10. Move to next shot
```

## Error Handling

- **Generation fails:** Retry once with same settings. If still fails, try without first/last frame constraints (just ingredients + prompt). If still fails, mark `shot.status = 'failed'` and continue.
- **Download fails:** Retry download. If Flow lost the video, regenerate.
- **Session timeout:** Navigate back to flow.google.com. Session should auto-restore if Chrome profile is persistent.
- **Rate limiting:** If Flow shows "too many requests", wait 60 seconds before next generation.
- **Credit exhaustion:** If Flow says no credits remaining, stop processing and update manifest with remaining shots marked as `'pending'`. Report to user.

## Output
- Video files saved to each shot folder
- Updated manifest with all video paths and statuses
- Ready for `fcp-assembler` skill
