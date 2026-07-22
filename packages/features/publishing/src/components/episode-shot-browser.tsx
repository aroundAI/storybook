'use client';

import { useState, useMemo } from 'react';
import { 
  Search, 
  Film, 
  ChevronRight, 
  Check, 
  Clock 
} from 'lucide-react';
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@kit/ui/dialog';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { ScrollArea } from '@kit/ui/scroll-area';
import { Badge } from '@kit/ui/badge';
import { Card } from '@kit/ui/card';

interface EpisodeShotBrowserProps {
  episodes: Array<{
    id: string;
    title: string;
    number: number;
    seasonNumber: number | null;
    shots: Array<{
      id: string;
      sequenceNumber: number;
      shotType: string;
      durationSeconds: number | null;
      thumbnailUrl: string | null;
      renderUrl: string | null;
      visualDescription: string | null;
    }>;
  }>;
  onAddShots: (shots: Array<{
    episodeId: string;
    shotId: string;
    mediaUrl: string | null;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
  }>) => void;
  onClose: () => void;
  isOpen: boolean;
}

export function EpisodeShotBrowser({
  episodes,
  onAddShots,
  onClose,
  isOpen,
}: EpisodeShotBrowserProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(episodes[0]?.id || null);
  const [selectedShots, setSelectedShots] = useState<Set<string>>(new Set());

  const filteredEpisodes = useMemo(() => {
    if (!searchQuery.trim()) return episodes;
    const query = searchQuery.toLowerCase();
    return episodes.filter(ep => 
      ep.title.toLowerCase().includes(query) || 
      `episode ${ep.number}`.includes(query)
    );
  }, [episodes, searchQuery]);

  const selectedEpisode = useMemo(() => 
    episodes.find(ep => ep.id === selectedEpisodeId),
  [episodes, selectedEpisodeId]);

  const handleToggleShot = (shotId: string) => {
    const newSelected = new Set(selectedShots);
    if (newSelected.has(shotId)) {
      newSelected.delete(shotId);
    } else {
      newSelected.add(shotId);
    }
    setSelectedShots(newSelected);
  };

  const handleAddSelected = () => {
    const shotsToAdd: Array<{
      episodeId: string;
      shotId: string;
      mediaUrl: string | null;
      thumbnailUrl: string | null;
      durationSeconds: number | null;
    }> = [];

    episodes.forEach(ep => {
      ep.shots.forEach(shot => {
        if (selectedShots.has(shot.id)) {
          shotsToAdd.push({
            episodeId: ep.id,
            shotId: shot.id,
            mediaUrl: shot.renderUrl,
            thumbnailUrl: shot.thumbnailUrl,
            durationSeconds: shot.durationSeconds,
          });
        }
      });
    });

    onAddShots(shotsToAdd);
    setSelectedShots(new Set());
    onClose();
  };

  const formatDuration = (seconds: number | null) => {
    if (seconds === null) return '--:--';
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl h-[80vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-4 border-b">
          <DialogTitle>Browse Segments</DialogTitle>
        </DialogHeader>
        
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-64 border-r flex flex-col bg-muted/10">
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search episodes..."
                  className="pl-9 bg-background"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {filteredEpisodes.length === 0 ? (
                  <div className="p-4 text-sm text-center text-muted-foreground">
                    No episodes found
                  </div>
                ) : (
                  filteredEpisodes.map(ep => (
                    <button
                      key={ep.id}
                      onClick={() => setSelectedEpisodeId(ep.id)}
                      className={`
                        w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between group
                        ${selectedEpisodeId === ep.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-muted-foreground hover:text-foreground'}
                      `}
                    >
                      <div className="truncate pr-2">
                        <span className="opacity-70 mr-1.5 text-xs">
                          {ep.seasonNumber ? `S${ep.seasonNumber}` : ''}E{ep.number}
                        </span>
                        {ep.title}
                      </div>
                      <ChevronRight className={`h-4 w-4 opacity-0 transition-opacity ${selectedEpisodeId === ep.id ? 'opacity-100' : 'group-hover:opacity-50'}`} />
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col bg-background">
            {selectedEpisode ? (
              <>
                <div className="p-4 border-b flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{selectedEpisode.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {selectedEpisode.shots.length} shots available
                    </p>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      const newSelected = new Set(selectedShots);
                      const allSelected = selectedEpisode.shots.every(s => newSelected.has(s.id));
                      
                      selectedEpisode.shots.forEach(s => {
                        if (allSelected) newSelected.delete(s.id);
                        else newSelected.add(s.id);
                      });
                      
                      setSelectedShots(newSelected);
                    }}
                  >
                    {selectedEpisode.shots.every(s => selectedShots.has(s.id)) ? 'Deselect All' : 'Select All in Episode'}
                  </Button>
                </div>
                
                <ScrollArea className="flex-1 p-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {selectedEpisode.shots.map(shot => {
                      const isSelected = selectedShots.has(shot.id);
                      return (
                        <Card 
                          key={shot.id}
                          className={`
                            overflow-hidden cursor-pointer transition-all border-2
                            ${isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-transparent hover:border-border'}
                          `}
                          onClick={() => handleToggleShot(shot.id)}
                        >
                          <div className="aspect-video bg-muted relative">
                            {shot.thumbnailUrl ? (
                              <img src={shot.thumbnailUrl} alt={`Shot ${shot.sequenceNumber}`} className="h-full w-full object-cover" />
                            ) : (
                              <div className="h-full w-full flex items-center justify-center">
                                <Film className="h-8 w-8 text-muted-foreground/30" />
                              </div>
                            )}
                            <div className="absolute top-2 left-2">
                              <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm shadow-sm">
                                Shot {shot.sequenceNumber}
                              </Badge>
                            </div>
                            <div className="absolute top-2 right-2">
                              <div className={`
                                h-5 w-5 rounded-sm border flex items-center justify-center bg-background/80 backdrop-blur-sm
                                ${isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground'}
                              `}>
                                {isSelected && <Check className="h-3.5 w-3.5" />}
                              </div>
                            </div>
                            <div className="absolute bottom-2 right-2">
                              <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm gap-1 shadow-sm">
                                <Clock className="h-3 w-3" />
                                {formatDuration(shot.durationSeconds)}
                              </Badge>
                            </div>
                          </div>
                          <div className="p-3">
                            <div className="flex items-center justify-between mb-1">
                              <Badge variant="outline" className="text-[10px] capitalize px-1.5 py-0">
                                {shot.shotType}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2" title={shot.visualDescription || ''}>
                              {shot.visualDescription || 'No visual description'}
                            </p>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </ScrollArea>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                Select an episode to browse shots
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="p-4 border-t bg-muted/10 flex items-center justify-between sm:justify-between">
          <div className="text-sm text-muted-foreground">
            {selectedShots.size} {selectedShots.size === 1 ? 'shot' : 'shots'} selected
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleAddSelected} disabled={selectedShots.size === 0}>
              Add Selected
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
