import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STUDIO_DELIVERY_ALERTS,
  raiseStudioDeliveryAlerts,
} from '../studio-delivery-alerts';

/**
 * FILM-2006: the hourly cron alerts on the two delivery failures the Studio
 * panel counts: renders the sweep just failed after a day uploading, and
 * TARGET_CHANGED refusals in the last hour. Each alert is a warn line
 * tagged with its name and a monitoring capture, as FILM-1911's guard
 * raises its alarm; nothing is raised when both are zero.
 */
const warn = vi.hoisted(() => vi.fn());
const error = vi.hoisted(() => vi.fn());
const captureException = vi.hoisted(() => vi.fn());

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ info: vi.fn(), warn, error }),
}));

vi.mock('@kit/monitoring/server', () => ({
  getServerMonitoringService: async () => ({
    ready: async () => undefined,
    captureException,
  }),
}));

const NOW = new Date('2026-10-04T12:00:00Z');

function admin(result: { count: number | null; error: unknown }) {
  const filters: Array<[string, string, unknown]> = [];
  const builder = {
    select: (_columns: string, options: unknown) => {
      filters.push(['select', 'options', options]);
      return builder;
    },
    eq: (column: string, value: unknown) => {
      filters.push(['eq', column, value]);
      return builder;
    },
    gte: (column: string, value: unknown) => {
      filters.push(['gte', column, value]);
      return Promise.resolve(result);
    },
  };

  return {
    client: { from: (table: string) => (filters.push(['from', table, null]), builder) },
    filters,
  };
}

beforeEach(() => {
  warn.mockReset();
  error.mockReset();
  captureException.mockReset();
});

describe('raiseStudioDeliveryAlerts', () => {
  it('raises nothing when no render expired and nothing was refused', async () => {
    const { client, filters } = admin({ count: 0, error: null });

    const result = await raiseStudioDeliveryAlerts(client as never, {
      failedRenders: 0,
      now: NOW,
    });

    expect(result).toEqual({ targetChanged: 0, alerts: [] });
    expect(filters).toEqual([
      ['from', 'mcp_tool_calls', null],
      ['select', 'options', { count: 'exact', head: true }],
      ['eq', 'error_code', 'TARGET_CHANGED'],
      ['gte', 'created_at', '2026-10-04T11:00:00.000Z'],
    ]);
    expect(warn).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('alerts on renders the sweep failed and on refusals in the last hour', async () => {
    const { client } = admin({ count: 3, error: null });

    const result = await raiseStudioDeliveryAlerts(client as never, {
      failedRenders: 2,
      now: NOW,
    });

    expect(result).toEqual({
      targetChanged: 3,
      alerts: [
        STUDIO_DELIVERY_ALERTS.staleRenderUploads,
        STUDIO_DELIVERY_ALERTS.targetChanged,
      ],
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        alert: 'studio.alert.stale_render_uploads',
        failedRenders: 2,
      }),
      expect.stringContaining('2 Studio renders'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        alert: 'studio.alert.target_changed',
        refusals: 3,
      }),
      expect.stringContaining('3 TARGET_CHANGED'),
    );
    expect(captureException).toHaveBeenCalledTimes(2);
  });

  it('a count that cannot be read is reported, not taken as zero', async () => {
    const { client } = admin({ count: null, error: { message: 'boom' } });

    const result = await raiseStudioDeliveryAlerts(client as never, {
      failedRenders: 0,
      now: NOW,
    });

    expect(result).toEqual({ targetChanged: null, alerts: [] });
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ alert: 'studio.alert.target_changed' }),
      expect.stringContaining('could not be counted'),
    );
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
