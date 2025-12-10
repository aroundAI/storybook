# Stitched Video Examples

This directory contains example timeline JSON files and documentation for the video stitching approaches.

## Example Timeline

See `packages/features/video-rendering/schema/example-timeline.json` for a complete timeline example that demonstrates:

- Multiple video clips with transitions
- Multi-track audio (dialogue, music, SFX)
- Audio fades and volume control
- Render settings configuration

## Converting Timeline to Provider Format

### FFmpeg

```typescript
import { convertTimelineToFFmpeg } from '@kit/video-rendering/ffmpeg';
import timeline from './example-timeline.json';

const ffmpegData = convertTimelineToFFmpeg(timeline);
console.log(ffmpegData.command);
// ffmpeg -i input1.mp4 -i input2.mp4 ... -filter_complex "[0:v][1:v]xfade=..." output.mp4
```

### Remotion

```typescript
import { convertTimelineToRemotion, generateRemotionCompositionCode } from '@kit/video-rendering/remotion';
import timeline from './example-timeline.json';

const remotionProps = convertTimelineToRemotion(timeline);
const componentCode = generateRemotionCompositionCode(timeline);
// Generates a React component using Remotion primitives
```

### Shotstack

```typescript
import { convertTimelineToShotstack } from '@kit/video-rendering/cloud/shotstack';
import timeline from './example-timeline.json';

const shotstackEdit = convertTimelineToShotstack(timeline, {
  webhookUrl: 'https://myapp.com/webhooks/shotstack'
});
// Returns Shotstack Edit JSON format
```

### Creatomate

```typescript
import { convertTimelineToCreatomate } from '@kit/video-rendering/cloud/creatomate';
import timeline from './example-timeline.json';

const creatomateRequest = convertTimelineToCreatomate(timeline, {
  webhookUrl: 'https://myapp.com/webhooks/creatomate',
  metadata: JSON.stringify({ projectId: 'proj_123' })
});
// Returns Creatomate render request format
```

## Using the Provider Factory

```typescript
import { createRenderProvider } from '@kit/video-rendering/providers';
import timeline from './example-timeline.json';

// Create provider based on configuration
const provider = await createRenderProvider('shotstack', {
  apiKey: process.env.SHOTSTACK_API_KEY,
  environment: 'staging',
});

// Submit render job
const job = await provider.render({
  timeline,
  webhookUrl: 'https://myapp.com/webhooks/render',
});

console.log(`Job ID: ${job.jobId}`);
console.log(`Status: ${job.status}`);
console.log(`Estimated time: ${job.estimatedTime}s`);

// Poll for status
const status = await provider.getStatus(job.jobId);
if (status.status === 'completed') {
  console.log(`Video URL: ${status.videoUrl}`);
}
```

## Sample Output

When a render completes, you receive:

```json
{
  "jobId": "render_abc123",
  "status": "completed",
  "progress": 1.0,
  "videoUrl": "https://cdn.provider.com/renders/abc123.mp4",
  "thumbnailUrl": "https://cdn.provider.com/renders/abc123-thumb.jpg",
  "startedAt": "2024-01-15T10:30:00Z",
  "completedAt": "2024-01-15T10:30:45Z",
  "metadata": {
    "duration": 30.5,
    "fileSize": 15000000
  }
}
```

## Cost Estimation

```typescript
import { createRenderProvider } from '@kit/video-rendering/providers';

const provider = await createRenderProvider('creatomate', config);
const estimate = provider.estimateCost(timeline);

console.log(`Estimated cost: ${estimate.displayCost}`);
console.log(`Breakdown:`, estimate.breakdown);
// {
//   baseCost: 0,
//   perSecondCost: 0.04,
//   durationSeconds: 30,
//   qualityMultiplier: 1,
//   resolutionMultiplier: 1
// }
```

## Related Documentation

- [Video Stitching Comparison](../../video-stitching-comparison.md)
- [Stitching Benchmarks](../../stitching-benchmarks.md)
- [Timeline JSON Schema](../../../packages/features/video-rendering/schema/timeline.json)
