---
spec_id: SPIKE-04
status: ✅ DONE
audited: 2026-09-23
---

# SPIKE-04: Video Stitching Approaches Evaluation

## Metadata
- **Priority**: P0
- **Effort**: M (Medium - 3-5 days)
- **Timeline**: Sprint 1, Week 2-3
- **Owner**: TBD
- **Status**: ✅ DONE
- **Created**: 2025-12-04
- **Completed**: 2025-12-09

## Objective

Evaluate and compare different approaches for stitching multiple shot videos into a cohesive final episode, with focus on the timeline editor integration. Determine the best solution balancing quality, speed, cost, and developer experience.

## Background

Our episodes consist of multiple shots (5-10 second videos) that need to be combined with transitions, audio, and potentially effects. The stitching solution must integrate with a timeline editor where users can arrange shots, add transitions, and preview their edit. This spike builds on SPIKE-02 but focuses specifically on the stitching problem and timeline integration.

## Research Questions

### 1. FFmpeg Concat Approaches
- What are the different FFmpeg concat methods? (concat demuxer, concat protocol, filter_complex)
- Which method preserves quality best?
- Which method is fastest?
- How do we add transitions between clips? (xfade filter)
- Can we avoid re-encoding where possible?
- What's the command complexity for 10 clips with transitions?

### 2. Remotion Approach
- How does Remotion handle video composition?
- Can we import external video files?
- How do we implement custom transitions?
- What's the rendering time for 10 clips?
- How does Remotion's timeline model map to our needs?
- Can we preview edits in real-time?

### 3. Cloud Render Services
**Shotstack**:
- How do we define edit timelines in JSON?
- What transition types are available?
- What's the render time at different priorities?
- What's the actual cost per render?
- How reliable is the service?

**Creatomate**:
- Similar evaluation to Shotstack
- Compare template flexibility
- Evaluate API ease of use

**Mux**:
- Is Mux Video suitable for stitching use case?
- Can Mux stitch uploaded videos?
- What's the latency and cost?

### 4. Quality Assessment
- What quality loss occurs with re-encoding?
- How do transitions affect quality?
- Are there visible seams between clips?
- How does audio quality hold up?
- Do different codecs affect quality?
- Can we maintain source quality?

### 5. Speed & Performance
- What's the render time for a 60-second episode (10x 6s clips)?
- How does render time scale with video count?
- What's the variability in render times?
- Can we provide accurate time estimates to users?
- What's faster: local FFmpeg vs cloud rendering?

### 6. Cost Analysis
- FFmpeg: Server costs, compute time
- Remotion: Cloud rendering costs
- Shotstack/Creatomate: Per-render API costs
- What's the cost at 100 renders/day? 1000/day?
- Break-even points between approaches?

### 7. Audio Synchronization
- How do we ensure audio stays perfectly synced?
- Can we add background music layer?
- How do we handle audio crossfades?
- What if clips have different audio formats?
- Can we normalize audio levels across clips?

### 8. Timeline Editor Integration
- How does timeline JSON/data structure map to each solution?
- Can we support real-time preview?
- How do we handle timeline changes (add/remove/reorder clips)?
- Can we cache partial renders?
- What's the feedback loop for editing?

### 9. Transitions & Effects
- What transition types can we support? (cut, fade, crossfade, wipe, etc.)
- How smooth are the transitions?
- Can we control transition duration?
- Can we add text overlays?
- Can we add opening/closing credits?

### 10. Developer Experience
- How complex is the implementation?
- How maintainable is the code?
- How easy is it to add new features?
- What's the debugging experience like?
- How well does it integrate with our TypeScript stack?

## Approach

### Phase 1: FFmpeg Concat Deep Dive (10 hours)
1. Test concat demuxer (no re-encoding)
2. Test concat protocol
3. Test filter_complex with concat filter
4. Implement xfade transitions between clips
5. Test with 10 sample clips
6. Measure render times with different approaches
7. Compare quality with source videos
8. Add audio mixing and background music
9. Document FFmpeg command patterns
10. Create utility functions for timeline -> FFmpeg conversion

### Phase 2: Remotion Proof of Concept (12 hours)
1. Set up Remotion project
2. Create composition that imports external videos
3. Implement custom transition components
4. Create timeline-based composition
5. Test with 10 sample clips
6. Measure local rendering time
7. Test cloud rendering (Lambda)
8. Evaluate preview capabilities
9. Compare quality with FFmpeg
10. Document integration approach

