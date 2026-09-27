import { sendJson } from '../../../http';
import { nextDate, pacificDate, pacificMidnight } from '../../pacific';
import type { SocialRoute } from '../../server';
import { drawWeights, splitInteger } from '../../split';
import type { SocialObject, SocialState } from '../../state';
import { ANALYTICS_SCOPES, authorize, googleError } from './errors';

/**
 * YouTube Reporting API v1, the calls the app makes
 * (https://developers.google.com/youtube/reporting/v1/reference/rest):
 * reportTypes.list, jobs.list, jobs.create, jobs.reports.list and
 * media.download.
 *
 * A job produces one report per real day. Reports exist only for days that
 * have ended, and a new job backfills 30 days before its creation, as
 * documented. Each CSV row is split the way the real report splits it
 * (subscribed status, country, traffic source), and the parts add up to the
 * day's figure exactly — the app's parsers sum them back.
 */

const DAY_MS = 86_400_000;

/** Report types served, and their column lists (channel reports reference). */
export const REPORT_TYPES = {
  channel_basic_a3: {
    name: 'User activity',
    dimensions: ['date', 'channel_id', 'video_id', 'live_or_on_demand', 'subscribed_status', 'country_code'],
    metrics: [
      'engaged_views', 'views', 'comments', 'likes', 'dislikes', 'shares',
      'watch_time_minutes', 'average_view_duration_seconds',
      'average_view_duration_percentage', 'subscribers_gained', 'subscribers_lost',
      'red_views', 'red_watch_time_minutes',
    ],
  },
  channel_combined_a3: {
    name: 'Combined',
    dimensions: [
      'date', 'channel_id', 'video_id', 'live_or_on_demand', 'subscribed_status',
      'country_code', 'playback_location_type', 'traffic_source_type', 'device_type',
      'operating_system',
    ],
    metrics: [
      'engaged_views', 'views', 'watch_time_minutes', 'average_view_duration_seconds',
      'average_view_duration_percentage', 'red_views', 'red_watch_time_minutes',
    ],
  },
  channel_traffic_source_a3: {
    name: 'Traffic sources',
    dimensions: [
      'date', 'channel_id', 'video_id', 'live_or_on_demand', 'subscribed_status',
      'country_code', 'traffic_source_type', 'traffic_source_detail',
    ],
    metrics: [
      'engaged_views', 'views', 'watch_time_minutes', 'average_view_duration_seconds',
      'average_view_duration_percentage', 'red_views', 'red_watch_time_minutes',
    ],
  },
  channel_reach_basic_a1: {
    name: 'Reach',
    dimensions: ['date', 'channel_id', 'video_id'],
    metrics: ['video_thumbnail_impressions', 'video_thumbnail_impressions_ctr'],
  },
  channel_reach_combined_a1: {
    name: 'Reach combined',
    dimensions: [
      'date', 'channel_id', 'video_id', 'traffic_source_type', 'traffic_source_detail',
      'operating_system', 'device_type',
    ],
    metrics: ['video_thumbnail_impressions', 'video_thumbnail_impressions_ctr'],
  },
} as const;

type ReportTypeId = keyof typeof REPORT_TYPES;

/** The numeric codes of traffic_source_type (dimensions reference), all of them. */
export const TRAFFIC_SOURCE_CODES = [
  '0', '1', '3', '4', '5', '7', '8', '9', '11', '14', '17', '18', '19', '20',
  '23', '24', '25', '26', '27', '28', '29', '30', '31', '32',
];
const COUNTRIES = ['US', 'GB', 'IN', 'CA', 'AU', 'DE', 'PH', 'NG'];
// Mobile phone, Computer, TV, Tablet (device_type codes).
const DEVICE_CODES = ['104', '101', '102', '105'];
// Android, iOS, Windows, Macintosh (operating_system codes, dimensions reference).
const OS_CODES = ['4', '5', '2', '9'];
const PLAYBACK_CODES = ['0', '1', '2', '5'];

