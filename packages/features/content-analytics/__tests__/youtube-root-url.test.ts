import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

/**
 * FILM-1801. The real `googleapis`, not a mock, against a local listener: the
 * question is where the SDK sends a request once `rootUrl` comes from
 * `vendorUrl`, which a mock can only answer the way this file already expects.
 *
 * `googleapis` and `@googleapis/youtube` bundle separate copies of
 * `googleapis-common`, so the publishing package has its own version of this
 * test; passing one proves nothing about the other.
 */

const requests: string[] = [];
let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url?.split('?')[0]}`);
    request.resume();
    request.on('end', () => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ jobs: [], rows: [], items: [] }));
    });
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));

  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
});

afterEach(() => {
  requests.length = 0;
  vi.unstubAllEnvs();
  vi.resetModules();
});

function sandbox(overrides: Record<string, string>) {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('VENDOR_SANDBOX', '1');

  for (const [name, value] of Object.entries(overrides)) {
    vi.stubEnv(name, value);
  }

  // A request that escapes to the real host is sent here as a CONNECT, which
  // this server refuses - so a regression fails offline instead of calling
  // Google with a test token.
  vi.stubEnv('HTTPS_PROXY', origin);
  vi.stubEnv('NO_PROXY', '127.0.0.1');
  vi.resetModules();
}

describe('the YouTube analytics clients send requests to the resolved hosts', () => {
  it('Reporting API: job list and report download', async () => {
    sandbox({ VENDOR_URL_YOUTUBE_REPORTING: origin });

    const { YouTubeReportingProvider } = await import(
      '../src/providers/youtube/youtube-reporting'
    );
    const provider = new YouTubeReportingProvider('access-token');

    await provider.listJobs();
    await provider.downloadReport(
      'https://youtubereporting.googleapis.com/v1/media/CHANNEL/abc/jobs/1/reports/2?alt=media',
    );

    expect(requests).toEqual([
      'GET /v1/jobs',
      'GET /v1/media/CHANNEL/abc/jobs/1/reports/2',
    ]);
  });

  it('Analytics API and Data API, each on its own override', async () => {
    sandbox({
      VENDOR_URL_YOUTUBE_ANALYTICS: origin,
      VENDOR_URL_YOUTUBE_DATA: origin,
    });

    const { YouTubeAnalyticsProvider } = await import(
      '../src/providers/youtube/youtube-analytics'
    );
    const provider = new YouTubeAnalyticsProvider('access-token');

    await provider
      .getVideoAnalytics({
        videoId: 'video-1',
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-01-07T00:00:00Z'),
      })
      .catch(() => undefined);
    await provider.getVideoInfo('video-1').catch(() => undefined);

    expect(new Set(requests)).toEqual(
      new Set(['GET /v2/reports', 'GET /youtube/v3/videos']),
    );
  });
});
