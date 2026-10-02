import { recordViewsDenominator } from '@kit/clickhouse';
import type { RecordedRate } from '@kit/clickhouse';

/** A fixture's window: wholly after YouTube's 2026-08-27 change. */
export const TEST_WINDOW = { from: '2026-09-01', to: '2026-09-30' };

/** A rate as the reads return it since FILM-1732: the figure and its record. */
export function recorded(
  value: number,
  platforms: readonly string[] = ['youtube'],
): RecordedRate {
  return {
    value,
    denominator: recordViewsDenominator({ platforms, window: TEST_WINDOW }),
  };
}
