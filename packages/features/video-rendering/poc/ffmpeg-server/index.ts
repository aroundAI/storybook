/**
 * FFmpeg Server POC
 *
 * Express server demonstrating server-side video rendering with FFmpeg.
 * This is a proof-of-concept for evaluating FFmpeg integration.
 *
 * Features:
 * - Video concatenation endpoint
 * - Progress tracking via SSE
 * - Concurrent job management
 * - Temporary file cleanup
 *
 * Usage:
 *   npx ts-node index.ts
 *   # or
 *   npm start
 *
 * Endpoints:
 *   POST /render     - Start a render job
 *   GET /progress/:id - Get progress via SSE
 *   GET /status/:id   - Get job status
 *   DELETE /render/:id - Cancel a job
 *   GET /health       - Health check
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';

// Types
interface RenderJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  startTime: number;
  outputPath?: string;
  error?: string;
  command?: ffmpeg.FfmpegCommand;
}

interface RenderRequestBody {
  shots: Array<{
    url: string;
    duration: number;
  }>;
  transitions?: Array<{
    type: 'cut' | 'crossfade' | 'fade';
    duration: number;
  }>;
  quality?: 'draft' | 'standard' | 'high';
  format?: 'mp4' | 'webm';
}

// Configuration
const PORT = process.env.PORT || 3001;
const TEMP_DIR = process.env.TEMP_DIR || '/tmp/video-rendering';
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || '4', 10);

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Job storage
const jobs = new Map<string, RenderJob>();
const progressListeners = new Map<string, Set<Response>>();

// Initialize Express
const app = express();
app.use(cors());
app.use(express.json());

/**
 * Health check endpoint
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeJobs: Array.from(jobs.values()).filter((j) => j.status === 'processing')
      .length,
    maxConcurrentJobs: MAX_CONCURRENT_JOBS,
  });
});

/**
 * Start a render job
 */
app.post('/render', async (req: Request, res: Response) => {
  const body = req.body as RenderRequestBody;

  // Validate request
  if (!body.shots || !Array.isArray(body.shots) || body.shots.length === 0) {
    res.status(400).json({ error: 'shots array is required' });
    return;
  }

  // Check concurrent job limit
  const activeJobs = Array.from(jobs.values()).filter(
    (j) => j.status === 'processing'
  ).length;
  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    res.status(429).json({
      error: 'Too many concurrent jobs',
      activeJobs,
      maxConcurrentJobs: MAX_CONCURRENT_JOBS,
    });
    return;
  }

  // Create job
  const jobId = uuidv4();
  const outputPath = path.join(TEMP_DIR, `${jobId}.${body.format || 'mp4'}`);

  const job: RenderJob = {
    id: jobId,
    status: 'pending',
    progress: 0,
    startTime: Date.now(),
    outputPath,
  };

  jobs.set(jobId, job);

  // Start render asynchronously
  startRender(job, body).catch((err) => {
    console.error(`Render failed for job ${jobId}:`, err);
  });

  res.status(202).json({
    jobId,
    status: 'pending',
    message: 'Render job started',
  });
});

/**
 * Get job status
 */
app.get('/status/:id', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);

  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    duration: Date.now() - job.startTime,
    outputPath: job.status === 'completed' ? job.outputPath : undefined,
    error: job.error,
  });
});

/**
 * Progress streaming via SSE
 */
app.get('/progress/:id', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);

  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Add to listeners
  if (!progressListeners.has(job.id)) {
    progressListeners.set(job.id, new Set());
  }
  progressListeners.get(job.id)!.add(res);

  // Send initial state
  res.write(`data: ${JSON.stringify({ status: job.status, progress: job.progress })}\n\n`);

  // Cleanup on close
  req.on('close', () => {
    progressListeners.get(job.id)?.delete(res);
  });
});

/**
 * Cancel a render job
 */
