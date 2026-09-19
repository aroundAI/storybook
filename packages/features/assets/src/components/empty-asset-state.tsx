'use client';

import { MapPin, Mic, Plus, User } from 'lucide-react';

import { Button } from '@kit/ui/button';

type AssetType = 'character' | 'location' | 'voice';

interface EmptyAssetStateProps {
  assetType: AssetType;
  onCreate: () => void;
}

const EMPTY_STATE_CONFIG: Record<
  AssetType,
  {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    description: string;
    cta: string;
  }
> = {
  character: {
    icon: User,
    title: 'No characters yet',
    description: 'Create your first character to bring your story to life.',
    cta: 'Create Character',
  },
  location: {
    icon: MapPin,
    title: 'No locations yet',
    description: 'Add locations where your story takes place.',
    cta: 'Create Location',
  },
  voice: {
    icon: Mic,
    title: 'No voice profiles yet',
    description: 'Add voice profiles for your characters.',
    cta: 'Create Voice Profile',
  },
};

export function EmptyAssetState({ assetType, onCreate }: EmptyAssetStateProps) {
  const config = EMPTY_STATE_CONFIG[assetType];
  const Icon = config.icon;

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 rounded-full bg-muted p-6">
        <Icon className="h-12 w-12 text-muted-foreground" />
      </div>
      <h3 className="mb-2 text-lg font-semibold">{config.title}</h3>
      <p className="mb-6 max-w-sm text-muted-foreground">
        {config.description}
      </p>
      <Button onClick={onCreate}>
        <Plus className="mr-2 h-4 w-4" />
        {config.cta}
      </Button>
    </div>
  );
}
