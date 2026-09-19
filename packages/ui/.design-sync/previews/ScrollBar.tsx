import { ScrollArea, ScrollBar } from '@kit/ui/scroll-area';

const shots = Array.from({ length: 12 }, (_, index) => ({
  id: `shot-${index + 1}`,
  label: `Shot ${index + 1}`,
}));

export function Default() {
  return (
    <ScrollArea className="w-[360px] rounded-md border whitespace-nowrap">
      <div className="flex gap-2 p-3">
        {shots.map((shot) => (
          <div
            key={shot.id}
            className="flex h-16 w-24 flex-shrink-0 items-center justify-center rounded-md bg-muted text-sm font-medium"
          >
            {shot.label}
          </div>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
