/**
 * What an LLM job may touch, and the proof that its caller may touch it (KB-31).
 *
 * The LLM worker runs on the service-role key and reads and writes whatever
 * ids a job names, so the only place a job can be authorised is where it is
 * queued, with the caller's session. `queueLlmJob` requires an
 * `LlmJobTarget`, and the only way to get one for tenant data is from the
 * authorisers below, which ask `public.can_write_project` (KB-28) as the
 * caller. Visibility never grants it: a public or unlisted project's rows are
 * readable by any signed-in user, which is exactly what let a stranger queue
 * work on them before.
 *
 * No `server-only` import: the Lambda worker imports this module (for
 * `chainedLlmJobTarget`), and `server-only` throws outside Next.
 */
import { fetchAllByIds } from '@kit/shared/pagination';

declare const authorised: unique symbol;

export interface LlmJobTarget {
  /** The account that owns the target; the job's usage is recorded here. */
  readonly accountId: string;
  readonly projectId?: string;
  readonly episodeId?: string;
  readonly [authorised]: true;
}

type QueryResult = PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}>;

/** The parts of the caller's Supabase client the authorisers use. */
interface FilterBuilder extends QueryResult {
  eq(column: string, value: string): FilterBuilder;
  is(column: string, value: null): FilterBuilder;
  in(column: string, values: string[]): FilterBuilder;
  order(column: string): FilterBuilder;
  range(from: number, to: number): FilterBuilder;
  maybeSingle(): QueryResult;
}

interface AuthzClient {
  from(relation: 'episodes' | 'projects'): {
    select(columns: string): FilterBuilder;
  };
  rpc(
    fn: 'can_write_project',
    args: { target_project_id: string },
  ): QueryResult;
}

/**
 * What callers pass: the caller's own Supabase client
 * (`getSupabaseServerClient()`), never the admin one. Declared this loosely
 * because checking the generated client against `AuthzClient` exceeds the
 * compiler's instantiation depth (TS2589); the methods used are the two above.
 */
export type LlmJobAuthzClient = {
  from(relation: string): unknown;
  rpc(fn: string, args: object): unknown;
};

const EPISODE_COLUMNS = 'id, project_id, project:projects(account_id)';

interface EpisodeRow {
  id: string;
  project_id: string;
  project: { account_id: string | null } | null;
}

function brand(target: Omit<LlmJobTarget, typeof authorised>): LlmJobTarget {
  return target as LlmJobTarget;
}

/**
 * `public.can_write_project` as the caller: owner, admin or member in
 * `project_members`. An RPC failure throws — it is not an answer, and turning
 * it into a refusal would tell a writer their episode does not exist.
 */
async function canWriteProject(
  client: AuthzClient,
  projectId: string,
): Promise<boolean> {
  const { data, error } = await client.rpc('can_write_project', {
    target_project_id: projectId,
  });

  if (error) {
    throw new Error(`Failed to check project write access: ${error.message}`);
  }

  return data === true;
}

function toEpisodeRow(value: unknown): EpisodeRow | null {
  if (!value || typeof value !== 'object') return null;

  const row = value as Partial<EpisodeRow>;

  return typeof row.id === 'string' && typeof row.project_id === 'string'
    ? (row as EpisodeRow)
    : null;
}

/**
 * The episode as a job target, or `null` when the caller cannot write to its
 * project — including when it does not exist, so a refusal does not reveal
 * which. The caller turns `null` into its refusal.
 */
export async function authorizeEpisodeTarget(
  userClient: LlmJobAuthzClient,
  episodeId: string,
): Promise<LlmJobTarget | null> {
  const client = userClient as AuthzClient;

  const { data, error } = await client
    .from('episodes')
    .select(EPISODE_COLUMNS)
    .eq('id', episodeId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read episode: ${error.message}`);
  }

  const row = toEpisodeRow(data);
  const accountId = row?.project?.account_id;

  if (!row || !accountId) return null;

  if (!(await canWriteProject(client, row.project_id))) return null;

  return brand({ accountId, projectId: row.project_id, episodeId: row.id });
}

/**
 * The batch form: every id is either allowed, with its target, or denied.
 * Paged, so a long batch is neither truncated at the row cap nor rejected
 * for its URI length; one RPC per distinct project.
 */
export async function authorizeEpisodeTargets(
  userClient: LlmJobAuthzClient,
  episodeIds: string[],
): Promise<{ allowed: Map<string, LlmJobTarget>; denied: string[] }> {
  const client = userClient as AuthzClient;

  const rows = (
    await fetchAllByIds<unknown>(
      episodeIds,
      (chunk, from, to) =>
        client
          .from('episodes')
          .select(EPISODE_COLUMNS)
          .in('id', chunk)
          .is('deleted_at', null)
          .order('id')
          .range(from, to) as PromiseLike<{
          data: unknown[] | null;
          error: { message: string } | null;
        }>,
      'episodes (llm job targets)',
    )
  )
    .map(toEpisodeRow)
    .filter((row): row is EpisodeRow => row !== null);

  const writable = new Map<string, boolean>();

  for (const projectId of new Set(rows.map((row) => row.project_id))) {
    writable.set(projectId, await canWriteProject(client, projectId));
  }

  const allowed = new Map<string, LlmJobTarget>();

  for (const row of rows) {
    const accountId = row.project?.account_id;

    if (accountId && writable.get(row.project_id)) {
      allowed.set(
        row.id,
        brand({ accountId, projectId: row.project_id, episodeId: row.id }),
      );
    }
  }

  return {
    allowed,
    denied: episodeIds.filter((id) => !allowed.has(id)),
  };
}

/** The project as a job target, or `null` when the caller cannot write to it. */
export async function authorizeProjectTarget(
  userClient: LlmJobAuthzClient,
  projectId: string,
): Promise<LlmJobTarget | null> {
  const client = userClient as AuthzClient;

  const { data, error } = await client
    .from('projects')
    .select('id, account_id')
    .eq('id', projectId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read project: ${error.message}`);
  }

  const row = data as { id?: unknown; account_id?: unknown } | null;

  if (typeof row?.account_id !== 'string') return null;

  if (!(await canWriteProject(client, projectId))) return null;

  return brand({ accountId: row.account_id, projectId });
}

