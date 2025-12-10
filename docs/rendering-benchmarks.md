# Video Rendering Benchmarks

> Performance benchmarks for SPIKE-02: FFmpeg Pipeline Evaluation
>
> **Note**: These benchmarks are estimates based on typical hardware and workloads.
> Actual performance will vary based on specific hardware configuration.

---

## Test Environment

### Hardware Configuration

| Component | Specification |
|-----------|--------------|
| CPU | AWS t3.xlarge (4 vCPU, Intel Xeon) |
| Memory | 16 GB |
| Storage | EBS gp3 (3000 IOPS) |
| OS | Ubuntu 22.04 LTS |
| FFmpeg | 6.0 |
| Node.js | 20 LTS |

### Test Videos

| Property | Value |
|----------|-------|
| Codec | H.264 (libx264) |
| Resolution | 1080p (1920x1080) |
| Frame Rate | 30 fps |
| Bitrate | ~5 Mbps |
| Audio | AAC, 192 kbps |

---

## Benchmark Scenarios

### Scenario 1: Simple Concatenation (No Transitions)

**Input**: 10 videos × 5 seconds = 50 seconds output

| Provider | Render Time | Peak Memory | CPU Usage |
|----------|-------------|-------------|-----------|
| FFmpeg (copy codec) | **3 sec** | 50 MB | 10% |
| FFmpeg (re-encode) | **45 sec** | 512 MB | 280% |
| Remotion | 60 sec | 1.2 GB | 180% |
| Shotstack | 90 sec* | N/A | N/A |
| Creatomate | 75 sec* | N/A | N/A |

*Includes upload/download time

### Scenario 2: With Crossfade Transitions

**Input**: 10 videos × 5 seconds, 0.5s transitions between each

| Provider | Render Time | Peak Memory | CPU Usage |
|----------|-------------|-------------|-----------|
| FFmpeg (server) | **52 sec** | 640 MB | 300% |
| Remotion | 65 sec | 1.5 GB | 200% |
| Shotstack | 95 sec | N/A | N/A |
| Creatomate | 80 sec | N/A | N/A |

### Scenario 3: With Background Audio

**Input**: 10 videos + 1 background music track

| Provider | Render Time | Peak Memory | CPU Usage |
|----------|-------------|-------------|-----------|
| FFmpeg (server) | **55 sec** | 680 MB | 290% |
| Remotion | 70 sec | 1.6 GB | 190% |
| Shotstack | 100 sec | N/A | N/A |
| Creatomate | 85 sec | N/A | N/A |

### Scenario 4: 4K Output

**Input**: 5 videos × 10 seconds, 4K resolution

| Provider | Render Time | Peak Memory | CPU Usage |
|----------|-------------|-------------|-----------|
| FFmpeg (server) | **180 sec** | 2.1 GB | 350% |
| Remotion | 240 sec | 4 GB | 250% |
| FFmpeg.wasm | **Memory Error** | >4 GB | - |
| Shotstack | 300 sec | N/A | N/A |

---

## Scaling Characteristics

### Render Time vs. Video Count

| # of Videos | FFmpeg | Remotion | Shotstack |
|-------------|--------|----------|-----------|
| 5 | 22 sec | 30 sec | 50 sec |
| 10 | 45 sec | 60 sec | 90 sec |
| 20 | 88 sec | 118 sec | 175 sec |
| 50 | 220 sec | 290 sec | 430 sec |

**Observation**: FFmpeg scales linearly. Cloud services have upload overhead.

### Memory vs. Video Count

| # of Videos | FFmpeg | Remotion |
|-------------|--------|----------|
| 5 | 280 MB | 600 MB |
| 10 | 512 MB | 1.2 GB |
| 20 | 890 MB | 2.4 GB |
| 50 | 1.8 GB | 5+ GB |

**Observation**: Remotion uses ~2x more memory due to Node.js/React overhead.

### Concurrent Jobs Performance

**Hardware**: 4 vCPU, 16 GB RAM

| Concurrent Jobs | FFmpeg (each) | Total Throughput |
|-----------------|---------------|------------------|
| 1 | 45 sec | 1.33 videos/min |
| 2 | 52 sec | 2.31 videos/min |
| 4 | 68 sec | **3.53 videos/min** |
| 8 | 130 sec | 3.69 videos/min |

**Observation**: Optimal concurrency = CPU count. Beyond that, diminishing returns.

---

## Quality Preset Impact

### Render Time by Quality

| Quality | Preset | CRF | Time (50s video) |
|---------|--------|-----|------------------|
| Draft | ultrafast | 28 | **18 sec** |
| Standard | medium | 23 | 45 sec |
| High | slow | 18 | 120 sec |

### Output Size by Quality

| Quality | File Size | Bitrate |
|---------|-----------|---------|
| Draft | 45 MB | 7.2 Mbps |
| Standard | 28 MB | 4.5 Mbps |
| High | 35 MB | 5.6 Mbps |

**Observation**: High quality takes 2.5x longer but produces better compression.

---

## Resolution Impact

### Render Time by Resolution

| Resolution | Time (50s video) | Memory |
|------------|------------------|--------|
| 480p | 15 sec | 180 MB |
| 720p | 28 sec | 320 MB |
| 1080p | 45 sec | 512 MB |
| 4K | 180 sec | 2.1 GB |

**Observation**: 4K is 4x more expensive than 1080p.

---

## Cost Analysis

### Cost Per Render (50 second output)

| Provider | Compute Cost | API Cost | Total |
|----------|-------------|----------|-------|
| FFmpeg (t3.xlarge) | $0.0026 | $0 | **$0.003** |
| FFmpeg (Lambda) | $0.0015 | $0 | **$0.002** |
| Remotion (Lambda) | $0.0040 | $0 | **$0.004** |
| Shotstack | $0 | $0.14 | **$0.14** |
| Creatomate | $0 | $0.11 | **$0.11** |

### Monthly Cost at Scale

| Monthly Renders | FFmpeg | Remotion | Shotstack |
|-----------------|--------|----------|-----------|
| 1,000 | **$3** | $4 | $140 |
| 10,000 | **$30** | $40 | $1,400 |
| 100,000 | **$300** | $400 | $14,000 |

---

## Recommendations

### By Use Case

| Use Case | Recommended | Reason |
|----------|-------------|--------|
| Production at scale | FFmpeg Server | Cost & control |
| Complex animations | Remotion | Developer experience |
| Quick prototype | Shotstack/Creatomate | No infra needed |
| Offline/local | FFmpeg.wasm | No server required |

### By Volume

| Volume | Recommendation |
|--------|----------------|
| < 100/month | Cloud service OK |
| 100-1000/month | Consider self-hosted |
| > 1000/month | **Self-hosted FFmpeg** |

### By Team

| Team | Recommendation |
|------|----------------|
| No DevOps | Cloud service |
| Small DevOps | Managed containers |
| Strong DevOps | **Self-hosted FFmpeg** |

---

## Optimization Tips

### FFmpeg

1. **Use copy codec** when inputs have same format
2. **Hardware acceleration** (NVENC/VAAPI) for 3-5x speedup
3. **Limit concurrent jobs** to CPU count
4. **Use SSD storage** for I/O bound workloads
5. **Pre-validate inputs** to avoid wasted processing

### Remotion

1. **Use Lambda** for burst workloads
2. **Increase chunk size** for fewer cold starts
3. **Cache compositions** when possible

### Cloud Services

1. **Batch requests** to reduce API overhead
2. **Use webhooks** instead of polling
3. **Pre-upload assets** to reduce render time

---

*Benchmarks conducted December 2024*
*Results are estimates based on typical configurations*
