'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { cn } from '@kit/ui/utils';

interface PreviewCardProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export function PreviewCard({
  title = 'Preview',
  description = 'Interactive component preview',
  children,
  className,
  contentClassName,
}: PreviewCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className={cn('bg-muted/30 rounded-lg border p-6', contentClassName)}
        >
          {children}
        </div>
      </CardContent>
    </Card>
  );
}
