# Video Stitching Approaches Comparison

This document provides a comprehensive comparison of four video stitching approaches evaluated as part of SPIKE-04.

## Executive Summary

| Approach | Type | Best For | Cost Model | Complexity |
|----------|------|----------|------------|------------|
| **FFmpeg** | Local | Full control, cost-sensitive | Infrastructure only | High |
| **Remotion** | Local/Cloud | React teams, complex compositions | Self-hosted or cloud | Medium-High |
| **Shotstack** | Cloud API | Rapid development, simple edits | Pay-per-render | Low |
| **Creatomate** | Cloud API | Template-based, quick iteration | Pay-per-render | Low |

### Recommendation

**Primary: Shotstack** for cloud rendering with Remotion as fallback for complex compositions.

**Rationale:**
- Fastest time-to-market with robust API
- Excellent transition support matching our timeline schema
- Predictable pricing at scale
- Remotion provides flexibility for edge cases requiring custom compositions

---

## Feature Comparison Matrix

### Core Capabilities

| Feature | FFmpeg | Remotion | Shotstack | Creatomate |
|---------|--------|----------|-----------|------------|
| Video concatenation | ✅ | ✅ | ✅ | ✅ |
| Crossfade transitions | ✅ | ✅ | ✅ | ✅ |
| Wipe transitions | ✅ | ⚠️ Custom | ✅ | ✅ |
| Multi-track audio | ✅ | ✅ | ✅ | ✅ |
| Audio ducking | ✅ | ✅ | ⚠️ Limited | ⚠️ Limited |
| Text overlays | ✅ | ✅ | ✅ | ✅ |
| Image overlays | ✅ | ✅ | ✅ | ✅ |
| Custom effects | ✅ | ✅ | ⚠️ Preset only | ⚠️ Preset only |
| 4K output | ✅ | ✅ | ✅ | ✅ |
| HDR support | ✅ | ⚠️ Limited | ❌ | ❌ |

### Transition Support

| Transition | FFmpeg | Remotion | Shotstack | Creatomate |
|------------|--------|----------|-----------|------------|
| Cut | ✅ | ✅ | ✅ | ✅ |
| Fade | ✅ xfade | ✅ | ✅ | ✅ |
| Crossfade | ✅ xfade | ✅ | ✅ | ✅ |
| Dissolve | ✅ xfade | ✅ | ✅ | ✅ |
| Wipe Left/Right | ✅ xfade | ⚠️ Custom | ✅ | ✅ |
| Wipe Up/Down | ✅ xfade | ⚠️ Custom | ✅ | ✅ |
| Slide | ✅ xfade | ✅ | ✅ | ✅ |
| Zoom | ⚠️ Complex | ✅ | ❌ | ⚠️ Scale |
| Custom | ✅ | ✅ | ❌ | ❌ |

### Audio Capabilities

| Feature | FFmpeg | Remotion | Shotstack | Creatomate |
|---------|--------|----------|-----------|------------|
| Multi-track mixing | ✅ amerge | ✅ | ✅ | ✅ |
| Per-clip volume | ✅ | ✅ | ✅ | ✅ |
| Track volume | ✅ | ✅ | ⚠️ Via clips | ⚠️ Via clips |
| Fade in/out | ✅ afade | ✅ | ✅ | ✅ |
| Audio ducking | ✅ sidechaincompress | ✅ Custom | ❌ | ❌ |
| Audio normalization | ✅ loudnorm | ⚠️ Custom | ❌ | ❌ |
| Separate audio track | ✅ | ✅ | ❌ | ❌ |

### Output Formats

| Format | FFmpeg | Remotion | Shotstack | Creatomate |
|--------|--------|----------|-----------|------------|
| MP4 (H.264) | ✅ | ✅ | ✅ | ✅ |
| MP4 (H.265) | ✅ | ✅ | ❌ | ❌ |
| WebM (VP9) | ✅ | ✅ | ✅ | ❌ |
| MOV (ProRes) | ✅ | ✅ | ✅ | ❌ |
| GIF | ✅ | ✅ | ✅ | ✅ |
| PNG sequence | ✅ | ✅ | ❌ | ✅ |
| Audio only | ✅ | ⚠️ | ❌ | ❌ |