app.delete('/render/:id', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);

  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  if (job.status !== 'processing' && job.status !== 'pending') {
    res.status(400).json({ error: 'Job cannot be cancelled', status: job.status });
    return;
  }

  // Kill FFmpeg process
  if (job.command) {
    job.command.kill('SIGTERM');
  }

  job.status = 'cancelled';
  notifyProgress(job);

  // Cleanup output file
  if (job.outputPath && fs.existsSync(job.outputPath)) {
    fs.unlinkSync(job.outputPath);
  }

  res.json({ message: 'Job cancelled', id: job.id });
});

/**
 * Download rendered video
 */
app.get('/download/:id', (req: Request, res: Response) => {
  const job = jobs.get(req.params.id);

  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  if (job.status !== 'completed' || !job.outputPath) {
    res.status(400).json({ error: 'Job not completed', status: job.status });
    return;
  }

  if (!fs.existsSync(job.outputPath)) {
    res.status(404).json({ error: 'Output file not found' });
    return;
  }

  res.download(job.outputPath);
});

/**
 * Start the render process
 */
async function startRender(job: RenderJob, request: RenderRequestBody): Promise<void> {
  job.status = 'processing';
  notifyProgress(job);

  return new Promise((resolve, reject) => {
    const command = ffmpeg();

    // Add inputs
    for (const shot of request.shots) {
      command.input(shot.url);
    }

    // Build filter complex
    const filterInputs = request.shots.map((_, i) => `[${i}:v][${i}:a]`).join('');
    const filterComplex = `${filterInputs}concat=n=${request.shots.length}:v=1:a=1[outv][outa]`;

    command.complexFilter(filterComplex);
    command.outputOptions(['-map [outv]', '-map [outa]']);

    // Quality settings
    const qualitySettings = {
      draft: { preset: 'ultrafast', crf: '28' },
      standard: { preset: 'medium', crf: '23' },
      high: { preset: 'slow', crf: '18' },
    };
    const quality = qualitySettings[request.quality || 'standard'];

    command.outputOptions([
      '-c:v libx264',
      `-preset ${quality.preset}`,
      `-crf ${quality.crf}`,
      '-c:a aac',
      '-b:a 192k',
      '-movflags +faststart',
    ]);

    command.output(job.outputPath!);

    // Store command for cancellation
    job.command = command;

    // Event handlers
    command.on('start', (cmdLine) => {
      console.log(`[Job ${job.id}] Started: ${cmdLine}`);
    });

    command.on('progress', (progress) => {
      job.progress = progress.percent || 0;
      notifyProgress(job);
    });

    command.on('end', () => {
      job.status = 'completed';
      job.progress = 100;
      notifyProgress(job);
      console.log(`[Job ${job.id}] Completed in ${Date.now() - job.startTime}ms`);
      resolve();
    });

    command.on('error', (err) => {
      job.status = 'failed';
      job.error = err.message;
      notifyProgress(job);
      console.error(`[Job ${job.id}] Failed:`, err);
      reject(err);
    });

    // Start rendering
    command.run();
  });
}

/**
 * Notify progress listeners
 */
function notifyProgress(job: RenderJob): void {
  const listeners = progressListeners.get(job.id);
  if (!listeners) return;

  const data = JSON.stringify({
    status: job.status,
    progress: job.progress,
    error: job.error,
  });

  for (const res of listeners) {
    res.write(`data: ${data}\n\n`);

    // Close connection if job is done
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      res.end();
      listeners.delete(res);
    }
  }
}

/**
 * Cleanup old jobs periodically
 */
setInterval(() => {
  const maxAge = 60 * 60 * 1000; // 1 hour
  const now = Date.now();

  for (const [id, job] of jobs) {
    if (now - job.startTime > maxAge && job.status !== 'processing') {
      // Delete output file
      if (job.outputPath && fs.existsSync(job.outputPath)) {
        fs.unlinkSync(job.outputPath);
      }
      jobs.delete(id);
      console.log(`[Cleanup] Removed old job ${id}`);
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

// Start server
app.listen(PORT, () => {
  console.log(`FFmpeg POC Server running on port ${PORT}`);
  console.log(`Temp directory: ${TEMP_DIR}`);
  console.log(`Max concurrent jobs: ${MAX_CONCURRENT_JOBS}`);
});

export { app };
