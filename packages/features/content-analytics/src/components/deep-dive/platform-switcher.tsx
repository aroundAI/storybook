'use client';

import { ANALYTICS_PLATFORMS, type AnalyticsPlatform } from '@kit/clickhouse';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';

import { platformLabel } from '../../lib/platform-labels';

/** Radix `Select` cannot hold an empty value; "All platforms" needs a token. */
const ALL_PLATFORMS = 'all';

function isPlatform(value: string): value is AnalyticsPlatform {
  return (ANALYTICS_PLATFORMS as readonly string[]).includes(value);
}

/**
 * The Deep Dive's platform (FILM-1707 §2, option 1's switcher): makes
 * `scope.platform` explicit and changeable.
 *
 * All platforms by default — not YouTube, which was option 1's default and
 * is not what was chosen. One platform at a time, because `DimScope.platform`
 * is one value; the header's multi-select reaching this tab is FILM-1709's.
 */
export function PlatformSwitcher({
  value,
  onChange,
}: {
  /** `undefined` is every platform. */
  value: AnalyticsPlatform | undefined;
  onChange: (platform: AnalyticsPlatform | undefined) => void;
}) {
  return (
    <Select
      value={value ?? ALL_PLATFORMS}
      onValueChange={(next) => onChange(isPlatform(next) ? next : undefined)}
    >
      <SelectTrigger
        className={'w-44'}
        aria-label={'Platform'}
        data-test={'deep-dive-platform-switcher'}
      >
        <SelectValue />
      </SelectTrigger>

      <SelectContent>
        <SelectItem
          value={ALL_PLATFORMS}
          data-test={'deep-dive-platform-option-all'}
        >
          All platforms
        </SelectItem>

        {ANALYTICS_PLATFORMS.map((platform) => (
          <SelectItem
            key={platform}
            value={platform}
            data-test={`deep-dive-platform-option-${platform}`}
          >
            {platformLabel(platform)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
