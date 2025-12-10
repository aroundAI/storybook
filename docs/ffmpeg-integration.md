# FFmpeg Integration Guide

> Complete guide for integrating FFmpeg into the Film Studio platform.
>
> **SPIKE-02: FFmpeg Pipeline**

---

## Table of Contents

1. [Installation](#installation)
2. [Basic Operations](#basic-operations)
3. [Node.js Integration](#nodejs-integration)
4. [Common Command Patterns](#common-command-patterns)
5. [Error Handling](#error-handling)
6. [Performance Optimization](#performance-optimization)
7. [Troubleshooting](#troubleshooting)

---

## Installation

### macOS

```bash
# Using Homebrew
brew install ffmpeg

# With all codecs
brew install ffmpeg --with-fdk-aac --with-sdl2 --with-freetype
```

### Ubuntu/Debian

```bash
# Basic installation
sudo apt update
sudo apt install ffmpeg

# With additional codecs
sudo apt install ffmpeg libavcodec-extra
```

### Alpine Linux (Docker)

```dockerfile
RUN apk add --no-cache \
    ffmpeg \
    ffmpeg-libs \
    x264 \
    x265 \
    libvpx \
    lame \
    opus
```

### Verify Installation

```bash
# Check FFmpeg version and available codecs
ffmpeg -version
ffmpeg -codecs | grep -E "(h264|h265|vp9|aac)"
ffprobe -version
```

---

## Basic Operations

### Video Information

```bash
# Get video metadata (JSON format)
ffprobe -v quiet -print_format json -show_format -show_streams input.mp4

# Get duration only
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 input.mp4
```

### Simple Concatenation

```bash
# Method 1: Concat demuxer (same codec, fastest)
# Create file list
echo "file 'video1.mp4'" > list.txt
echo "file 'video2.mp4'" >> list.txt
echo "file 'video3.mp4'" >> list.txt

# Concatenate without re-encoding
ffmpeg -f concat -safe 0 -i list.txt -c copy output.mp4

# Method 2: Concat filter (different codecs, re-encodes)
ffmpeg -i video1.mp4 -i video2.mp4 -i video3.mp4 \
  -filter_complex "[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[outv][outa]" \
  -map "[outv]" -map "[outa]" output.mp4
```

### Trimming

```bash
# Trim from start to duration
ffmpeg -i input.mp4 -ss 00:00:10 -t 00:00:30 -c copy output.mp4

# Trim with re-encoding (more accurate)
ffmpeg -i input.mp4 -ss 00:00:10 -to 00:00:40 output.mp4
```

### Scaling/Resolution

```bash
# Scale to 1080p (maintain aspect ratio)
ffmpeg -i input.mp4 -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" output.mp4

# Scale to 720p
ffmpeg -i input.mp4 -vf "scale=1280:720" output.mp4
```

---

## Node.js Integration

### Using fluent-ffmpeg

```typescript
import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';

// Configure FFmpeg paths (optional)
ffmpeg.setFfmpegPath('/usr/bin/ffmpeg');
ffmpeg.setFfprobePath('/usr/bin/ffprobe');

// Basic concatenation
async function concatenateVideos(
  inputPaths: string[],
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg();

    // Add all inputs
    inputPaths.forEach((input) => command.input(input));

    // Build filter complex
    const filterInputs = inputPaths.map((_, i) => `[${i}:v][${i}:a]`).join('');
    const filterComplex = `${filterInputs}concat=n=${inputPaths.length}:v=1:a=1[outv][outa]`;

    command
      .complexFilter(filterComplex)
      .outputOptions(['-map [outv]', '-map [outa]'])
      .output(outputPath)
      .on('start', (cmd) => console.log('Started:', cmd))
      .on('progress', (progress) => console.log('Progress:', progress.percent))
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

// Get video duration
async function getVideoDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration || 0);
    });
  });
}
```

### With Progress Tracking

```typescript
interface RenderProgress {
  percent: number;
  currentTime: string;
  targetSize: number;
  currentKbps: number;
}

function renderWithProgress(
  request: RenderRequest,
  onProgress: (progress: RenderProgress) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const outputPath = `/tmp/${Date.now()}.mp4`;
    const command = ffmpeg();

    // Setup inputs and filters...

    command
      .on('progress', (progress) => {
        onProgress({
          percent: progress.percent || 0,
          currentTime: progress.timemark,
          targetSize: progress.targetSize,
          currentKbps: progress.currentKbps,
        });
      })
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}
```

---

## Common Command Patterns

### Crossfade Transition

```bash
# Crossfade between two videos (0.5 second transition)
ffmpeg -i video1.mp4 -i video2.mp4 \
  -filter_complex "\
    [0:v][1:v]xfade=transition=fade:duration=0.5:offset=4.5[outv];\
    [0:a][1:a]acrossfade=d=0.5[outa]" \
  -map "[outv]" -map "[outa]" output.mp4
```

### Multiple Transitions

```bash
# Chain crossfades between three videos
ffmpeg -i v1.mp4 -i v2.mp4 -i v3.mp4 \
  -filter_complex "\
    [0:v][1:v]xfade=transition=fade:duration=0.5:offset=4.5[v01];\
    [v01][2:v]xfade=transition=fade:duration=0.5:offset=9[outv];\
    [0:a][1:a]acrossfade=d=0.5[a01];\
    [a01][2:a]acrossfade=d=0.5[outa]" \
  -map "[outv]" -map "[outa]" output.mp4
```

### Add Background Music

```bash
# Mix background music under video audio
ffmpeg -i video.mp4 -i music.mp3 \
  -filter_complex "\
    [1:a]volume=0.3[music];\
    [0:a][music]amix=inputs=2:duration=first[outa]" \
  -map 0:v -map "[outa]" output.mp4
```

### Text Overlay

```bash
# Add text to video
ffmpeg -i input.mp4 \
  -vf "drawtext=text='Episode 1':fontcolor=white:fontsize=48:x=(w-tw)/2:y=50:enable='between(t,0,3)'" \
  output.mp4
```

### Quality Presets

```bash
# Draft (fast, larger file)
ffmpeg -i input.mp4 -c:v libx264 -preset ultrafast -crf 28 output.mp4

# Standard (balanced)
ffmpeg -i input.mp4 -c:v libx264 -preset medium -crf 23 output.mp4

# High quality (slow, smaller file)
ffmpeg -i input.mp4 -c:v libx264 -preset slow -crf 18 output.mp4
```

### Web-Optimized MP4

```bash
# Fast start for web streaming
ffmpeg -i input.mp4 \
  -c:v libx264 -preset medium -crf 23 \
  -c:a aac -b:a 192k \
  -movflags +faststart \
  output.mp4
```

---

## Error Handling

### Common Errors and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| "Invalid data found when processing input" | Corrupt input file | Validate input with ffprobe first |
| "No such filter" | Missing FFmpeg codec/filter | Install FFmpeg with required codecs |
| "Output file already exists" | File exists | Add `-y` flag to overwrite |
| "Discarded samples" | Audio sample rate mismatch | Use `aresample` filter |
| "Out of memory" | Too many inputs/complex filter | Process in chunks |

### Error Handling in Node.js

```typescript
import ffmpeg from 'fluent-ffmpeg';

async function safeRender(inputs: string[], output: string): Promise<void> {
  // Validate inputs exist
  for (const input of inputs) {
    if (!fs.existsSync(input)) {
      throw new Error(`Input file not found: ${input}`);
    }
  }

  // Validate inputs with ffprobe
  for (const input of inputs) {
    try {
      await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(input, (err, metadata) => {
          if (err) reject(new Error(`Invalid input: ${input}`));
          if (!metadata.format.duration) reject(new Error(`No duration: ${input}`));
          resolve(metadata);
        });
      });
    } catch (err) {
      throw new Error(`Failed to probe ${input}: ${err.message}`);
    }
  }

  // Render with error handling
  return new Promise((resolve, reject) => {
    ffmpeg()
      // ... setup
      .on('error', (err, stdout, stderr) => {
        console.error('FFmpeg stderr:', stderr);
        reject(new Error(`Render failed: ${err.message}`));
      })
      .on('end', resolve)
      .run();
  });
}
```

---

## Performance Optimization

### 1. Use Copy Codec When Possible

```bash
# Fast copy (no re-encoding) - only for same codec inputs
ffmpeg -f concat -safe 0 -i list.txt -c copy output.mp4
```

### 2. Hardware Acceleration

```bash
# NVIDIA NVENC (GPU encoding)
ffmpeg -i input.mp4 -c:v h264_nvenc -preset fast output.mp4

# Intel Quick Sync (VAAPI)
ffmpeg -vaapi_device /dev/dri/renderD128 -i input.mp4 \
  -vf 'format=nv12,hwupload' -c:v h264_vaapi output.mp4

# macOS VideoToolbox
ffmpeg -i input.mp4 -c:v h264_videotoolbox output.mp4
```

### 3. Parallel Processing

```bash
# Enable multi-threading
ffmpeg -threads 0 -i input.mp4 output.mp4  # Auto-detect threads

# Specific thread count
ffmpeg -threads 4 -i input.mp4 output.mp4
```

### 4. Two-Pass Encoding (Better Quality/Size)

```bash
# Pass 1: Analysis
ffmpeg -i input.mp4 -c:v libx264 -b:v 2M -pass 1 -f null /dev/null

# Pass 2: Encoding
ffmpeg -i input.mp4 -c:v libx264 -b:v 2M -pass 2 output.mp4
```

### 5. Memory Management

```typescript
// Process large jobs in chunks
async function renderLargeJob(shots: Shot[]): Promise<string> {
  const chunkSize = 10;
  const chunks = [];

  for (let i = 0; i < shots.length; i += chunkSize) {
    const chunk = shots.slice(i, i + chunkSize);
    const chunkOutput = `/tmp/chunk_${i}.mp4`;
    await renderChunk(chunk, chunkOutput);
    chunks.push(chunkOutput);
  }

  // Concatenate chunks (copy codec - fast)
  const finalOutput = await concatenateChunks(chunks);

  // Cleanup
  chunks.forEach((c) => fs.unlinkSync(c));

  return finalOutput;
}
```

---

## Troubleshooting

### Debug FFmpeg Output

```bash
# Verbose logging
ffmpeg -v debug -i input.mp4 output.mp4

# Show filter graph
ffmpeg -v debug -filter_complex_script filter.txt -i input.mp4 output.mp4

# Report generation
ffmpeg -report -i input.mp4 output.mp4
```

### Check Codec Support

```bash
# List available encoders
ffmpeg -encoders | grep h264

# List available decoders
ffmpeg -decoders | grep h264

# Check specific codec
ffmpeg -h encoder=libx264
```

### Validate Output

```bash
# Check output file integrity
ffprobe -v error -i output.mp4

# Get frame count
ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of default=nokey=1:noprint_wrappers=1 output.mp4
```

---

## Quick Reference

### Resolution Presets

| Name | Width | Height | Aspect |
|------|-------|--------|--------|
| 480p | 854 | 480 | 16:9 |
| 720p | 1280 | 720 | 16:9 |
| 1080p | 1920 | 1080 | 16:9 |
| 4K | 3840 | 2160 | 16:9 |

### CRF Quality Guide

| CRF | Quality | Use Case |
|-----|---------|----------|
| 18 | High | Final output, archival |
| 23 | Standard | Default, balanced |
| 28 | Low | Drafts, previews |

### Preset Speed/Quality Tradeoff

| Preset | Speed | Size |
|--------|-------|------|
| ultrafast | Fastest | Largest |
| fast | Fast | Large |
| medium | Balanced | Balanced |
| slow | Slow | Small |
| veryslow | Slowest | Smallest |

---

*Document created as part of SPIKE-02: FFmpeg Pipeline Evaluation*
*Last updated: December 2024*
