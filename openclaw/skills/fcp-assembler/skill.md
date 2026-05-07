# Skill: FCP Assembler

## Purpose
Generate a Final Cut Pro XML (FCPXML 1.11) project file from the completed OpenClaw manifest, organizing all generated videos into a ready-to-import timeline.

## Trigger
"Assemble FCP project for episode {episodeTitle}" or "Create Final Cut Pro project"

## Prerequisites
- All videos are generated and downloaded (run `flow-video-generator` first)
- Manifest has `output.videoLocalPath` populated for all completed shots

## Steps

### 1. Read Manifest
1. Load `~/Desktop/openclaw-output/{episode-slug}/openclaw-manifest.json`
2. Filter to shots with `status === 'completed'`
3. Note any failed shots for the summary report

### 2. Organize Files

Verify all video files exist at their expected paths:
```
~/Desktop/openclaw-output/{episode-slug}/
├── Scene-1/
│   ├── Shot-1.1/video.mp4
│   ├── Shot-1.2/video.mp4
│   └── Shot-1.3/video.mp4
├── Scene-2/
│   ├── Shot-2.1/video.mp4
│   └── Shot-2.2/video.mp4
└── ...
```

### 3. Rename Videos for FCP

Rename each video to a descriptive format:
```
S{scene}-Shot{scene}.{shot}-{description-slug}.mp4
```

Example: `S1-Shot1.1-establishing-park-entrance.mp4`

### 4. Generate FCPXML

The Storybook app includes an FCPXML generator. Use it to create the project file:

1. Open the Storybook app in Chrome
2. Navigate to the episode's Visual Studio
3. Click "Export FCPXML" (if available)
4. OR: Use the manifest to generate FCPXML locally

The FCPXML should include:
- **Library event** named after the episode
- **Project** with a single sequence
- **Clips** in sequence order with correct durations
- **Keywords** marking each clip's scene number
- **File references** pointing to local video paths

Save to: `~/Desktop/openclaw-output/{episode-slug}/project.fcpxml`

### 5. Generate Summary Report

Create `~/Desktop/openclaw-output/{episode-slug}/SUMMARY.md`:

```markdown
# Episode: {title}
Generated: {date}

## Stats
- Total shots: {N}
- Completed: {N}
- Failed: {N}
- Total duration: {N} seconds ({N} minutes)
- Cuts: {N}
- Continuations: {N}

## Failed Shots (if any)
- Shot {scene}.{shot}: {error reason}

## How to Import
1. Open Final Cut Pro
2. File → Import → XML...
3. Select `project.fcpxml`
4. All clips will appear on the timeline in sequence order
5. Review and make final adjustments
```

### 6. Open in Final Cut Pro (optional)

If Final Cut Pro is installed:
1. Double-click `project.fcpxml` to open in FCP
2. Or: In FCP, go to File → Import → XML → select `project.fcpxml`

## Output
- `project.fcpxml` — Ready-to-import FCP project file
- `SUMMARY.md` — Generation report
- Organized video files in scene folders
- All assets in one self-contained directory

## Error Handling
- If any video files are missing, generate FCPXML with only available clips and note gaps in SUMMARY.md
- If FCPXML generation fails, create a simple import manifest as fallback
