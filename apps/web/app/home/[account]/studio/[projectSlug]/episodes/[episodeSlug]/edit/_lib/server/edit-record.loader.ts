import 'server-only';

import { cache } from 'react';

import { type EditStyle, deriveEditStyle } from '@kit/content-analytics/lib/edit-style';
import {
  type ExplainWhyReport,
  ExplainWhyReportSchema,
  type QaResult,
  QaResultSchema,
} from '@kit/desktop-integration';
import { getOpenEditSession } from '@kit/desktop-integration/server';
import { fetchAllRows } from '@kit/shared/pagination';
import { getStorageAdapter } from '@kit/storage';
import { PROJECT_ASSETS_BUCKET } from '@kit/storage/upload-paths';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { editingInStudioOf } from '../../../_components/editing-in-studio-badge';

/** How long a render's download link works: long enough to click it. */
export const RENDER_DOWNLOAD_TTL_SECONDS = 15 * 60;

export interface EditRecordRender {
  id: string;
  preset: string;
  language: string;
  aspect: string;
  status: string;
  durationSeconds: number | null;
  fileSizeBytes: number | null;
  /** Null when the QA result stored with it cannot be read. */
  qa: QaResult | null;
  failureReason: string | null;
  primary: boolean;
  /** In the delivered session the page reports on. */
  delivered: boolean;
  createdAt: string;
  /** A signed GET, for a render that has a file; null otherwise. */
  downloadUrl: string | null;
}

export interface EditRecord {
  episode: {
    id: string;
    title: string;
    status: string;
    targetDurationSeconds: number | null;
  };
  /** The caller may force-close an open session (project owner or admin). */
  canForceClose: boolean;
  delivered: {
    sessionId: string;
    deliveredAt: string;
    /** Null when the stored report does not validate. */
    report: ExplainWhyReport | null;
    style: EditStyle | null;
  } | null;
  open: {
    sessionId: string;
    startedAt: string;
    editorName: string | null;
    device: string | null;
  } | null;
  renders: EditRecordRender[];
}

function summaryField(summary: unknown, key: string): unknown {
  return summary && typeof summary === 'object'
    ? (summary as Record<string, unknown>)[key]
    : undefined;
}

function deliveredRenderIds(summary: unknown): Set<string> {
  const renders = summaryField(summary, 'renders');

  return new Set(
    Array.isArray(renders)
      ? renders
          .map((render) =>
            render && typeof render === 'object'
              ? (render as { renderId?: unknown }).renderId
              : null,
          )
          .filter((id): id is string => typeof id === 'string')
      : [],
  );
}

/**
 * Everything the Edit record page shows (FILM-2006), read as the signed-in
 * user: RLS decides what they see, and every storage key signed below was
 * read out of an episode_renders row RLS let through, inside this
 * episode's render folder (the table's own CHECK pins it there).
 * Null when the episode is not theirs to see.
 */
