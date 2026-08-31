import type { ClickHouseClient } from '@clickhouse/client';

/**
 * A ClickHouse migration module. Migrations are applied by run.ts in
 * filename order and recorded in the _migrations table, so `up` must be
 * safe to re-run (use IF EXISTS / IF NOT EXISTS guards).
 */
export interface ClickHouseMigration {
  name: string;
  up: (client: ClickHouseClient) => Promise<void>;
}
