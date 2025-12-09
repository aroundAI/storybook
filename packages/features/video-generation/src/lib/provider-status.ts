/**
 * Provider status types and mappings for video generation jobs.
 *
 * This module handles the translation between external provider statuses
 * and internal job statuses used in the database.
 */
import type {
  HailuoWebhookPayload,
  KlingWebhookPayload,
} from '../webhooks/types';

/**
 * Internal status type used by generation_jobs table
 */
export type InternalJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'dead_letter';

/**
 * Runway status response (polling-based, no webhook)
 * Status values: PENDING, RUNNING, SUCCEEDED, FAILED, CANCELLED
 */
export interface RunwayStatusResponse {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  progress?: number;
  output?: Array<{
    url: string;
    duration: number;
  }>;
  failure?: string;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Status mapping: Kling provider status to internal status
 */
export const KLING_STATUS_MAP: Record<
  KlingWebhookPayload['task_status'],
  InternalJobStatus
> = {
  submitted: 'queued',
  processing: 'processing',
  succeed: 'completed',
  failed: 'failed',
};

/**
 * Status mapping: Hailuo provider status to internal status
 */
export const HAILUO_STATUS_MAP: Record<
  HailuoWebhookPayload['status'],
  InternalJobStatus
> = {
  Queueing: 'queued',
  Processing: 'processing',
  Success: 'completed',
  Fail: 'failed',
};

/**
 * Status mapping: Runway provider status to internal status
 */
export const RUNWAY_STATUS_MAP: Record<
  RunwayStatusResponse['status'],
  InternalJobStatus
> = {
  PENDING: 'queued',
  RUNNING: 'processing',
  SUCCEEDED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};