export const loadEditRecord = cache(
  async (input: {
    projectSlug: string;
    episodeSlug: string;
  }): Promise<EditRecord | null> => {
    const client = getSupabaseServerClient();

    const { data: project, error: projectError } = await client
      .from('projects')
      .select('id')
      .eq('slug', input.projectSlug)
      .maybeSingle();

    if (projectError) {
      throw new Error(`Reading the project failed: ${projectError.message}`);
    }

    if (!project) return null;

    const { data: episode, error: episodeError } = await client
      .from('episodes')
      .select('id, title, status, edit_state, target_duration_seconds')
      .eq('project_id', project.id)
      .eq('slug', input.episodeSlug)
      .is('deleted_at', null)
      .maybeSingle();

    if (episodeError) {
      throw new Error(`Reading the episode failed: ${episodeError.message}`);
    }

    if (!episode) return null;

    const {
      data: { user },
    } = await client.auth.getUser();

    const [role, deliveredRows, openSession, renderRows] = await Promise.all([
      user
        ? client
            .from('project_members')
            .select('role')
            .eq('project_id', project.id)
            .eq('user_id', user.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      client
        .from('edit_sessions')
        .select('id, delivered_at, summary')
        .eq('episode_id', episode.id)
        .eq('status', 'delivered')
        .order('delivered_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1),
      getOpenEditSession(client, episode.id),
      // Every render of the episode: the table for the page's renders,
      // paged because an episode re-delivered many times keeps its
      // superseded renders.
      fetchAllRows<{
        id: string;
        preset: string;
        language: string;
        aspect: string;
        status: string;
        duration_seconds: number | null;
        file_size_bytes: number | null;
        file_path: string;
        qa: unknown;
        failure_reason: string | null;
        edit_session_id: string | null;
        created_at: string;
      }>(
        (from, to) =>
          client
            .from('episode_renders')
            .select(
              'id, preset, language, aspect, status, duration_seconds, file_size_bytes, file_path, qa, failure_reason, edit_session_id, created_at',
            )
            .eq('episode_id', episode.id)
            .order('created_at', { ascending: false })
            .order('id', { ascending: true })
            .range(from, to),
        'episode_renders',
      ),
    ]);

    if (role.error) {
      throw new Error(`Reading the project role failed: ${role.error.message}`);
    }

    if (deliveredRows.error) {
      throw new Error(
        `Reading the delivered session failed: ${deliveredRows.error.message}`,
      );
    }

    const lastDelivery = deliveredRows.data?.[0] ?? null;
    const report = lastDelivery
      ? ExplainWhyReportSchema.safeParse(
          summaryField(lastDelivery.summary, 'report'),
        )
      : null;
    const primaryRenderId = lastDelivery
      ? summaryField(lastDelivery.summary, 'primaryRenderId')
      : null;
    const inDelivery = lastDelivery
      ? deliveredRenderIds(lastDelivery.summary)
      : new Set<string>();

    const storage = getStorageAdapter(client);
    const renders = await Promise.all(
      renderRows.map(async (row): Promise<EditRecordRender> => {
        const hasFile = row.status === 'ready' || row.status === 'superseded';
        const qa = QaResultSchema.safeParse(row.qa);

        return {
          id: row.id,
          preset: row.preset,
          language: row.language,
          aspect: row.aspect,
          status: row.status,
          durationSeconds:
            row.duration_seconds === null ? null : Number(row.duration_seconds),
          fileSizeBytes:
            row.file_size_bytes === null ? null : Number(row.file_size_bytes),
          qa: qa.success ? qa.data : null,
          failureReason: row.failure_reason,
          primary: row.id === primaryRenderId,
          delivered: inDelivery.has(row.id),
          createdAt: row.created_at,
          downloadUrl: hasFile
            ? await storage.getSignedReadUrl(
                PROJECT_ASSETS_BUCKET,
                row.file_path,
                RENDER_DOWNLOAD_TTL_SECONDS,
              )
            : null,
        };
      }),
    );

    const editing = editingInStudioOf(episode);
    const device = openSession
      ? await client.rpc('edit_session_device', {
          p_session_id: openSession.id,
        })
      : null;

    if (device?.error) {
      throw new Error(`Reading the session's device failed: ${device.error.message}`);
    }

    return {
      episode: {
        id: episode.id,
        title: episode.title,
        status: episode.status,
        targetDurationSeconds: episode.target_duration_seconds,
      },
      canForceClose:
        role.data?.role === 'owner' || role.data?.role === 'admin',
      delivered:
        lastDelivery?.delivered_at
          ? {
              sessionId: lastDelivery.id,
              deliveredAt: lastDelivery.delivered_at,
              report: report?.success ? report.data : null,
              style: deriveEditStyle({
                summary: lastDelivery.summary,
                episodeTargetDurationSeconds: episode.target_duration_seconds,
              }),
            }
          : null,
      open: openSession
        ? {
            sessionId: openSession.id,
            startedAt: openSession.started_at,
            // edit_state names the editor of the session it points at
            editorName: editing?.since ? editing.editorName : null,
            device: device?.data ?? null,
          }
        : null,
      renders,
    };
  },
);
