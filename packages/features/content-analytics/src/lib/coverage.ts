import type { CoverageMatrix } from '@kit/clickhouse';

import type { ChannelRef } from '../server/channels';

/**
 * What `getCoverageMatrixAction` answers (FILM-1704), shared by the action
 * and the `CoverageProvider` that distributes it. Types only, so the client
 * bundle carries nothing from the server modules it names.
 */
export interface CoverageMatrixResult {
  /** The calendar days the observed half describes, inclusive. */
  window: { from: string; to: string };
  /** Every family × platform. See `foldObservedCoverage`. */
  matrix: CoverageMatrix;
  /**
   * The connections "connected" was read from, in scope — active or not, so
   * the strip can name a disconnected channel that still owns history.
   */
  channels: ChannelRef[];
  /**
   * Whether ClickHouse was read. `false` means every observed cell is `null`
   * — cannot measure — which is production's state while
   * `CLICKHOUSE_ENABLED` is off.
   */
  observed: boolean;
}
