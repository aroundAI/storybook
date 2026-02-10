export * from './actions';
export * from './continuity-actions';
export * from './story-actions';
export * from './screenplay-actions';
export * from './batch-episode-actions';

// Shot CRUD actions (FILM-303)
export * from '../lib/server/mutations/shot-actions';
export * from '../lib/server/queries/shot-queries';

// Shot list generation (FILM-307)
export * from '../lib/server/mutations/shot-list-actions';

// Season CRUD actions (FILM-302)
export * from '../lib/server/mutations/season-actions';
export * from './captions-actions';
// Auto-stitch action (FILM-604)
export * from './auto-stitch-action';

// NOTE: Auto-stitch library is server-only, import directly:
// import { autoStitch } from '@kit/episodes/lib/auto-stitch';

// Season Generation (FILM-201)
export * from '../lib/server/mutations/season-generation-actions';

// Timeline Planning
export * from './timeline-actions';

// Project Intro actions
export * from './intro-actions';

// Episode Thumbnail actions
export * from './thumbnail-actions';

// Publish actions
export * from '../lib/server/mutations/publish-actions';

// Generation job tracking
export * from '../lib/server/mutations/generation-job-actions';

// Canon Management System (Phase 10)
export * from './canon-actions';

// External Context Provider (Phase 11: FILM-1135)
export * from './external-context-actions';

// NOTE: Server-only canon functions (buildMemoryContext, runRolePipeline) must be imported directly:
// import { buildMemoryContext } from '@kit/episodes/lib/canon/memory-context-builder';
// import { runRolePipeline } from '@kit/episodes/lib/canon/llm-role-orchestrator';
// NOTE: Context aggregator must be imported directly:
// import { getContextAggregator } from '@kit/episodes/lib/server/services/context-aggregator';
