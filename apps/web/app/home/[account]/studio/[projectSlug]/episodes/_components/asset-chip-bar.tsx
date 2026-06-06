'use client';

import { useMemo } from 'react';

import { MapPin, User } from 'lucide-react';

import { cn } from '@kit/ui/utils';

interface AssetChipBarProps {
  characterNames: string[];
  locationNames: string[];
  characterIds: string[];
  locationIds: string[];
  validAssetIds: string[];
  maxVisible?: number;
}

export function AssetChipBar({
  characterNames,
  locationNames,
  characterIds,
  locationIds,
  validAssetIds,
  maxVisible = 5,
}: AssetChipBarProps) {
  const validSet = useMemo(() => new Set(validAssetIds), [validAssetIds]);

  const chips: Array<{
    name: string;
    id: string | null;
    type: 'character' | 'location';
    isLinked: boolean;
  }> = [];

  characterNames.forEach((name, i) => {
    const id = characterIds[i] ?? null;
    chips.push({
      name,
      id,
      type: 'character',
      isLinked: id ? validSet.has(id) : false,
    });
  });

  locationNames.forEach((name, i) => {
    const id = locationIds[i] ?? null;
    chips.push({
      name,
      id,
      type: 'location',
      isLinked: id ? validSet.has(id) : false,
    });
  });

  if (chips.length === 0) return null;

  const visible = chips.slice(0, maxVisible);
  const overflow = chips.length - maxVisible;

  return (
    <div className="mt-1.5 mb-2 flex flex-wrap items-center gap-1.5">
      {visible.map((chip, i) => {
        const Icon = chip.type === 'character' ? User : MapPin;
        const colorClasses =
          chip.type === 'character' ? 'text-orange-400/80' : 'text-cyan-400/80';

        return (
          <span
            key={`${chip.type}-${chip.name}-${i}`}
            className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-400"
          >
            {chip.isLinked && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                title="Linked to library"
              />
            )}
            <Icon className={cn('h-2.5 w-2.5', colorClasses)} />
            <span className="max-w-[80px] truncate">{chip.name}</span>
          </span>
        );
      })}

      {overflow > 0 && (
        <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[10px] text-slate-500">
          +{overflow} more
        </span>
      )}
    </div>
  );
}
