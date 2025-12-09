'use client';

import { MapPin, Mic, User } from 'lucide-react';

import { Tabs, TabsList, TabsTrigger } from '@kit/ui/tabs';

type TabType = 'character' | 'location' | 'voice';

interface AssetTabsProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  counts?: {
    character?: number;
    location?: number;
    voice?: number;
  };
}

export function AssetTabs({ activeTab, onTabChange, counts }: AssetTabsProps) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => onTabChange(value as TabType)}
    >
      <TabsList>
        <TabsTrigger value="character" className="gap-2">
          <User className="h-4 w-4" />
          Characters
          {counts?.character !== undefined && (
            <span className="bg-muted ml-1 rounded-full px-2 py-0.5 text-xs">
              {counts.character}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="location" className="gap-2">
          <MapPin className="h-4 w-4" />
          Locations
          {counts?.location !== undefined && (
            <span className="bg-muted ml-1 rounded-full px-2 py-0.5 text-xs">
              {counts.location}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="voice" className="gap-2">
          <Mic className="h-4 w-4" />
          Voices
          {counts?.voice !== undefined && (
            <span className="bg-muted ml-1 rounded-full px-2 py-0.5 text-xs">
              {counts.voice}
            </span>
          )}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
