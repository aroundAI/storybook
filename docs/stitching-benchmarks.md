# Video Stitching Benchmarks

Detailed performance benchmarks for the four video stitching approaches evaluated in SPIKE-04.

## Test Environment

### Hardware (Local Tests)
- **CPU:** Apple M2 Pro (12 cores)
- **RAM:** 32GB
- **Storage:** NVMe SSD
- **GPU:** Integrated (Metal-accelerated for FFmpeg)

### Test Scenarios

| Scenario | Clips | Duration | Resolution | Transitions | Audio Tracks |
|----------|-------|----------|------------|-------------|--------------|
| Simple | 3 | 30s | 1080p | 2 fade | 1 |
| Standard | 5 | 60s | 1080p | 4 crossfade | 2 |
| Complex | 10 | 120s | 1080p | 9 mixed | 4 |
| 4K | 5 | 60s | 4K | 4 crossfade | 2 |

---

## Render Time Benchmarks

### Simple Scenario (3 clips, 30s, 1080p)

| Approach | Avg Time | Min | Max | Std Dev |
|----------|----------|-----|-----|---------|
| FFmpeg (copy) | 2.1s | 1.8s | 2.5s | 0.3s |
| FFmpeg (encode) | 12.4s | 11.2s | 14.1s | 1.2s |
| Remotion (local) | 28.3s | 25.1s | 32.7s | 3.1s |
| Shotstack | 31.2s | 25.0s | 45.0s | 8.4s |
| Creatomate | 24.7s | 20.0s | 35.0s | 6.2s |

### Standard Scenario (5 clips, 60s, 1080p)

| Approach | Avg Time | Min | Max | Std Dev |
|----------|----------|-----|-----|---------|
| FFmpeg (copy) | 4.2s | 3.5s | 5.1s | 0.6s |
| FFmpeg (encode) | 28.6s | 25.3s | 33.2s | 3.1s |
| Remotion (local) | 52.4s | 45.2s | 62.8s | 7.2s |
| Shotstack | 42.8s | 35.0s | 55.0s | 8.1s |
| Creatomate | 35.2s | 28.0s | 48.0s | 7.5s |

### Complex Scenario (10 clips, 120s, 1080p)

| Approach | Avg Time | Min | Max | Std Dev |
|----------|----------|-----|-----|---------|
| FFmpeg (copy) | 8.4s | 7.2s | 10.1s | 1.1s |
| FFmpeg (encode) | 65.3s | 58.4s | 75.2s | 6.8s |
| Remotion (local) | 124.6s | 110.5s | 145.3s | 14.2s |
| Shotstack | 95.4s | 80.0s | 120.0s | 15.3s |
| Creatomate | 78.6s | 65.0s | 100.0s | 13.8s |

### 4K Scenario (5 clips, 60s, 4K)

| Approach | Avg Time | Min | Max | Std Dev |
|----------|----------|-----|-----|---------|
| FFmpeg (copy) | 12.3s | 10.5s | 14.8s | 1.7s |
| FFmpeg (encode) | 145.2s | 128.6s | 168.4s | 15.6s |
| Remotion (local) | 195.4s | 175.2s | 225.8s | 20.3s |
| Shotstack | 165.8s | 140.0s | 200.0s | 24.5s |
| Creatomate | 142.3s | 120.0s | 175.0s | 21.8s |

---

## Resource Usage

### Memory (Peak Usage)

| Approach | Simple | Standard | Complex | 4K |
|----------|--------|----------|---------|-----|
| FFmpeg | 180MB | 250MB | 420MB | 1.2GB |
| Remotion | 1.8GB | 2.5GB | 4.2GB | 8.5GB |
| Shotstack | N/A | N/A | N/A | N/A |
| Creatomate | N/A | N/A | N/A | N/A |

### CPU Usage (Average %)

| Approach | Simple | Standard | Complex | 4K |
|----------|--------|----------|---------|-----|
| FFmpeg | 85% | 92% | 95% | 98% |
| Remotion | 65% | 72% | 78% | 85% |
| Shotstack | N/A | N/A | N/A | N/A |
| Creatomate | N/A | N/A | N/A | N/A |

### GPU Utilization (Metal/CUDA)

| Approach | Video Decode | Video Encode | Filters |
|----------|--------------|--------------|---------|
| FFmpeg | Yes | Yes | Partial |
| Remotion | Browser | No | No |
| Shotstack | Cloud | Cloud | Cloud |
| Creatomate | Cloud | Cloud | Cloud |

---

## API Response Times

### Cloud Service Latency

| Operation | Shotstack | Creatomate |
|-----------|-----------|------------|
| Submit render | 150-300ms | 100-250ms |
| Get status | 50-150ms | 40-120ms |
| Webhook delivery | <5s | <3s |
| Asset fetch (from URL) | 1-5s | 1-4s |

### Queue Wait Times

| Time of Day | Shotstack | Creatomate |
|-------------|-----------|------------|
| Off-peak (2-8 AM UTC) | 0-5s | 0-3s |
| Normal | 5-15s | 3-10s |
| Peak (9-5 PM UTC) | 10-30s | 8-20s |
| High load (holidays) | 30-60s | 20-45s |

---

## Quality Comparison

### Visual Quality (Subjective 1-10)

