// Defined in @kit/clickhouse so the format-family resolver (FILM-1716) can
// take an AssetDuration without this package and that one each owning a copy.
export {
  ASSET_DURATION_PLATFORMS,
  DURATION_UNKNOWN,
  normalizeAssetDurationSeconds,
  resolveAssetDuration,
} from '@kit/clickhouse';
export type { AssetDuration, AssetDurationPlatform } from '@kit/clickhouse';