interface Job {
  id: string;
  accountId: string;
  reportTypeId: ReportTypeId;
  name: string;
  createMs: number;
}

const jobsNamespace = (accountId: string) => `yt-report-jobs:${accountId}`;

function jobResource(job: Job) {
  return {
    id: job.id,
    reportTypeId: job.reportTypeId,
    name: job.name,
    createTime: new Date(job.createMs).toISOString(),
  };
}

function isReportType(id: string): id is ReportTypeId {
  return Object.hasOwn(REPORT_TYPES, id);
}

function yyyymmdd(date: string) {
  return date.replaceAll('-', '');
}

/**
 * The Pacific days a job has a report for: 30 days of backfill before the
 * day it was created, up to the last day that has ended.
 */
export function reportDays(social: SocialState, job: Job) {
  const today = pacificDate(social.now());
  const days: string[] = [];
  let date = pacificDate(pacificMidnight(pacificDate(job.createMs)) - 30 * DAY_MS + 12 * 3_600_000);
  for (; date < today; date = nextDate(date)) days.push(date);
  return days;
}

/**
 * A day's report, generated after the documented 48–72 hour processing
 * delay — in simulated time, so it shrinks with SANDBOX_SPEED.
 */
function reportFor(social: SocialState, self: string, job: Job, date: string) {
  const id = `${job.id}${yyyymmdd(date)}`;
  const end = pacificMidnight(nextDate(date));
  const delayHours = 48 + social.rngFor(`yt-report-delay:${id}`).int(0, 24);
  const delayMs = (delayHours * 3_600_000) / Math.max(social.speed, 1e-9);
  return {
    id,
    jobId: job.id,
    startTime: new Date(pacificMidnight(date)).toISOString(),
    endTime: new Date(end).toISOString(),
    createTime: new Date(end + delayMs).toISOString(),
    downloadUrl: `${self}/v1/media/CHANNEL/${job.accountId}/${job.id}/${id}?alt=media`,
  };
}