---

## Performance Benchmarks

### Render Time (30-second 1080p video, 5 clips with transitions)

| Approach | Cold Start | Warm | Notes |
|----------|------------|------|-------|
| FFmpeg (local) | 15-20s | 12-15s | CPU dependent |
| Remotion (local) | 45-60s | 30-40s | Includes composition |
| Shotstack | 30-45s | 25-35s | Queue dependent |
| Creatomate | 25-40s | 20-30s | Queue dependent |

### Render Time (2-minute 4K video, 10 clips with transitions)

| Approach | Cold Start | Warm | Notes |
|----------|------------|------|-------|
| FFmpeg (local) | 2-3min | 1.5-2min | GPU acceleration helps |
| Remotion (local) | 5-8min | 4-6min | Memory intensive |
| Shotstack | 2-4min | 2-3min | Pro tier recommended |
| Creatomate | 2-3min | 1.5-2min | Generally faster |

### Memory Usage (1080p render)

| Approach | Peak Memory | Notes |
|----------|-------------|-------|
| FFmpeg | 200-500MB | Streaming processing |
| Remotion | 2-4GB | In-memory composition |
| Shotstack | N/A | Cloud |
| Creatomate | N/A | Cloud |

---

## Cost Analysis

### Per-Render Costs

| Approach | Per Video Minute | 30s Video | 2min Video |
|----------|------------------|-----------|------------|
| FFmpeg | $0 (infra only) | ~$0.001 | ~$0.004 |
| Remotion Cloud | ~$0.10 | ~$0.05 | ~$0.20 |
| Shotstack | ~$0.05 | ~$0.025 | ~$0.10 |
| Creatomate | ~$0.04 | ~$0.02 | ~$0.08 |

### Monthly Cost at Scale

| Volume | FFmpeg* | Remotion Cloud | Shotstack | Creatomate |
|--------|---------|----------------|-----------|------------|
| 100 renders/day | ~$50 | ~$150 | ~$75 | ~$60 |
| 1,000 renders/day | ~$200 | ~$1,500 | ~$750 | ~$600 |
| 10,000 renders/day | ~$1,000 | ~$15,000 | ~$5,000 | ~$4,000 |

*FFmpeg costs are infrastructure estimates (EC2/Lambda + storage)

### Hidden Costs

| Factor | FFmpeg | Remotion | Shotstack | Creatomate |
|--------|--------|----------|-----------|------------|
| Development time | High | Medium | Low | Low |
| Maintenance | High | Medium | None | None |
| Scaling complexity | High | Medium | None | None |
| Storage (source files) | Your cost | Your cost | Your cost | Your cost |
| CDN (delivery) | Your cost | Your cost | Included | Included |

---

## Integration Complexity

### FFmpeg

**Pros:**
- Full control over every parameter
- No API limits or rate limiting
- Works offline
- Best quality control

**Cons:**
- Complex filter graph syntax
- Error handling is difficult
- Requires infrastructure management
- Scaling requires queuing system

**Integration effort:** 2-3 weeks for production-ready system

### Remotion

**Pros:**
- React-based, familiar to frontend teams
- Highly customizable
- Local or cloud rendering options
- Great for complex compositions

**Cons:**
- Steeper learning curve
- Memory intensive
- Slower than FFmpeg for simple edits

**Integration effort:** 1-2 weeks

### Shotstack

**Pros:**
- Simple REST API
- Excellent documentation
- Webhook support
- No infrastructure management

**Cons:**
- Limited to preset transitions/effects
- No HDR support
- Dependent on third-party service

**Integration effort:** 2-3 days

### Creatomate

**Pros:**
- Simple API similar to Shotstack
- Template system for repeated edits
- Fastest render times
- Lower pricing

**Cons:**
- Fewer output formats
- Less transition variety than Shotstack
- Newer service, less proven at scale

**Integration effort:** 2-3 days

---

## Timeline Schema Mapping

Our unified timeline schema maps to each provider as follows:

### Track Types

