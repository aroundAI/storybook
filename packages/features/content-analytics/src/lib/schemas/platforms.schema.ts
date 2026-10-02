import { z } from 'zod';

import { ANALYTICS_PLATFORMS } from '@kit/clickhouse';

/**
 * The platform filter's selection as an action accepts it (FILM-1709).
 *
 * Every analytics action that narrows by platform takes this, so the rule
 * lives once: each value an `AnalyticsPlatform` — Facebook, offered for
 * export, cannot reach a ClickHouse query through here — and at least one.
 * No platform selected is the page's state to say; it does not ask, and a
 * request that does is refused rather than read as "every platform".
 *
 * Absent (`.optional()` at the call site) is every platform.
 */
export const PlatformSelectionSchema = z
  .array(z.enum(ANALYTICS_PLATFORMS))
  .min(1, 'Select at least one platform');