/** One video's figures for one Pacific day (a day that has ended; no delay applies). */
function dayFigures(social: SocialState, object: SocialObject, date: string) {
  const from = pacificMidnight(date);
  const to = pacificMidnight(nextDate(date));
  const on = (metric: Parameters<SocialState['cumulative']>[1]) =>
    social.cumulative(object, metric, to) - social.cumulative(object, metric, from);
  const views = on('views');
  const watchSeconds =
    social.watchSeconds(object, to) - social.watchSeconds(object, from);
  const likes = on('likes');
  const follows = on('follows');
  const rng = social.rngFor(`yt-report:${object.id}:${date}`);
  return {
    views,
    engaged_views: Math.floor(views * (0.58 + rng.next() * 0.3)),
    comments: on('comments'),
    likes,
    dislikes: Math.floor(likes * 0.035),
    shares: on('shares'),
    watch_seconds: watchSeconds,
    subscribers_gained: follows,
    subscribers_lost: Math.floor(follows * 0.11),
    red_views: Math.floor(views * 0.02),
    impressions: Math.floor(views * (9 + rng.next() * 14)),
  };
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The report's CSV: rows split by the report's dimensions, summing exactly. */
export function reportCsv(social: SocialState, job: Job, day: string) {
  const type = REPORT_TYPES[job.reportTypeId];
  const columns = [...type.dimensions, ...type.metrics];
  const lines = [columns.join(',')];
  const date = yyyymmdd(day);

  const videos = social
    .listObjects('youtube')
    .filter((o) => o.accountId === job.accountId);

  for (const object of videos) {
    const f = dayFigures(social, object, day);
    if (Object.values(f).every((value) => value === 0)) continue;

    const rng = social.rngFor(`yt-report-split:${job.reportTypeId}:${object.id}:${day}`);
    const splits =
      job.reportTypeId.startsWith('channel_reach')
        ? job.reportTypeId === 'channel_reach_basic_a1'
          ? [{}]
          : TRAFFIC_SOURCE_CODES.slice(0, 6).map((code, i) => ({
              traffic_source_type: code,
              traffic_source_detail: '',
              operating_system: OS_CODES[i % OS_CODES.length]!,
              device_type: DEVICE_CODES[i % DEVICE_CODES.length]!,
            }))
        : ['subscribed', 'unsubscribed'].flatMap((status) =>
            COUNTRIES.slice(0, 4).map((country, i) => ({
              live_or_on_demand: 'onDemand',
              subscribed_status: status,
              country_code: country,
              ...(job.reportTypeId === 'channel_basic_a3'
                ? {}
                : {
                    traffic_source_type: rng.pick(TRAFFIC_SOURCE_CODES),
                    traffic_source_detail: '',
                    playback_location_type: PLAYBACK_CODES[i % PLAYBACK_CODES.length]!,
                    device_type: DEVICE_CODES[i % DEVICE_CODES.length]!,
                    operating_system: OS_CODES[i % OS_CODES.length]!,
                  }),
            })),
          );

    const weights = drawWeights(rng, splits.length);
    const part = (total: number) => splitInteger(total, weights);
    const views = part(f.views);
    const watch = part(f.watch_seconds);
    const parts: Record<string, number[]> = {
      views,
      engaged_views: part(f.engaged_views),
      comments: part(f.comments),
      likes: part(f.likes),
      dislikes: part(f.dislikes),
      shares: part(f.shares),
      subscribers_gained: part(f.subscribers_gained),
      subscribers_lost: part(f.subscribers_lost),
      red_views: part(f.red_views),
      video_thumbnail_impressions: part(f.impressions),
    };

    splits.forEach((dims, i) => {
      const v = views[i]!;
      const impressions = parts.video_thumbnail_impressions![i]!;
      const cells: Record<string, string | number> = {
        date,
        channel_id: job.accountId,
        video_id: object.id,
        ...dims,
        ...Object.fromEntries(Object.entries(parts).map(([k, p]) => [k, p[i]!])),
        watch_time_minutes: (watch[i]! / 60).toFixed(3),
        red_watch_time_minutes: ((watch[i]! / 60) * 0.02).toFixed(3),
        average_view_duration_seconds: v > 0 ? (watch[i]! / v).toFixed(3) : '0',
        average_view_duration_percentage:
          v > 0 ? ((watch[i]! / v / object.durationSeconds) * 100).toFixed(3) : '0',
        video_thumbnail_impressions_ctr:
          impressions > 0 ? Math.min(v / impressions, 0.3).toFixed(4) : '0',
      };
      // A row with nothing in it is left out, as the real reports leave it out.
      if (Object.values(parts).every((p) => p[i] === 0) && watch[i] === 0) return;
      lines.push(columns.map((c) => csvCell(cells[c] ?? '')).join(','));
    });
  }
  return `${lines.join('\n')}\n`;
}

const reportTypesList: SocialRoute = ({ url, method, req, res, social }) => {
  if (method !== 'GET' || url.pathname !== '/v1/reportTypes') return false;
  if (!authorize(req, res, social, ANALYTICS_SCOPES)) return true;

  sendJson(res, 200, {
    reportTypes: Object.entries(REPORT_TYPES).map(([id, { name }]) => ({
      id,
      name,
      systemManaged: false,
    })),
  });
  return true;
};

const jobsList: SocialRoute = ({ url, method, req, res, social }) => {
  if (method !== 'GET' || url.pathname !== '/v1/jobs') return false;
  const token = authorize(req, res, social, ANALYTICS_SCOPES);
  if (!token) return true;

  const jobs = social.list<Job>(jobsNamespace(token.accountId));
  sendJson(res, 200, jobs.length ? { jobs: jobs.map(jobResource) } : {});
  return true;
};

const jobsCreate: SocialRoute = ({ url, method, req, res, body, social }) => {
  if (method !== 'POST' || url.pathname !== '/v1/jobs') return false;
  const token = authorize(req, res, social, ANALYTICS_SCOPES);
  if (!token) return true;

  let requested: { reportTypeId?: unknown; name?: unknown } = {};
  try {
    requested = JSON.parse(body.toString('utf8') || '{}');
  } catch {
    requested = {};
  }
  const reportTypeId = String(requested.reportTypeId ?? '');
  if (!isReportType(reportTypeId)) {
    sendJson(res, 400, googleError(400, `Report type ${reportTypeId} does not exist.`, 'badRequest', 'INVALID_ARGUMENT'));
    return true;
  }
  const existing = social
    .list<Job>(jobsNamespace(token.accountId))
    .find((job) => job.reportTypeId === reportTypeId);
  if (existing) {
    sendJson(res, 409, googleError(409, 'Requested entity already exists', 'alreadyExists', 'ALREADY_EXISTS'));
    return true;
  }

  const job = social.add<Job>(jobsNamespace(token.accountId), {
    id: social.recordId('yt-report-job', 36),
    accountId: token.accountId,
    reportTypeId,
    name: String(requested.name ?? reportTypeId),
    createMs: social.now(),
  });
  sendJson(res, 200, jobResource(job));
  return true;
};

const reportsList: SocialRoute = ({ url, method, req, res, social, self }) => {
  const match = /^\/v1\/jobs\/([^/]+)\/reports$/.exec(url.pathname);
  if (method !== 'GET' || !match) return false;
  const token = authorize(req, res, social, ANALYTICS_SCOPES);
  if (!token) return true;

  const job = social
    .list<Job>(jobsNamespace(token.accountId))
    .find((j) => j.id === match[1]);
  if (!job) {
    sendJson(res, 404, googleError(404, 'Requested entity was not found.', 'notFound', 'NOT_FOUND'));
    return true;
  }

  const createdAfter = url.searchParams.get('createdAfter');
  const pageSize = Math.min(Number(url.searchParams.get('pageSize')) || 100, 100);
  const start = Number(url.searchParams.get('pageToken') ?? 0) || 0;

  const all = reportDays(social, job)
    .map((day) => reportFor(social, self, job, day))
    .filter((r) => Date.parse(r.createTime) <= social.now())
    .filter((r) => !createdAfter || Date.parse(r.createTime) > Date.parse(createdAfter))
    .reverse();

  const page = all.slice(start, start + pageSize);
  sendJson(res, 200, {
    ...(page.length ? { reports: page } : {}),
    ...(start + pageSize < all.length ? { nextPageToken: String(start + pageSize) } : {}),
  });
  return true;
};

const mediaDownload: SocialRoute = ({ url, method, req, res, social, about }) => {
  const match = /^\/v1\/media\/CHANNEL\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (method !== 'GET' || !match) return false;
  const token = authorize(req, res, social, ANALYTICS_SCOPES);
  if (!token) return true;

  const [, channelId, jobId, reportId] = match;
  const job = social
    .list<Job>(jobsNamespace(token.accountId))
    .find((j) => j.id === jobId);
  const compact = job && reportId?.startsWith(job.id) ? reportId.slice(job.id.length) : '';
  const day = /^\d{8}$/.test(compact)
    ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}`
    : '';

  if (!job || channelId !== token.accountId || !day || !reportDays(social, job).includes(day)) {
    sendJson(res, 404, googleError(404, 'Requested entity was not found.', 'notFound', 'NOT_FOUND'));
    return true;
  }
  about(reportId!);
  const csv = reportCsv(social, job, day);
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': Buffer.byteLength(csv),
  });
  res.end(csv);
  return true;
};

export const youtubeReportingRoutes = [
  reportTypesList,
  jobsList,
  jobsCreate,
  reportsList,
  mediaDownload,
];