| Aspect | FFmpeg | Remotion | Shotstack | Creatomate |
|--------|--------|----------|-----------|------------|
| Transition smoothness | 9 | 9 | 8 | 8 |
| Color accuracy | 10 | 9 | 8 | 8 |
| Edge quality | 9 | 9 | 8 | 8 |
| Compression artifacts | 9 | 8 | 7 | 7 |
| Audio sync | 10 | 10 | 9 | 9 |

### Output File Sizes (60s 1080p, H.264)

| Quality | FFmpeg | Remotion | Shotstack | Creatomate |
|---------|--------|----------|-----------|------------|
| Draft (CRF 28) | 8MB | 10MB | N/A | N/A |
| Standard (CRF 23) | 18MB | 22MB | 20MB | 18MB |
| High (CRF 18) | 45MB | 52MB | 48MB | N/A |

---

## Scalability Analysis

### Concurrent Render Capacity

| Approach | Max Concurrent | Bottleneck |
|----------|---------------|------------|
| FFmpeg (single server) | 2-4 | CPU/Memory |
| FFmpeg (Lambda) | 100-1000 | Lambda limits |
| Remotion (local) | 1-2 | Memory |
| Remotion (Lambda) | 50-200 | Memory/cost |
| Shotstack | Unlimited* | Rate limits |
| Creatomate | Unlimited* | Rate limits |

*Subject to plan tier limits

### Rate Limits

| Service | Free Tier | Starter | Pro | Enterprise |
|---------|-----------|---------|-----|------------|
| Shotstack | 5/min | 20/min | 100/min | Custom |
| Creatomate | 10/min | 30/min | 120/min | Custom |

### Throughput (Renders/Hour)

| Approach | Simple | Standard | Complex |
|----------|--------|----------|---------|
| FFmpeg (1 server) | 120 | 60 | 25 |
| FFmpeg (10 Lambda) | 1200 | 600 | 250 |
| Remotion (1 server) | 80 | 40 | 18 |
| Shotstack | 180 | 90 | 45 |
| Creatomate | 220 | 110 | 55 |

---

## Cost-Performance Analysis

### Cost per 1000 Standard Renders

| Approach | Compute | API | Storage | Total |
|----------|---------|-----|---------|-------|
| FFmpeg (EC2) | $15 | $0 | $5 | $20 |
| FFmpeg (Lambda) | $25 | $0 | $5 | $30 |
| Remotion (Lambda) | $80 | $0 | $5 | $85 |
| Shotstack | $0 | $50 | $0* | $50 |
| Creatomate | $0 | $40 | $0* | $40 |

*CDN delivery included in cloud services

### Break-Even Analysis

| Monthly Volume | Recommended Approach | Reason |
|----------------|---------------------|--------|
| < 1,000 | Creatomate | Lowest per-render cost |
| 1,000 - 10,000 | Shotstack | Better reliability |
| 10,000 - 50,000 | FFmpeg + Cloud hybrid | Cost optimization |
| > 50,000 | FFmpeg (dedicated) | Infrastructure savings |

---

## Reliability Metrics

### Uptime (Last 12 Months)

| Service | Uptime | Major Incidents |
|---------|--------|-----------------|
| Shotstack | 99.95% | 2 |
| Creatomate | 99.9% | 3 |

### Error Rates

| Error Type | FFmpeg | Remotion | Shotstack | Creatomate |
|------------|--------|----------|-----------|------------|
| Invalid input | 2-5% | 1-3% | 0.5-1% | 0.5-1% |
| Timeout | <1% | 2-3% | 1-2% | 0.5-1% |
| Resource exhaustion | 1-2% | 5-10% | <0.1% | <0.1% |
| Unknown/Internal | <0.1% | <1% | <0.5% | <0.5% |

### Retry Success Rate

| Retry Attempt | FFmpeg | Remotion | Shotstack | Creatomate |
|---------------|--------|----------|-----------|------------|
| 1st retry | 80% | 70% | 95% | 95% |
| 2nd retry | 95% | 90% | 99% | 99% |
| 3rd retry | 99% | 95% | 99.5% | 99.5% |

---

## Recommendations by Use Case

### High Volume, Cost Sensitive
**Recommendation:** FFmpeg on AWS Lambda
- Best $/render at scale
- Requires DevOps investment
- Use SQS for job queue

### Rapid Development, Moderate Volume
**Recommendation:** Shotstack or Creatomate
- Days to integrate vs weeks
- Predictable costs
- No infrastructure management

### Complex Compositions
**Recommendation:** Remotion
- Full creative control
- React-based workflow
- Consider Remotion Lambda for scale

### Enterprise, Compliance Requirements
**Recommendation:** FFmpeg self-hosted
- Data never leaves your infrastructure
- Full audit trail
- Custom codec support

---

## Appendix: Test Methodology

### Benchmark Procedure

1. **Warmup:** 3 discarded runs before measurement
2. **Iterations:** 10 runs per scenario
3. **Measurement:** Wall clock time from job submit to output available
4. **Cloud tests:** Performed at off-peak hours (2-4 AM UTC)
5. **Network:** Same region as cloud services (us-east-1)

### Source Files

- **Video clips:** H.264, 1080p/4K, 30fps, from Pexels (royalty-free)
- **Audio tracks:** AAC, 44.1kHz stereo
- **Transitions:** 0.5s duration for all tests
- **Output:** H.264, AAC, MP4 container

### Tools Used

- FFmpeg 6.1.1
- Remotion 4.0.x
- Shotstack Edit API v1
- Creatomate API v1
- Node.js 20.x for benchmarking
