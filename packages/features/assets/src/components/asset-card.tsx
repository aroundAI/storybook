'use client';

import { useState } from 'react';

import { Edit, MapPin, Mic, MoreVertical, Trash2, User } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@kit/ui/alert-dialog';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent } from '@kit/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { cn } from '@kit/ui/utils';

import type { Asset, AssetType } from '../lib/types';

const ASSET_ICONS: Record<
  AssetType,
  React.ComponentType<{ className?: string }>
> = {
  character: User,
  location: MapPin,
  voice: Mic,
  prop: User,
  music: Mic,
  sfx: Mic,
};

const COLOR_SCHEMES: Record<
  AssetType,
  {
    border: string;
    bg: string;
    text: string;
    icon: string;
    badge: string;
    lightBg: string; // For initials background
  }
> = {
  character: {
    border: 'border-orange-500/50',
    bg: 'hover:shadow-orange-500/10',
    text: 'text-orange-700 dark:text-orange-300',
    icon: 'text-orange-500',
    badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 hover:bg-orange-200',
    lightBg: 'bg-orange-50 dark:bg-orange-950/30',
  },
  location: {
    border: 'border-cyan-500/50',
    bg: 'hover:shadow-cyan-500/10',
    text: 'text-cyan-700 dark:text-cyan-300',
    icon: 'text-cyan-500',
    badge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300 hover:bg-cyan-200',
    lightBg: 'bg-cyan-50 dark:bg-cyan-950/30',
  },
  voice: {
    border: 'border-violet-500/50',
    bg: 'hover:shadow-violet-500/10',
    text: 'text-violet-700 dark:text-violet-300',
    icon: 'text-violet-500',
    badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 hover:bg-violet-200',
    lightBg: 'bg-violet-50 dark:bg-violet-950/30',
  },
  prop: {
    border: 'border-slate-500/50',
    bg: 'hover:shadow-slate-500/10',
    text: 'text-slate-700 dark:text-slate-300',
    icon: 'text-slate-500',
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300 hover:bg-slate-200',
    lightBg: 'bg-slate-50 dark:bg-slate-950/30',
  },
  music: {
    border: 'border-pink-500/50',
    bg: 'hover:shadow-pink-500/10',
    text: 'text-pink-700 dark:text-pink-300',
    icon: 'text-pink-500',
    badge: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300 hover:bg-pink-200',
    lightBg: 'bg-pink-50 dark:bg-pink-950/30',
  },
  sfx: {
    border: 'border-emerald-500/50',
    bg: 'hover:shadow-emerald-500/10',
    text: 'text-emerald-700 dark:text-emerald-300',
    icon: 'text-emerald-500',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 hover:bg-emerald-200',
    lightBg: 'bg-emerald-50 dark:bg-emerald-950/30',
  },
};

interface AssetCardProps {
  asset: Asset;
  onEdit?: (asset: Asset) => void;
  onDelete?: (asset: Asset) => void;
}

export function AssetCard({ asset, onEdit, onDelete }: AssetCardProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const Icon = ASSET_ICONS[asset.type] || User;
  const colors = COLOR_SCHEMES[asset.type] || COLOR_SCHEMES.prop;

  const handleDelete = () => {
    onDelete?.(asset);
    setDeleteDialogOpen(false);
  };

  // Get metadata role or function
  const role = (asset.metadata as { role?: string; function?: string })?.role
    || (asset.metadata as { role?: string; function?: string })?.function;

  // Determine layout based on type
  const isLandscape = asset.type === 'location';

  return (
    <>
      <Card
        className={cn(
          "group relative overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl",
          isLandscape ? "border-b-4" : "border-t-4",
          colors.border,
          colors.bg
        )}
      >
        <CardContent className="p-0">
          <div className={cn("flex", isLandscape ? "flex-col md:flex-row" : "flex-col")}>

            {/* Visual Header / Thumbnail */}
            <div
              className={cn(
                "relative overflow-hidden",
                colors.lightBg,
                isLandscape ? "h-32 md:h-auto md:w-1/3" : "h-32 w-full",
                asset.thumbnailUrl ? "" : "flex items-center justify-center p-6"
              )}
            >
              {asset.thumbnailUrl ? (
                <img
                  src={asset.thumbnailUrl}
                  alt={asset.name}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className={cn("rounded-xl p-3 bg-white dark:bg-black/10 shadow-sm ring-1 ring-inset ring-black/5")}>
                    <Icon className={cn("h-8 w-8", colors.icon)} />
                  </div>
                  {/* Initials for Characters */}
                  {!isLandscape && (
                    <span className={cn("text-4xl font-black opacity-20 select-none", colors.text)}>
                      {asset.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
              )}

              {/* Actions Menu (Absolute) */}
              <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 z-10">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="icon" className="h-8 w-8 shadow-sm">
                      <MoreVertical className="h-4 w-4" />
                      <span className="sr-only">Open menu</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit?.(asset)}>
                      <Edit className="mr-2 h-4 w-4" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDeleteDialogOpen(true)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Content Body */}
            <div className={cn("flex flex-1 flex-col p-4", isLandscape && "justify-center")}>
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <h3 className="line-clamp-1 text-lg font-semibold leading-tight">
                    {asset.name}
                  </h3>
                  {role && (
                    <Badge variant="secondary" className={cn("text-[10px] uppercase tracking-wider font-bold border-0", colors.badge)}>
                      {role}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Description */}
              {asset.description && (
                <p className="text-muted-foreground mt-3 line-clamp-2 text-xs leading-relaxed">
                  {asset.description}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Asset</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{asset.name}&quot;? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
