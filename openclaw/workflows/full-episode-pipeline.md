# Full Episode Pipeline

## Overview

This is the master orchestration workflow for generating an entire episode's video content autonomously. It chains all four skills in sequence, processing every shot from shot list to Final Cut Pro project.

## Pipeline Flow

```
┌──────────────────────┐
│  1. STORYBOOK READER │  Read shot list, download manifest + all assets
│     (~5 min)         │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  2. FRAME GENERATOR  │  Generate first/last frame images on Flow
│     (~30-60 min)     │  (Nano Banana Pro)
│     ~110 images      │  Respects frame chain: continuations inherit
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  3. VIDEO GENERATOR  │  Generate all videos on Flow (Veo 3.1)
│     (~2-4 hours)     │  Ingredients-to-Video workflow
│     ~55 videos       │  Sequential processing, strict order
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  4. FCP ASSEMBLER    │  Generate FCPXML, organize files
│     (~2 min)         │  Ready for Final Cut Pro import
└──────────────────────┘
```

**Estimated total time: 3-5 hours (unattended)**

## Execution Steps

### Phase 1: Read & Prepare
```
Use skill: storybook-reader

1. Navigate to Storybook Visual Studio for the target episode
2. Click "Export for OpenClaw"
3. Download the manifest JSON
4. Download all character images
5. Download all location images
6. Create shot folder structure
7. Save updated manifest with local paths

Checkpoint: All localPath fields populated in manifest
```

### Phase 2: Generate Frames
```
Use skill: flow-image-generator

For each shot in sequence order:

  IF shot.inheritLastFrame === true:
    → Copy previous shot's last-frame.png → current shot first-frame.png
    → Log: "Shot {N}: Inherited first frame from shot {N-1}"
    
  ELSE IF shot.firstFrameDescription exists:
    → Navigate to Flow → Image generation
    → Upload ingredients based on frameStrategy:
      - character_focus → character image
      - environment_focus → location image  
      - two_shot → both character images + location
    → Paste firstFrameDescription as prompt
    → Generate → Download → Save to shot folder
    → Log: "Shot {N}: Generated first frame"

  IF shot.lastFrameDescription exists:
    → Same process with lastFrameDescription
    → Save as last-frame.png
    → Log: "Shot {N}: Generated last frame"

  Save manifest after each shot (crash recovery)

Checkpoint: All frame localPaths populated
```

### Phase 3: Generate Videos
```
Use skill: flow-video-generator

For each shot in sequence order:

  1. Navigate to Flow → Video generation (Veo 3.1)
  2. Upload character ingredients from shot folder
  3. Upload location ingredient from shot folder
  4. If first-frame.png exists → Upload as "First Frame"
  5. If last-frame.png exists → Upload as "Last Frame"
  6. Paste shot.veoPrompt into prompt field
  7. Set duration: shot.duration seconds
  8. Set aspect ratio: 16:9
  9. Click Generate
  10. Wait for completion (check every 15-30 seconds)
  11. Download video → Save to shot folder as video.mp4
  12. Update manifest: status = 'completed'
  13. Save manifest (crash recovery)
  14. Log: "Shot {N}: Video generated successfully"

  On failure:
    → Retry once
    → If still fails, mark as 'failed' and continue
    → Log: "Shot {N}: FAILED - {error}"

Checkpoint: All video localPaths populated
```

### Phase 4: Assemble FCP Project
```
Use skill: fcp-assembler

1. Read final manifest
2. Verify all video files exist
3. Rename videos to descriptive format
4. Generate project.fcpxml
5. Generate SUMMARY.md with stats
6. Log final report

Checkpoint: project.fcpxml ready for import
```

## Crash Recovery

The manifest is saved to disk after every operation. If the pipeline crashes:

1. Read the manifest
2. Find the last shot with `status !== 'pending'`
3. Resume from the next shot
4. For frame generation: check which shots have `output.firstFrameLocalPath` populated
5. For video generation: check which shots have `output.videoLocalPath` populated

## Completion Report

When the pipeline finishes, output:

```
═══════════════════════════════════════
  EPISODE GENERATION COMPLETE
═══════════════════════════════════════

  Episode: {title}
  Total shots: {N}
  Completed: {N} ✓
  Failed: {N} ✗
  Duration: {N} seconds ({N}m {N}s)
  
  Cuts: {N}
  Continuations: {N}
  
  Output: ~/Desktop/openclaw-output/{episode-slug}/
  FCP Project: project.fcpxml
  
  Next step: Open project.fcpxml in Final Cut Pro
═══════════════════════════════════════
```
