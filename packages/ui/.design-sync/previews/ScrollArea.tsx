import { ChevronRight } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { ScrollArea } from '@kit/ui/scroll-area';

const threads = [
  { name: 'The Lighthouse Keeper', type: 'Mystery', episode: 'Ep 4: Static' },
  { name: "Mara's Betrayal", type: 'Conflict', episode: 'Ep 5: Fault Lines' },
  { name: 'The Missing Ledger', type: 'Plot', episode: 'Ep 3: Audit' },
  { name: 'Coastal Watch Founding', type: 'Thematic', episode: 'Ep 1: Pilot' },
  { name: 'Dorian & Reyes', type: 'Romantic', episode: 'Ep 6: Low Tide' },
];

export function Default() {
  return (
    <ScrollArea className="h-[220px] w-[360px] rounded-md border">
      <div className="space-y-1 p-2">
        {threads.map((thread) => (
          <div
            key={thread.name}
            className="flex items-center justify-between rounded-md px-2 py-2 hover:bg-accent"
          >
            <div>
              <p className="text-sm font-medium">{thread.name}</p>
              <p className="text-muted-foreground text-xs">{thread.episode}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                {thread.type}
              </Badge>
              <ChevronRight className="text-muted-foreground h-3.5 w-3.5" />
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
