import { ChevronDown } from 'lucide-react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@kit/ui/collapsible';

export function Default() {
  return (
    <Collapsible defaultOpen className="w-[420px] rounded-lg border">
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-white/5">
          <span className="text-sm font-medium">🔥 Reel Intelligence</span>
          <ChevronDown className="h-4 w-4 text-gray-400" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 border-t px-4 py-3 text-xs">
          <div className="rounded-md bg-green-500/10 p-2">
            <p className="mb-0.5 font-semibold text-green-400">
              ✓ Why this works
            </p>
            <p className="text-green-200/90 leading-relaxed">
              The wide reveal of the lighthouse beam syncs perfectly with the
              music drop at 0:08 — strong hook for a 15s reel.
            </p>
          </div>
          <div className="rounded-md bg-amber-500/10 p-2">
            <p className="mb-0.5 font-semibold text-amber-400">
              ⚡ Key moment
            </p>
            <p className="text-amber-200/90 leading-relaxed">
              Mara&apos;s close-up reaction at 0:11.
            </p>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function SettingsSection() {
  return (
    <Collapsible defaultOpen className="w-[420px] rounded-lg border">
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/5">
          <span className="text-sm font-medium">Advanced generation settings</span>
          <ChevronDown className="h-4 w-4 text-gray-400" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="text-muted-foreground space-y-2 border-t px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <span>Default scene count</span>
            <span className="text-foreground font-medium">7</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Dialogue density</span>
            <span className="text-foreground font-medium">Balanced</span>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
