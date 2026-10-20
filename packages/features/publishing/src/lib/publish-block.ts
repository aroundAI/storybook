/**
 * KB-213. A connection Meta has stopped from posting.
 *
 * On 20 Oct 2026 Meta refused a Facebook post with OAuthException code 368,
 * subcode 4854002: "Confirm your identity before you can publish as this
 * Page". Code 368 is Meta's block on an account it judges to be posting
 * abusively, and every later post to that Page would have met it, each
 * one adding to the reason for the block.
 *
 * A Facebook or Instagram publish that fails with code 368 (any subcode)
 * pauses its connection: `platform_connections.metadata.publishBlock`
 * holds Meta's words and when. While it is set the scheduled job and the
 * publish worker leave that connection's due posts `scheduled`, untouched,
 * and every other connection carries on. Retry on Settings → Platforms, a
 * manual token refresh, or reconnecting (the callback writes a fresh
 * metadata) clears it, and the posts go at the job's next run.
 *
 * Pure apart from its reads and writes, so the worker lambdas and the web
 * actions share it (no `server-only`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@kit/supabase/database';

type Client = SupabaseClient<Database>;

export const META_BLOCK_CODE = 368;

export interface PublishBlock {
  platform: string;
  code: number;
  subcode: number | null;
  message: string;
  at: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The block stored on a connection's metadata, or null */
export function publishBlockOf(metadata: unknown): PublishBlock | null {
  const block = record(record(metadata).publishBlock);

  if (typeof block.at !== 'string' || typeof block.code !== 'number') {
    return null;
  }

  return {
    platform: typeof block.platform === 'string' ? block.platform : '',
    code: block.code,
    subcode: typeof block.subcode === 'number' ? block.subcode : null,
    message: typeof block.message === 'string' ? block.message : '',
    at: block.at,
  };
}

const IDENTITY_WORDS = /confirm your identity before you can publish/i;

/**
 * Meta's code 368 in a failed upload's error, as the providers throw it:
 * the Graph error body as text (`"code":368`), or only its message.
 */
export function metaBlockOf(
  error: unknown,
): { code: number; subcode: number | null; message: string } | null {
  const text = error instanceof Error ? error.message : String(error ?? '');

  const coded = /"code"\s*:\s*368\b/.test(text) || /\(#368\)/.test(text);
  if (!coded && !IDENTITY_WORDS.test(text)) return null;

  const subcode = /"error_subcode"\s*:\s*(\d+)/.exec(text)?.[1];
  const message = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text)?.[1];

  return {
    code: META_BLOCK_CODE,
    subcode: subcode ? Number(subcode) : null,
    message: message ? message.replace(/\\(.)/g, '$1') : text,
  };
}

const NAMES: Record<string, { platform: string; account: string }> = {
  facebook: { platform: 'Facebook', account: 'this Page' },
  instagram: { platform: 'Instagram', account: 'this account' },
};

function namesOf(platform: string) {
  return NAMES[platform] ?? { platform: 'Meta', account: 'this account' };
}

/** What Settings → Platforms says on a paused connection */
export function publishBlockBanner(platform: string): string {
  const { platform: name, account } = namesOf(platform);

  return `${name} asked you to confirm your identity for ${account}. Open the ${name} app, follow its instructions, then press Retry. Posts to ${account} wait until then.`;
}

/** The failed row's message, on the Schedule tab and in the worker's log */
export function publishBlockFailure(platform: string): string {
  const { platform: name, account } = namesOf(platform);

  return `Not posted: ${name} asked you to confirm your identity for ${account}. Open the ${name} app and follow its instructions, then press Retry on Settings → Platforms. Later posts to ${account} wait until then.`;
}

async function readMetadata(client: Client, connectionId: string) {
  const { data, error } = await client
    .from('platform_connections')
    .select('metadata')
    .eq('id', connectionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read the connection: ${error.message}`);
  }

  return data ? record(data.metadata) : null;
}

/** Pauses one connection. Never touches another. */
export async function recordPublishBlock(
  client: Client,
  connectionId: string,
  block: Omit<PublishBlock, 'at'> & { at?: string },
): Promise<void> {
  const metadata = await readMetadata(client, connectionId);
  if (!metadata) return;

  const { error } = await client
    .from('platform_connections')
    .update({
      metadata: {
        ...metadata,
        publishBlock: { ...block, at: block.at ?? new Date().toISOString() },
      } as Json,
    })
    .eq('id', connectionId);

  if (error) {
    throw new Error(`Could not pause the connection: ${error.message}`);
  }
}

/** Clears a connection's block. True when there was one to clear. */
export async function clearPublishBlock(
  client: Client,
  connectionId: string,
): Promise<boolean> {
  const metadata = await readMetadata(client, connectionId);
  if (!metadata || !('publishBlock' in metadata)) return false;

  const { publishBlock: _cleared, ...rest } = metadata;
  const { data, error } = await client
    .from('platform_connections')
    .update({ metadata: rest as Json })
    .eq('id', connectionId)
    .select('id');

  if (error) {
    throw new Error(`Could not clear the connection's block: ${error.message}`);
  }

  return (data?.length ?? 0) > 0;
}

/** Which of these connections are paused */
export async function pausedConnectionIds(
  client: Client,
  connectionIds: string[],
): Promise<Set<string>> {
  const ids = [...new Set(connectionIds.filter(Boolean))];
  if (ids.length === 0) return new Set();

  const { data, error } = await client
    .from('platform_connections')
    .select('id, metadata')
    .in('id', ids);

  if (error) {
    throw new Error(`Could not read the connections: ${error.message}`);
  }

  return new Set(
    (data ?? [])
      .filter((row) => publishBlockOf(row.metadata) !== null)
      .map((row) => row.id),
  );
}
