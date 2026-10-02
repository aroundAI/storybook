import 'server-only';

import type { McpToolDefinition } from '../../../registry';
import { getAccountOverview } from './account-overview';
import { getAiUsage } from './ai-usage';
import {
  getChannelExperiment,
  listChannelExperiments,
} from './channel-experiments';
import { getDataCoverage, listChannels } from './coverage';
import { getDeepDive } from './deep-dive';
import { getEpisodeAnalytics } from './episode';
import { getExperiment, listExperiments } from './experiments';
import { getVideoFunnel } from './funnel';
import { getGenomeFindings } from './genome';
import { getLanguageAnalytics } from './language';
import { getProjectAnalytics } from './project-analytics';
import { getReachOverview } from './reach';
import { getReportDownload, listReports } from './reports';
import { getRetentionCurve } from './retention';
import { getRevenue } from './revenue';
import { getSavedInsights } from './saved-insights';
import { getAnalyticsSettings } from './settings';
import { getTagPerformance } from './tags';
import { getVideoLog } from './video-log';
import {
  abandonExperiment,
  assignPublishTags,
  concludeExperiment,
  createExperiment,
  startExperiment,
  updatePublishNote,
} from './writes';

/**
 * FILM-1906: every analytics view the web shows, as a read tool with the
 * same checks and caveats, and the six analytics writes. One list, spread
 * into `defaultTools`; FILM-1905 and FILM-1908 add theirs the same way.
 */
export const analyticsReadTools = [
  getAccountOverview,
  getProjectAnalytics,
  getDeepDive,
  getRetentionCurve,
  getVideoLog,
  getLanguageAnalytics,
  getEpisodeAnalytics,
  getVideoFunnel,
  getRevenue,
  getReachOverview,
  listExperiments,
  getExperiment,
  listChannelExperiments,
  getChannelExperiment,
  getTagPerformance,
  getGenomeFindings,
  getDataCoverage,
  listChannels,
  listReports,
  getReportDownload,
  getAnalyticsSettings,
  getSavedInsights,
  getAiUsage,
].map((tool) => tool as unknown as McpToolDefinition);

export const analyticsWriteTools = [
  updatePublishNote,
  assignPublishTags,
  createExperiment,
  startExperiment,
  concludeExperiment,
  abandonExperiment,
].map((tool) => tool as unknown as McpToolDefinition);

export const analyticsTools: McpToolDefinition[] = [
  ...analyticsReadTools,
  ...analyticsWriteTools,
];
