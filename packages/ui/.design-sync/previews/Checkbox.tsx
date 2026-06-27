import { useState } from 'react';

import { Badge } from '@kit/ui/badge';
import { Checkbox } from '@kit/ui/checkbox';

export function Default() {
  const [checked, setChecked] = useState(true);

  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id="select-thread"
        checked={checked}
        onCheckedChange={(value) => setChecked(value === true)}
      />
      <label htmlFor="select-thread" className="text-sm font-medium">
        Progress this thread in the next episode
      </label>
    </div>
  );
}

export function ThreadList() {
  return (
    <div className="w-[360px] space-y-2">
      <div className="border-primary/30 bg-primary/5 flex items-start gap-2.5 rounded-lg border p-3">
        <Checkbox checked className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold">
              The Lighthouse Keeper&apos;s Secret
            </span>
            <Badge
              variant="outline"
              className="border-indigo-500/25 bg-indigo-500/15 px-1.5 py-0 text-[10px] text-indigo-400"
            >
              plot
            </Badge>
            <Badge
              variant="outline"
              className="border-emerald-500/25 bg-emerald-500/15 px-1.5 py-0 text-[10px] text-emerald-400"
            >
              open
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            The keeper&apos;s hidden ledger ties Mara to the missing crew.
          </p>
        </div>
      </div>

      <div className="border-border/50 hover:border-border flex items-start gap-2.5 rounded-lg border p-3">
        <Checkbox className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold">
              Mara &amp; Theo&apos;s Rivalry
            </span>
            <Badge
              variant="outline"
              className="border-amber-500/25 bg-amber-500/15 px-1.5 py-0 text-[10px] text-amber-400"
            >
              character
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DisabledStates() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Checkbox disabled />
        <span className="text-muted-foreground text-sm">Locked episode</span>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox disabled checked />
        <span className="text-muted-foreground text-sm">
          Already published
        </span>
      </div>
    </div>
  );
}