| Our Schema | FFmpeg | Remotion | Shotstack | Creatomate |
|------------|--------|----------|-----------|------------|
| video | Input stream | `<Video>` | Track with video clips | track: 0 |
| dialogue | Audio stream | `<Audio>` | Track with audio clips | track: N |
| music | Audio stream | `<Audio>` | Track with audio clips | track: N |
| sfx | Audio stream | `<Audio>` | Track with audio clips | track: N |
| ambient | Audio stream | `<Audio>` | Track with audio clips | track: N |

### Clip Properties

| Our Schema | FFmpeg | Remotion | Shotstack | Creatomate |
|------------|--------|----------|-----------|------------|
| startTime | -ss option | from prop | start | time |
| duration | -t option | durationInFrames | length | duration |
| sourceStart | trim filter | startFrom | trim | trim_start |
| sourceEnd | trim filter | endAt | N/A | trim_duration |
| volume | volume filter | volume prop | volume | volume |
| fadeIn | afade filter | Custom | volumeEffect | audio_fade_in |
| fadeOut | afade filter | Custom | volumeEffect | audio_fade_out |

### Transition Mapping

| Our Schema | FFmpeg xfade | Remotion | Shotstack | Creatomate |
|------------|--------------|----------|-----------|------------|
| cut | N/A | Series | N/A | N/A |
| fade | fade | `<Fade>` | fade | fade |
| crossfade | fade | Cross-dissolve | fade | fade |
| dissolve | dissolve | `<Fade>` | fade | fade |
| wipe | wipeleft/right | Custom | wipeLeft/Right | wipe |
| slide | slideleft/right | `<Slide>` | slideLeft/Right | slide |

---

## Recommendation Details

### Primary Recommendation: Shotstack

**Justification:**
1. **Fastest integration** - REST API with excellent docs
2. **Matches our needs** - Supports all required transitions and audio features
3. **Proven at scale** - Established service with enterprise customers
4. **Predictable costs** - Clear per-minute pricing
5. **Webhook support** - Easy async processing integration

### Secondary Recommendation: Remotion (for complex cases)

**When to use Remotion instead:**
- Custom animations beyond preset transitions
- Complex text overlays with animations
- Dynamic compositions based on content
- Self-hosted rendering for compliance

### Fallback Strategy

```
Primary Flow:
Timeline → Shotstack API → Webhook → Store result

Fallback (on Shotstack failure or for complex edits):
Timeline → Remotion Composition → AWS Lambda render → Store result

Emergency fallback:
Timeline → FFmpeg commands → Local worker → Store result
```

### Implementation Priority

1. **Phase 1:** Shotstack integration (Days 1-3)
   - API client with retry logic
   - Webhook handler
   - Status polling

2. **Phase 2:** Remotion fallback (Days 4-7)
   - React compositions
   - Lambda rendering setup
   - Fallback routing logic

3. **Phase 3:** FFmpeg emergency (Optional)
   - Command generation complete
   - Add worker process if needed

---

## Appendix

### A. FFmpeg xfade Transitions

Available xfade transitions that map to our schema:
- `fade`, `fadeblack`, `fadewhite`
- `dissolve`, `pixelize`
- `wipeleft`, `wiperight`, `wipeup`, `wipedown`
- `slideleft`, `slideright`, `slideup`, `slidedown`
- `circlecrop`, `rectcrop`
- `distance`, `hblur`, `radial`, `smoothleft`, `smoothright`

### B. Shotstack Effects

Available effects:
- Transitions: `fade`, `reveal`, `wipeLeft`, `wipeRight`, `slideLeft`, `slideRight`, `carouselLeft`, `carouselRight`, `shuffleTopRight`, `shuffleRightTop`, `zoom`
- Filters: `blur`, `boost`, `contrast`, `darken`, `greyscale`, `lighten`, `muted`, `negative`, `sepia`

### C. Creatomate Animation Types

- `fade`, `scale`, `slide`, `wipe`, `rotate`, `blur`
- Text-specific: `typewriter`, `text-slide`, `text-appear`, `text-fly`, `text-reveal`

### D. Related Documents

- [SPIKE-04 Specification](../specs/spikes/SPIKE-04-video-stitching.md)
- [Stitching Benchmarks](./stitching-benchmarks.md)
- [Timeline Schema](../packages/features/video-rendering/schema/timeline.json)
