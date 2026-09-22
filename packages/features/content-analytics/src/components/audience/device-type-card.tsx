'use client';

import {
  Gamepad2,
  HelpCircle,
  Monitor,
  Smartphone,
  Tablet,
  Tv,
} from 'lucide-react';

import type { DeviceBreakdownData } from '../../providers/youtube/types';
import type { DeviceTypeBreakdown } from '../../server/aggregation-queries';
import { AudienceCard, AudienceCardEmpty } from './audience-card';

interface DeviceTypeCardProps {
  /**
   * Shares read from `video_audience` `dimension = 'device'`. Absent when
   * there are no such rows — which is not the same as 0% on every device.
   */
  deviceType?: DeviceTypeBreakdown;
}

interface DeviceStyle {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  bgColor: string;
  iconColor: string;
  barColor: string;
}

/**
 * Keyed by YouTube's own `deviceType` values, which is what
 * `buildAudienceRows` stores. A `Record` over the provider's union, so a
 * value added there does not compile until it has a label here.
 */
const DEVICE_STYLES: Record<DeviceBreakdownData['deviceType'], DeviceStyle> = {
  MOBILE: {
    label: 'Mobile',
    icon: Smartphone,
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    iconColor: 'text-blue-500 dark:text-blue-400',
    barColor: 'bg-blue-500',
  },
  DESKTOP: {
    label: 'Desktop',
    icon: Monitor,
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    iconColor: 'text-purple-500 dark:text-purple-400',
    barColor: 'bg-purple-500',
  },
  TABLET: {
    label: 'Tablet',
    icon: Tablet,
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
    iconColor: 'text-orange-500 dark:text-orange-400',
    barColor: 'bg-orange-500',
  },
  TV: {
    label: 'TV',
    icon: Tv,
    bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
    iconColor: 'text-emerald-500 dark:text-emerald-400',
    barColor: 'bg-emerald-500',
  },
  GAME_CONSOLE: {
    label: 'Game console',
    icon: Gamepad2,
    bgColor: 'bg-pink-50 dark:bg-pink-900/20',
    iconColor: 'text-pink-500 dark:text-pink-400',
    barColor: 'bg-pink-500',
  },
  UNKNOWN_PLATFORM: {
    label: 'Unknown',
    icon: HelpCircle,
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    iconColor: 'text-gray-500 dark:text-gray-400',
    barColor: 'bg-gray-400',
  },
};

function styleFor(device: string): DeviceStyle {
  return device in DEVICE_STYLES
    ? DEVICE_STYLES[device as DeviceBreakdownData['deviceType']]
    : { ...DEVICE_STYLES.UNKNOWN_PLATFORM, label: device };
}

export function DeviceTypeCard({ deviceType }: DeviceTypeCardProps) {
  if (!deviceType) {
    return (
      <AudienceCard
        title="Device Type"
        icon={Smartphone}
        data-test="audience-card-device"
      >
        <AudienceCardEmpty heading="No device data" data-test="device-empty">
          None of this project&apos;s videos has a device breakdown yet.
        </AudienceCardEmpty>
      </AudienceCard>
    );
  }

  return (
    <AudienceCard
      title="Device Type"
      icon={Smartphone}
      data-test="audience-card-device"
      footerInsight={
        <span data-test="device-total-views">
          Share of {deviceType.totalViews.toLocaleString('en-US')} views that
          reported a device.
        </span>
      }
    >
      <div className="flex flex-1 flex-col justify-center space-y-4">
        {deviceType.devices.map(({ device, percentage }) => {
          const style = styleFor(device);
          const Icon = style.icon;

          return (
            <div
              key={device}
              className="flex items-center gap-4"
              data-test={`device-row-${device}`}
            >
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${style.bgColor}`}
              >
                <Icon className={`h-5 w-5 ${style.iconColor}`} />
              </div>
              <div className="flex-1">
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium text-gray-900 dark:text-white">
                    {style.label}
                  </span>
                  <span
                    className="font-bold text-gray-900 dark:text-white"
                    data-test="device-share"
                  >
                    {percentage.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-700">
                  <div
                    className={`h-2 rounded-full ${style.barColor}`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </AudienceCard>
  );
}