### Phase 3: Shotstack Evaluation (8 hours)
1. Sign up and get API credentials
2. Create edit JSON for 10-clip video
3. Test different transition types
4. Submit render and measure time
5. Test webhook callbacks
6. Evaluate output quality
7. Test error scenarios
8. Calculate costs at scale
9. Document API integration

### Phase 4: Creatomate Evaluation (8 hours)
1. Similar evaluation to Shotstack
2. Compare template flexibility
3. Test rendering speed
4. Compare costs
5. Evaluate developer experience
6. Document pros/cons vs Shotstack

### Phase 5: Quality Comparison (6 hours)
1. Render same edit with each approach
2. Compare visually at 100% zoom
3. Measure file sizes
4. Check audio sync precision
5. Evaluate transition smoothness
6. Test on different devices
7. Create side-by-side comparison video
8. Document quality findings

### Phase 6: Timeline Integration Design (8 hours)
1. Define timeline JSON schema
2. Create sample timeline with 10 clips
3. Implement timeline -> FFmpeg converter
4. Implement timeline -> Remotion converter
5. Implement timeline -> Shotstack JSON converter
6. Test adding/removing/reordering clips
7. Test changing transitions
8. Design preview generation strategy

### Phase 7: Performance Testing (8 hours)
1. Render 20 videos with each approach
2. Measure render times (min, max, avg, p95)
3. Test with different video counts (5, 10, 20 clips)
4. Test with different clip durations
5. Measure resource usage (CPU, memory, disk)
6. Test concurrent renders
7. Identify bottlenecks
8. Create performance comparison charts

### Phase 8: Cost-Benefit Analysis (4 hours)
1. Calculate infrastructure costs (FFmpeg)
2. Calculate cloud rendering costs (Remotion)
3. Calculate API costs (Shotstack, Creatomate)
4. Project costs at different scales
5. Factor in development time
6. Factor in maintenance overhead
7. Create cost comparison matrix
8. Identify break-even points

## Success Criteria

- [ ] ~~Working implementation of each approach with sample edit~~ — *audit: retired* — `packages/features/video-rendering/src/{ffmpeg,remotion,cloud}` and `poc/` were deleted in 5b88db3a
- [ ] Quality comparison with visual examples — *audit: no longer true* — comparison is a subjective score table (`docs/stitching-benchmarks.md:121`); no visual example was ever committed to `docs/examples/stitched-videos/`
- [x] Performance benchmarks across all approaches
- [x] Cost analysis for 100, 1K, 10K renders per day
- [ ] ~~Timeline JSON schema defined~~ — *audit: retired* — `packages/features/video-rendering/schema/timeline.json` was deleted in 5b88db3a; a field mapping survives at `docs/video-stitching-comparison.md:212`
- [ ] ~~Integration code for at least 2 approaches~~ — *audit: retired* — the FFmpeg and Shotstack/Creatomate code went with `video-rendering` in 5b88db3a; the edit suite exports via `packages/features/edit-suite/src/lib/ffmpeg-builder.ts:101`
- [x] Clear recommendation with justification
- [x] Fallback strategy if primary approach fails

## Deliverables

1. **Stitching Comparison Report** (`docs/video-stitching-comparison.md`)
   - Detailed comparison matrix
   - Quality assessment with screenshots
   - Performance benchmarks
   - Cost analysis
   - Recommendation and rationale

2. **Timeline Schema** (`packages/video-rendering/schema/timeline.json`)
   - JSON schema for timeline data structure
   - Example timelines
   - Validation rules
   - Documentation of fields

3. **FFmpeg Stitching Implementation** (`packages/video-rendering/src/ffmpeg/`)
   - Timeline to FFmpeg converter
   - Command builder utilities
   - Transition implementations
   - Audio mixing functions
   - Error handling

4. **Remotion Implementation** (`packages/video-rendering/src/remotion/`)
   - Timeline to Remotion composition converter
   - Custom transition components
   - Render job manager
   - Preview generation

5. **Cloud Service Integration** (`packages/video-rendering/src/cloud/`)
   - Shotstack API client
   - Creatomate API client
   - Timeline to API JSON converters
   - Webhook handlers

6. **Sample Renders** (`docs/examples/stitched-videos/`)
   - Same edit rendered with each approach
   - Various transition styles
   - Different clip counts
   - Quality comparison video

7. **Performance Benchmarks** (`docs/stitching-benchmarks.md`)
   - Render time charts
   - Cost per render calculations
   - Resource usage profiles
   - Scale projections

