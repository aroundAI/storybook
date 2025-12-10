# Video Rendering Package

This package provides video stitching and rendering capabilities, evaluating multiple approaches as part of SPIKE-04.

## Overview

The package evaluates four video stitching approaches:

1. **FFmpeg** - Local command-line rendering with full control
2. **Remotion** - React-based video composition framework
3. **Shotstack** - Cloud rendering API service
4. **Creatomate** - Cloud rendering API service

## Package Structure

```
src/
├── schema/              # Timeline Zod schemas
├── types/               # TypeScript type definitions
├── providers/           # Provider factory and base interface
├── ffmpeg/              # FFmpeg command generation
├── remotion/            # Remotion compositions and converters
└── cloud/
    ├── shotstack/       # Shotstack API client
    └── creatomate/      # Creatomate API client
schema/
├── timeline.json        # JSON Schema export
└── example-timeline.json # Example timeline data
```

## Timeline Schema

The unified timeline schema works across all approaches:

```typescript
import { TimelineSchema, type Timeline } from '@kit/video-rendering/schema';

// Validate timeline data
const result = TimelineSchema.safeParse(data);
```

## Provider Factory

```typescript
import { createRenderProvider, type RenderProvider } from '@kit/video-rendering/providers';

const provider = createRenderProvider('ffmpeg', config);
const result = await provider.render(timeline);
```

## FFmpeg Usage

```typescript
import { buildStitchCommand, convertTimelineToFFmpeg } from '@kit/video-rendering/ffmpeg';

const ffmpegCommand = convertTimelineToFFmpeg(timeline);
// Execute with child_process or fluent-ffmpeg
```

## Cloud Services

```typescript
import { ShotstackClient } from '@kit/video-rendering/cloud/shotstack';
import { CreatomateClient } from '@kit/video-rendering/cloud/creatomate';

const shotstack = new ShotstackClient({ apiKey: process.env.SHOTSTACK_API_KEY });
const creatomate = new CreatomateClient({ apiKey: process.env.CREATOMATE_API_KEY });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SHOTSTACK_API_KEY` | Shotstack API key |
| `SHOTSTACK_ENV` | Shotstack environment (staging/production) |
| `CREATOMATE_API_KEY` | Creatomate API key |

## Testing

```bash
pnpm --filter @kit/video-rendering test
pnpm --filter @kit/video-rendering test:coverage
```

## Related Specs

- SPIKE-04: Video Stitching Approaches Evaluation
- FILM-604: Auto-Stitch Logic
- FILM-601: Timeline Editor
