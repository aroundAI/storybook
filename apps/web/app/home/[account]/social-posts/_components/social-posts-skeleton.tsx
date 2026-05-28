import { Skeleton } from '@kit/ui/skeleton';

export function SocialPostsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-[300px] w-full rounded-xl" />
      <div className="space-y-3">
        <Skeleton className="h-[100px] w-full rounded-xl" />
        <Skeleton className="h-[100px] w-full rounded-xl" />
        <Skeleton className="h-[100px] w-full rounded-xl" />
      </div>
    </div>
  );
}
