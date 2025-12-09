# Video Rendering POC

This directory contains proof-of-concept implementations for evaluating different video rendering approaches.

## Directory Structure

```
poc/
├── ffmpeg-server/       # Server-side FFmpeg with Node.js
├── ffmpeg-wasm/         # Client-side FFmpeg using WebAssembly
├── remotion/            # Remotion React-based video rendering
└── cloud-services/      # Cloud rendering service integrations
```

## FFmpeg Server POC

Server-side video rendering using FFmpeg through `fluent-ffmpeg`.

### Features
- Video concatenation
- Transition effects (crossfade, dissolve, wipe)
- Audio mixing
- Progress tracking via Server-Sent Events
- Concurrent job management

### Usage

```bash
cd ffmpeg-server
npm install
npm start
# Server runs on http://localhost:3001
```

### Endpoints

- `POST /render` - Start a render job
- `GET /progress/:jobId` - Get render progress
- `DELETE /render/:jobId` - Cancel a render

## FFmpeg.wasm Demo

Browser-based video rendering using FFmpeg compiled to WebAssembly.

### Limitations
- Memory constraints (~2GB in modern browsers)
- Single-threaded (slow)
- Limited codec support
- No hardware acceleration

### Usage

Open `index.html` in a modern browser (Chrome/Firefox recommended).

## Remotion Sample

React-based video composition using Remotion.

### Features
- Declarative video composition
- React component model
- Server-side rendering via Lambda
- Preview in development

### Usage

```bash
cd remotion
npm install
npm start
# Preview at http://localhost:3000
```

## Cloud Services

Integration examples for cloud rendering services.

### Shotstack
- Pay-per-render pricing
- REST API for video composition
- Good for simple stitching

### Creatomate
- Template-based rendering
- Real-time preview
- Slightly cheaper than Shotstack

### Mux
- Streaming-focused (not suitable for composition)
- Great for delivery, not rendering

## Comparison Results

See `docs/video-rendering-comparison.md` for detailed comparison including:
- Feature matrix
- Performance benchmarks
- Cost analysis
- Recommendations
