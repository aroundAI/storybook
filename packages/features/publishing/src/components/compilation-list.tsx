'use client';

import { 
  Star, 
  Rewind, 
  Users, 
  TrendingUp, 
  Flag, 
  Layers, 
  Plus, 
  Trash2, 
  Clock,
  Film
} from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { Badge } from '@kit/ui/badge';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@kit/ui/alert-dialog';

interface CompilationListProps {
  compilations: Array<{
    id: string;
    title: string;
    compilationType: string;
    status: string;
    durationSeconds: number | null;
    thumbnailUrl: string | null;
    segmentCount: number;
    createdAt: string;
  }>;
  onCreateNew: () => void;
  onSelect: (compilationId: string) => void;
  onDelete: (compilationId: string) => Promise<void>;
}

export function CompilationList({
  compilations,
  onCreateNew,
  onSelect,
  onDelete,
}: CompilationListProps) {
  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'best_of': return <Star className="h-4 w-4" />;
      case 'recap': return <Rewind className="h-4 w-4" />;
      case 'character_reel': return <Users className="h-4 w-4" />;
      case 'top_moments': return <TrendingUp className="h-4 w-4" />;
      case 'season_finale': return <Flag className="h-4 w-4" />;
      default: return <Layers className="h-4 w-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-slate-500/10 text-slate-500 hover:bg-slate-500/20';
      case 'assembling': return 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20';
      case 'rendering': return 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20';
      case 'rendered': return 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20';
      case 'published': return 'bg-violet-500/10 text-violet-500 hover:bg-violet-500/20';
      case 'archived': return 'bg-slate-500/10 text-slate-400 hover:bg-slate-500/20';
      default: return 'bg-slate-500/10 text-slate-500';
    }
  };

  const formatDuration = (seconds: number | null) => {
    if (seconds === null) return '--:--';
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">Compilations</h2>
        <Button onClick={onCreateNew}>
          <Plus className="mr-2 h-4 w-4" />
          New Compilation
        </Button>
      </div>

      {compilations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <Layers className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <h3 className="mb-1 text-lg font-medium">No compilations yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Create your first compilation to start assembling videos.
          </p>
          <Button onClick={onCreateNew} variant="outline">
            <Plus className="mr-2 h-4 w-4" />
            Create Compilation
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {compilations.map((compilation) => (
            <Card key={compilation.id} className="overflow-hidden flex flex-col cursor-pointer transition-colors hover:bg-accent/50" onClick={() => onSelect(compilation.id)}>
              <div className="aspect-video w-full overflow-hidden bg-muted relative">
                {compilation.thumbnailUrl ? (
                  <img 
                    src={compilation.thumbnailUrl} 
                    alt={compilation.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900 flex items-center justify-center">
                    <Film className="h-8 w-8 text-muted-foreground/30" />
                  </div>
                )}
                <div className="absolute top-2 right-2 flex gap-2">
                  <Badge className={getStatusColor(compilation.status)} variant="secondary">
                    {compilation.status}
                  </Badge>
                </div>
              </div>
              <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    {getTypeIcon(compilation.compilationType)}
                    <span className="capitalize">{compilation.compilationType.replace('_', ' ')}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatDuration(compilation.durationSeconds)}
                  </div>
                </div>
                <CardTitle className="line-clamp-1 text-base">{compilation.title}</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 flex-1">
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Layers className="h-3.5 w-3.5" />
                  {compilation.segmentCount} segments
                </div>
              </CardContent>
              <CardFooter className="p-4 pt-0 flex justify-end">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={(e) => e.stopPropagation()}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Compilation</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete "{compilation.title}"? This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => onDelete(compilation.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
