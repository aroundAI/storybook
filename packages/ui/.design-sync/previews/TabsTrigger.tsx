import { Calendar, GitBranch } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';

export function Default() {
  return (
    <Tabs defaultValue="events" className="w-full max-w-sm">
      <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1">
        <TabsTrigger
          value="events"
          className="flex items-center gap-1.5 py-1.5 text-xs"
        >
          <Calendar className="h-3 w-3 shrink-0" />
          Events
          <span className="bg-primary/15 text-primary ml-auto rounded px-1 text-[10px] font-medium">
            12
          </span>
        </TabsTrigger>
        <TabsTrigger
          value="threads"
          className="flex items-center gap-1.5 py-1.5 text-xs"
        >
          <GitBranch className="h-3 w-3 shrink-0" />
          Threads
          <span className="bg-primary/15 text-primary ml-auto rounded px-1 text-[10px] font-medium">
            4
          </span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="events" className="space-y-2 p-1">
        <div className="rounded-md border p-3 text-sm">
          <p className="font-medium">Detective discovers the hidden ledger</p>
          <p className="text-muted-foreground text-xs">Episode 3 · Scene 7</p>
        </div>
        <div className="rounded-md border p-3 text-sm">
          <p className="font-medium">Mara confronts her brother</p>
          <p className="text-muted-foreground text-xs">Episode 4 · Scene 2</p>
        </div>
      </TabsContent>
      <TabsContent value="threads" className="space-y-2 p-1">
        <div className="rounded-md border p-3 text-sm">
          <p className="font-medium">Who set the warehouse fire?</p>
          <p className="text-muted-foreground text-xs">
            Opened in Episode 1 · Unresolved
          </p>
        </div>
      </TabsContent>
    </Tabs>
  );
}

export function Platforms() {
  return (
    <Tabs defaultValue="youtube" className="w-full max-w-md">
      <TabsList>
        <TabsTrigger value="youtube">YouTube</TabsTrigger>
        <TabsTrigger value="tiktok">TikTok</TabsTrigger>
        <TabsTrigger value="instagram">Instagram</TabsTrigger>
      </TabsList>
      <TabsContent value="youtube" className="text-sm">
        Connected as <span className="font-medium">Lumen Pictures</span> — last
        published 2 hours ago.
      </TabsContent>
      <TabsContent value="tiktok" className="text-sm">
        Not connected. Link an account to publish shorts automatically.
      </TabsContent>
      <TabsContent value="instagram" className="text-sm">
        Connected as <span className="font-medium">@lumenpictures</span>.
      </TabsContent>
    </Tabs>
  );
}
