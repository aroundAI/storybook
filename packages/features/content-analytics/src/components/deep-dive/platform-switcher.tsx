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
import { selectsEveryPlatform } from '../../lib/platform-selection';

/** Radix `Select` cannot hold an empty value; "All platforms" needs a token. */
const ALL_PLATFORMS = 'all';

function isPlatform(value: string): value is AnalyticsPlatform {
  return (ANALYTICS_PLATFORMS as readonly string[]).includes(value);
}

/**
 * The Deep Dive's platform (FILM-1707 §2, option 1's switcher): makes the
 * scope's platform explicit and changeable on the tab.
 *
 * Since FILM-1709 it is a shortcut onto the page's filter, not a second
 * selection: it shows that selection and sets it. "All platforms" or one
 * platform; a selection of two, made in the header, is named as such here
 * and stays exactly as chosen — never quietly narrowed to its first.
 */
export function PlatformSwitcher({
  value,
  onChange,
}: {
  /** The page's selection, in its own order; never empty here. */
  value: readonly AnalyticsPlatform[];
  onChange: (platforms: AnalyticsPlatform[]) => void;
}) {
  const current = selectsEveryPlatform(value)
    ? ALL_PLATFORMS
    : value.length === 1
      ? value[0]!
      : // Radix shows the placeholder for an empty value: the header's
        // several platforms, named.
        '';

  return (
    <Select
      value={current}
      onValueChange={(next) =>
        onChange(isPlatform(next) ? [next] : [...ANALYTICS_PLATFORMS])
      }
    >
      <SelectTrigger
        className={'w-56'}
        aria-label={'Platform'}
        data-test={'deep-dive-platform-switcher'}
        data-selection={value.join(',')}
      >
        <SelectValue placeholder={value.map(platformLabel).join(' + ')} />
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
