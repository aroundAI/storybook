'use client';

import Link from 'next/link';

import { ArrowRight, FileText, MapPin, Plus, User } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

const iconMap = {
  user: User,
  mapPin: MapPin,
  fileText: FileText,
} as const;

type IconName = keyof typeof iconMap;

interface ActionCardProps {
  title: string;
  description: string;
  iconName: IconName;
  href?: string;
  count?: number;
  stats?: Array<{ label: string; value: number }>;
  primaryAction?: {
    label: string;
    href: string;
  };
  secondaryAction?: {
    label: string;
    href: string;
  };
  colorScheme?: 'warm' | 'cool' | 'accent' | 'primary';
  isEmpty?: boolean;
}

const colorSchemes = {
  warm: {
    gradient: 'from-orange-500/10 via-background to-background',
    icon: 'text-orange-600 dark:text-orange-400',
    iconBg: 'bg-orange-500/10 border-orange-500/20',
    badge: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
  },
  cool: {
    gradient: 'from-blue-500/10 via-background to-background',
    icon: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-500/10 border-blue-500/20',
    badge: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  },
  accent: {
    gradient: 'from-violet-500/10 via-background to-background',
    icon: 'text-violet-600 dark:text-violet-400',
    iconBg: 'bg-violet-500/10 border-violet-500/20',
    badge: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  },
  primary: {
    gradient: 'from-primary/10 via-background to-background',
    icon: 'text-primary',
    iconBg: 'bg-primary/10 border-primary/20',
    badge: 'bg-primary/10 text-primary',
  },
};

export function ActionCard({
  title,
  description,
  iconName,
  href,
  stats,
  primaryAction,
  secondaryAction,
  colorScheme = 'primary',
  isEmpty = false,
}: ActionCardProps) {
  const colors = colorSchemes[colorScheme];
  const Icon = iconMap[iconName];

  // Only make card clickable if there are no internal actions
  const hasInternalActions = !!(primaryAction || secondaryAction);
  const makeCardClickable = href && !hasInternalActions;

  const content = (
    <Card
      className={cn(
        'group relative overflow-hidden transition-all duration-300',
        makeCardClickable &&
          'cursor-pointer hover:-translate-y-1 hover:shadow-xl',
        !makeCardClickable && 'hover:shadow-lg',
      )}
    >
      {/* Gradient background */}
      <div
        className={cn(
          'absolute inset-0 bg-gradient-to-br opacity-50 transition-opacity group-hover:opacity-70',
          colors.gradient,
        )}
      />

      <CardHeader className="relative space-y-4 pb-4">
        {/* Icon */}
        <div
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-xl border transition-transform group-hover:scale-110',
            colors.iconBg,
          )}
        >
          <Icon className={cn('h-7 w-7', colors.icon)} />
        </div>

        {/* Title & Description */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-2xl">{title}</CardTitle>
            {makeCardClickable && (
              <ArrowRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
            )}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </CardHeader>

      <CardContent className="relative space-y-4">
        {/* Stats or Empty State */}
        {isEmpty ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Get started by creating your first {title.toLowerCase()}.
            </p>
            {primaryAction && (
              <Link href={primaryAction.href} className="block">
                <Button className="w-full gap-2" size="lg">
                  <Plus className="h-4 w-4" />
                  {primaryAction.label}
                </Button>
              </Link>
            )}
            {secondaryAction && (
              <Link href={secondaryAction.href} className="block">
                <Button variant="outline" className="w-full">
                  {secondaryAction.label}
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {stats && stats.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {stats.map((stat) => (
                  <Badge
                    key={stat.label}
                    variant="secondary"
                    className={colors.badge}
                  >
                    {stat.value} {stat.label}
                  </Badge>
                ))}
              </div>
            )}
            {(primaryAction || secondaryAction) && (
              <div className="flex gap-2">
                {primaryAction && (
                  <Link href={primaryAction.href} className="flex-1">
                    <Button className="w-full gap-2">
                      <Plus className="h-4 w-4" />
                      {primaryAction.label}
                    </Button>
                  </Link>
                )}
                {secondaryAction && (
                  <Link href={secondaryAction.href} className="flex-1">
                    <Button variant="outline" className="w-full">
                      {secondaryAction.label}
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );

  // Only wrap in Link if the card itself is clickable (no internal actions)
  if (makeCardClickable) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}