## Risks if Not Completed

### Critical Risks (P0)
- **Poor Quality**: Chosen approach produces unacceptable video quality
- **Slow Renders**: Users wait too long for videos to process
- **Cost Explosion**: Rendering costs make business model unviable
- **Technical Limitations**: Can't implement required features with chosen approach

### High Risks (P1)
- **Audio Sync Issues**: Lip sync problems make videos unusable
- **Transition Quality**: Jarring transitions hurt user experience
- **Scalability Issues**: Solution doesn't scale with user growth
- **Lock-in**: Vendor lock-in makes it hard to switch later

### Medium Risks (P2)
- **Complexity**: Implementation too complex to maintain
- **Preview Issues**: Can't provide good preview experience
- **Format Limitations**: Can't accept all video formats from Kling
- **Effect Limitations**: Can't add desired effects or overlays

## Dependencies

- Sample shot videos from Kling (from SPIKE-01)
- Sample audio tracks and music
- Cloud service trial accounts
- Server environment for testing
- Timeline editor UI mockups/design

## Related Spikes

- SPIKE-02: FFmpeg Pipeline (broader evaluation)
- Timeline editor design (UX team)
- Video format requirements from SPIKE-01

## Decision Framework

### Choose FFmpeg if:
- Full control over rendering is important
- Cost at scale is primary concern
- Team can handle operational complexity
- Quality and performance are comparable
- Flexibility for custom features is needed

### Choose Remotion if:
- Developer experience is high priority
- React/TypeScript expertise on team
- Preview capabilities are important
- Cost is acceptable at scale
- Want to avoid infrastructure management

### Choose Cloud Service if:
- Speed to market is critical
- Don't want rendering infrastructure
- Cost is reasonable at expected scale
- Feature set matches requirements
- Reliability meets SLA needs

## Testing Checklist

Video Quality:
- [ ] ~~No visible compression artifacts~~ — *audit: retired* — the stitching PoC it tests was deleted in 5b88db3a
- [ ] ~~Smooth transitions without stuttering~~ — *audit: retired* — the stitching PoC it tests was deleted in 5b88db3a
- [ ] ~~Audio perfectly in sync~~ — *audit: retired* — the stitching PoC it tests was deleted in 5b88db3a
- [ ] ~~Consistent brightness/color across clips~~ — *audit: retired* — the stitching PoC it tests was deleted in 5b88db3a
- [ ] ~~No audio clicks or pops at transitions~~ — *audit: retired* — the stitching PoC it tests was deleted in 5b88db3a

Performance:
- [ ] ~~60s video renders in < 2 minutes~~ — *audit: retired* — the stitching PoC it tests was deleted in 5b88db3a
- [ ] ~~Can handle 10 concurrent renders~~ — *audit: retired* — the stitching PoC it tests was deleted in 5b88db3a
- [ ] ~~Resource usage stays within bounds~~ — *audit: retired* — the stitching PoC it tests was deleted in 5b88db3a
- [ ] ~~Progress tracking works accurately~~ — *audit: retired* — the stitching PoC it tests was deleted in 5b88db3a

Integration:
- [ ] ~~Timeline JSON converts correctly~~ — *audit: retired* — the stitching PoC it tests was deleted in 5b88db3a
- [ ] ~~Can add/remove clips dynamically~~ — *audit: retired* — the stitching PoC it tests was deleted in 5b88db3a
- [ ] ~~Transition changes apply correctly~~ — *audit: retired* — the stitching PoC it tests was deleted in 5b88db3a
- [ ] ~~Preview generation works~~ — *audit: retired* — the stitching PoC it tests was deleted in 5b88db3a
- [ ] ~~Error handling is robust~~ — *audit: retired* — the stitching PoC it tests was deleted in 5b88db3a

## Notes

- Consider hybrid approach: FFmpeg for simple cuts, Remotion for complex edits
- Audio sync is critical - test extensively
- User expectation: render time should be < video duration
- Quality bar: must match or exceed YouTube's rendering
- Consider allowing users to choose render quality (fast vs HQ)
- Plan for render queue and job management
- Consider resumable renders for long episodes

## References

- FFmpeg Concat: https://trac.ffmpeg.org/wiki/Concatenate
- FFmpeg Xfade: https://ffmpeg.org/ffmpeg-filters.html#xfade
- Remotion: https://remotion.dev
- Shotstack: https://shotstack.io/docs/
- Creatomate: https://creatomate.com/docs
- Mux Video: https://docs.mux.com/guides/video/
