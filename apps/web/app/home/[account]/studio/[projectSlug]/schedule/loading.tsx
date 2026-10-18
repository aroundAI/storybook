import { Skeleton } from '@kit/ui/skeleton';

export default function ScheduleLoading() {
  return (
    <div className="space-y-6 p-6" data-test="schedule-page-loading">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-80 w-full rounded-lg" />
    </div>
  );
}