/**
 * For a job that reads no tenant rows — its payload is the caller's own
 * text. Usage is recorded on the caller's personal account, whose id is the
 * user's id.
 */
export function noTenantLlmJobTarget(userId: string): LlmJobTarget {
  return brand({ accountId: userId });
}

/**
 * For a worker re-queueing follow-up work on the target of the job it is
 * processing. That job's producer authorised these ids; nothing else may use
 * this.
 */
export function chainedLlmJobTarget(parent: {
  accountId: string;
  projectId?: string;
  episodeId?: string;
}): LlmJobTarget {
  return brand({
    accountId: parent.accountId,
    projectId: parent.projectId,
    episodeId: parent.episodeId,
  });
}

/** Why a worker will not run a job it was handed. */
export class QueuedJobRefused extends Error {
  override readonly name = 'QueuedJobRefused';
}

interface WorkerFilterBuilder extends QueryResult {
  eq(column: string, value: string): WorkerFilterBuilder;
  maybeSingle(): QueryResult;
}

interface WorkerClient {
  from(relation: 'episodes' | 'projects'): {
    select(columns: string): WorkerFilterBuilder;
  };
  rpc(
    fn: 'can_user_write_project',
    args: { target_user_id: string; target_project_id: string },
  ): QueryResult;
}

/**
 * A worker's own check on a job it is about to run (KB-49), on the
 * service-role key. The producer authorised the job as the caller (KB-31);
 * this asks the same rule again, for the user the job names, when it runs,
 * so a role revoked after queueing, or a target a producer forged, does not
 * run.
 *
 * Throws `QueuedJobRefused` for a job that must not run, and a plain `Error`
 * when the question could not be asked: a failed read is never a "no".
 */
export async function assertQueuedJobAccess(
  adminClient: LlmJobAuthzClient,
  job: {
    userId: string;
    accountId: string;
    projectId?: string;
    episodeId?: string;
  },
): Promise<void> {
  const client = adminClient as WorkerClient;
  let projectId = job.projectId;

  if (job.episodeId) {
    const { data, error } = await client
      .from('episodes')
      .select('project_id, deleted_at')
      .eq('id', job.episodeId)
      .maybeSingle();

    if (error) throw new Error(`Failed to read episode: ${error.message}`);

    const episode = data as {
      project_id?: string;
      deleted_at?: string | null;
    } | null;

    if (!episode?.project_id || episode.deleted_at) {
      throw new QueuedJobRefused('The episode no longer exists');
    }

    if (projectId && episode.project_id !== projectId) {
      throw new QueuedJobRefused("The episode is not in the job's project");
    }

    projectId = episode.project_id;
  }

  if (!projectId) {
    // A job on the caller's own text is billed to their personal account
    if (job.accountId !== job.userId) {
      throw new QueuedJobRefused('The job names no project');
    }

    return;
  }

  const { data: project, error: projectError } = await client
    .from('projects')
    .select('account_id')
    .eq('id', projectId)
    .maybeSingle();

  if (projectError) {
    throw new Error(`Failed to read project: ${projectError.message}`);
  }

  const owner = (project as { account_id?: string } | null)?.account_id;

  if (owner !== job.accountId) {
    throw new QueuedJobRefused("The job's account does not own its project");
  }

  const { data: canWrite, error } = await client.rpc('can_user_write_project', {
    target_user_id: job.userId,
    target_project_id: projectId,
  });

  if (error) {
    throw new Error(`Failed to check project write access: ${error.message}`);
  }

  if (canWrite !== true) {
    throw new QueuedJobRefused(
      'You no longer have write access to this project',
    );
  }
}
