'use client';

import { Card, CardContent } from '@kit/ui/card';
import { Skeleton } from '@kit/ui/skeleton';

export function AssetCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <Skeleton className="mb-3 aspect-square rounded-lg" />
        <Skeleton className="mb-2 h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
      </CardContent>
    </Card>
  );
}
