import {
  ANALYTICS_PLATFORMS,
  type AnalyticsPlatform,
  isAnalyticsPlatform,
} from '@kit/clickhouse';
import { isOfferedPlatform } from '@kit/publishing/lib/platforms';

/**
 * The analytics platforms a creator is shown: every `AnalyticsPlatform` but
 * a hidden one (X while `X_ENABLED` is off, owner 2026-10-02).
 *
 * The page's lists, its platform filter and every "N of M platforms" count
 * read this; `ANALYTICS_PLATFORMS` stays the capability matrix's full set,
 * so the kept X code keeps its entries. Pure, so client code can import it.
 */
export const SHOWN_ANALYTICS_PLATFORMS: readonly AnalyticsPlatform[] =
  ANALYTICS_PLATFORMS.filter((platform) => isOfferedPlatform(platform));

export function isShownAnalyticsPlatform(
  value: string,
): value is AnalyticsPlatform {
  return isAnalyticsPlatform(value) && isOfferedPlatform(value);
}
