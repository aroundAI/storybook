'use client';

import { Monitor, Smartphone, Tablet } from 'lucide-react';

import { AudienceCard } from './audience-card';

interface DeviceTypeCardProps {
  /** Device type percentages */
  deviceTypes: {
    mobile: number;
    desktop: number;
    tablet: number;
  };
}

const DEVICE_CONFIG = [
  {
    key: 'mobile' as const,
    label: 'Mobile',
    icon: Smartphone,
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    iconColor: 'text-blue-500 dark:text-blue-400',
    barColor: 'bg-blue-500',
  },
  {
    key: 'desktop' as const,
    label: 'Desktop',
    icon: Monitor,
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    iconColor: 'text-purple-500 dark:text-purple-400',
    barColor: 'bg-purple-500',
  },
  {
    key: 'tablet' as const,
    label: 'Tablet',
    icon: Tablet,
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
    iconColor: 'text-orange-500 dark:text-orange-400',
    barColor: 'bg-orange-500',
  },
];

export function DeviceTypeCard({ deviceTypes }: DeviceTypeCardProps) {
  return (
    <AudienceCard
      title="Device Type"
      icon={Smartphone}
      footerInsight="Optimize for vertical video formats as mobile usage continues to surge."
    >
      <div className="flex flex-1 flex-col justify-center space-y-4">
        {DEVICE_CONFIG.map((device) => {
          const percentage = deviceTypes[device.key] || 0;
          const Icon = device.icon;

          return (
            <div key={device.key} className="flex items-center gap-4">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${device.bgColor}`}
              >
                <Icon className={`h-5 w-5 ${device.iconColor}`} />
              </div>
              <div className="flex-1">
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium text-gray-900 dark:text-white">
                    {device.label}
                  </span>
                  <span className="font-bold text-gray-900 dark:text-white">
                    {percentage}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-700">
                  <div
                    className={`h-2 rounded-full ${device.barColor}`}
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
