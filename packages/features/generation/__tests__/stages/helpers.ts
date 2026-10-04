/**
 * Shared fixtures for the stage tests: the world from
 * `src/testing/stage-world.ts` (snapshot, fake database, ids), and the
 * contexts and runs the stages are run with.
 */
import type { Responder } from '../../src/testing';
import { recordCommits, recordingClient } from '../../src/testing';
import { IDS, SNAPSHOT, responder } from '../../src/testing/stage-world';
import type {
  Ctx,
  EpisodeContextSnapshot,
  GenerationRun,
} from '../../src/types';

export {
  CHARACTER_ASSETS,
  IDS,
  SNAPSHOT,
  TABLES,
  responder,
} from '../../src/testing/stage-world';

export function makeCtx(
  respond: Responder = responder(),
  snapshot: EpisodeContextSnapshot = SNAPSHOT,
) {
  const db = recordingClient(respond);
  const loads: Array<{ episodeId: string; semanticQuery?: string }> = [];

  const ctx: Ctx = {
    client: db.client,
    commits: recordCommits(db.client).apply,
    accountId: IDS.accountId,
    userId: IDS.userId,
    episodeContext: async (episodeId, options) => {
      loads.push({ episodeId, semanticQuery: options.semanticQuery });
      return snapshot;
    },
  };

  return { ctx, db, loads };
}

export function serverRun(): GenerationRun {
  return {
    mode: 'server',
    origin: { kind: 'server', at: new Date().toISOString() },
  };
}

export function externalRun(): GenerationRun {
  return {
    mode: 'external',
    origin: {
      kind: 'external',
      model: 'claude',
      clientName: 'Claude Desktop',
      at: new Date().toISOString(),
    },
  };
}

export const UNRESOLVED_PLACEHOLDER = /\{\{\s*\w+\s*\}\}/;
