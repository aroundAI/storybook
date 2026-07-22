'use client';

import { useState } from 'react';
import { 
  GripVertical, 
  Trash2, 
  Bookmark, 
  Film, 
  Clock, 
  Plus, 
  Play, 
  ArrowRightLeft,
  Settings2
} from 'lucide-react';
import { Button } from '@kit/ui/button';
import { Badge } from '@kit/ui/badge';
import { Input } from '@kit/ui/input';
import { Card, CardContent } from '@kit/ui/card';
import { ScrollArea } from '@kit/ui/scroll-area';
import { Separator } from '@kit/ui/separator';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Checkbox } from '@kit/ui/checkbox';
import { ChapterPreview } from './chapter-preview';

interface CompilationEditorProps {
  compilation: {
    id: string;
    title: string;
    description: string | null;
    compilationType: string;
    status: string;
    chapters: Array<{ title: string; startSeconds: number }>;
  };
  segments: Array<{
    id: string;
    title: string | null;
    sequenceNumber: number;
    sourceEpisodeTitle: string;
    sourceShotSequence: number | null;
    startSeconds: number;
    endSeconds: number | null;
    durationSeconds: number | null;
    mediaUrl: string | null;
    thumbnailUrl: string | null;
    transitionType: string;
    transitionDurationMs: number;
    isChapterStart: boolean;
    chapterTitle: string | null;
  }>;
  onAddSegment: () => void;
  onRemoveSegment: (segmentId: string) => Promise<void>;
  onReorderSegments: (segmentIds: string[]) => Promise<void>;
  onUpdateSegment: (segmentId: string, updates: Record<string, unknown>) => Promise<void>;
  onAssemble: () => Promise<void>;
  onUpdateCompilation: (updates: Record<string, unknown>) => Promise<void>;
  isAssembling?: boolean;
}

export function CompilationEditor({
  compilation,
  segments,
  onAddSegment,
  onRemoveSegment,
  onReorderSegments,
  onUpdateSegment,
  onAssemble,
  onUpdateCompilation,
  isAssembling = false,
}: CompilationEditorProps) {
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(compilation.title);

  const selectedSegment = segments.find(s => s.id === selectedSegmentId);

  const formatDuration = (seconds: number | null) => {
    if (seconds === null) return '--:--';
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const totalDuration = segments.reduce((total, seg) => total + (seg.durationSeconds || 0), 0);

  const handleTitleSubmit = () => {
    setIsEditingTitle(false);
    if (titleValue !== compilation.title && titleValue.trim()) {
      onUpdateCompilation({ title: titleValue.trim() });
    } else {
      setTitleValue(compilation.title);
    }
  };

  const moveSegment = (index: number, direction: 'up' | 'down') => {
    if (
      (direction === 'up' && index === 0) || 
      (direction === 'down' && index === segments.length - 1)
    ) return;
    
    const newSegments = [...segments];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    
    const temp = newSegments[index];
    newSegments[index] = newSegments[targetIndex];
    newSegments[targetIndex] = temp;
    
    onReorderSegments(newSegments.map(s => s.id));
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] border rounded-lg overflow-hidden bg-background">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b bg-card">
        <div className="flex items-center gap-4 flex-1">
          {isEditingTitle ? (
            <Input 
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleTitleSubmit}
              onKeyDown={(e) => e.key === 'Enter' && handleTitleSubmit()}
              className="max-w-md font-semibold text-lg h-9"
              autoFocus
            />
          ) : (
            <h1 
              className="font-semibold text-lg cursor-pointer hover:underline"
              onClick={() => setIsEditingTitle(true)}
            >
              {compilation.title}
            </h1>
          )}
          <Badge variant="outline" className="capitalize">
            {compilation.compilationType.replace('_', ' ')}
          </Badge>
          <Badge variant="secondary">
            {compilation.status}
          </Badge>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Film className="h-4 w-4" />
            <span>{segments.length} segments</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            <span>{formatDuration(totalDuration)}</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Timeline Panel */}
        <div className="w-[60%] border-r flex flex-col bg-muted/20">
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-2">
              {segments.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Film className="mx-auto h-8 w-8 mb-3 opacity-50" />
                  <p>No segments yet.</p>
                  <p className="text-sm">Click "Add Segments" to start building.</p>
                </div>
              ) : (
                segments.map((segment, index) => (
                  <div key={segment.id} className="flex flex-col gap-2">
                    <Card 
                      className={`
                        cursor-pointer transition-all border-l-4 overflow-hidden
                        ${selectedSegmentId === segment.id ? 'border-l-primary ring-1 ring-primary/20' : 'border-l-transparent hover:border-l-primary/50'}
                      `}
                      onClick={() => setSelectedSegmentId(segment.id)}
                    >
                      <div className="flex items-center p-2 gap-3">
                        <div className="flex flex-col gap-1 items-center px-1 text-muted-foreground/50 hover:text-foreground">
                          <button onClick={(e) => { e.stopPropagation(); moveSegment(index, 'up'); }} disabled={index === 0}>
                            <GripVertical className="h-4 w-4" />
                          </button>
                        </div>
                        
                        <div className="w-8 text-center text-xs font-medium text-muted-foreground">
                          {index + 1}
                        </div>
                        
                        <div className="h-12 w-20 bg-muted rounded overflow-hidden relative shrink-0">
                          {segment.thumbnailUrl ? (
                            <img src={segment.thumbnailUrl} alt="thumbnail" className="h-full w-full object-cover" />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center">
                              <Film className="h-4 w-4 text-muted-foreground/30" />
                            </div>
                          )}
                          {segment.isChapterStart && (
                            <div className="absolute top-0 right-0 bg-primary text-primary-foreground p-0.5 rounded-bl">
                              <Bookmark className="h-3 w-3" />
                            </div>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">
                              {segment.title || `Shot ${segment.sourceShotSequence}`}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {segment.sourceEpisodeTitle}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 pr-2">
                          <div className="text-sm tabular-nums">
                            {formatDuration(segment.durationSeconds)}
                          </div>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveSegment(segment.id);
                              if (selectedSegmentId === segment.id) setSelectedSegmentId(null);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>

                    {index < segments.length - 1 && (
                      <div className="flex items-center justify-center -my-1 relative z-10">
                        <Badge variant="outline" className="bg-background text-[10px] gap-1 px-1.5 py-0">
                          <ArrowRightLeft className="h-3 w-3" />
                          {segments[index + 1].transitionType || 'cut'}
                        </Badge>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Properties Panel */}
        <div className="w-[40%] flex flex-col bg-card">
          <ScrollArea className="flex-1">
            {selectedSegment ? (
              <div className="p-6 space-y-6">
                <div>
                  <h3 className="font-medium text-lg mb-1">Segment Details</h3>
                  <p className="text-sm text-muted-foreground">Configure properties and trim</p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Source</label>
                    <div className="text-sm p-3 bg-muted rounded-md break-all">
                      {selectedSegment.sourceEpisodeTitle} {selectedSegment.sourceShotSequence ? `(Shot ${selectedSegment.sourceShotSequence})` : ''}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Start (s)</label>
                      <Input 
                        type="number" 
                        value={selectedSegment.startSeconds} 
                        onChange={(e) => onUpdateSegment(selectedSegment.id, { startSeconds: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">End (s)</label>
                      <Input 
                        type="number" 
                        value={selectedSegment.endSeconds || ''} 
                        placeholder="End of media"
                        onChange={(e) => onUpdateSegment(selectedSegment.id, { endSeconds: e.target.value ? Number(e.target.value) : null })}
                      />
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-3">
                    <div className="flex items-center space-x-2">
                      <Checkbox 
                        id="chapter-start" 
                        checked={selectedSegment.isChapterStart}
                        onCheckedChange={(checked) => onUpdateSegment(selectedSegment.id, { isChapterStart: checked === true })}
                      />
                      <label htmlFor="chapter-start" className="text-sm font-medium flex items-center gap-1.5">
                        <Bookmark className="h-4 w-4 text-primary" />
                        Start new chapter here
                      </label>
                    </div>
                    
                    {selectedSegment.isChapterStart && (
                      <div className="pl-6 space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Chapter Title</label>
                        <Input 
                          value={selectedSegment.chapterTitle || ''} 
                          placeholder="e.g. Introduction"
                          onChange={(e) => onUpdateSegment(selectedSegment.id, { chapterTitle: e.target.value })}
                        />
                      </div>
                    )}
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Transition from previous</label>
                    <div className="grid grid-cols-2 gap-2">
                      <Select 
                        value={selectedSegment.transitionType} 
                        onValueChange={(val) => onUpdateSegment(selectedSegment.id, { transitionType: val })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cut">Cut</SelectItem>
                          <SelectItem value="crossfade">Crossfade</SelectItem>
                          <SelectItem value="fade_to_black">Fade to Black</SelectItem>
                        </SelectContent>
                      </Select>
                      
                      <Input 
                        type="number" 
                        placeholder="Duration (ms)"
                        value={selectedSegment.transitionDurationMs}
                        onChange={(e) => onUpdateSegment(selectedSegment.id, { transitionDurationMs: Number(e.target.value) })}
                        disabled={selectedSegment.transitionType === 'cut'}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-6">
                <div>
                  <h3 className="font-medium text-lg mb-1">Compilation Summary</h3>
                  <p className="text-sm text-muted-foreground">Select a segment to edit its properties</p>
                </div>
                
                <Card>
                  <CardContent className="p-4 space-y-4">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Total Duration</span>
                      <span className="font-medium tabular-nums">{formatDuration(totalDuration)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Segments</span>
                      <span className="font-medium">{segments.length}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Chapters</span>
                      <span className="font-medium">{compilation.chapters.length}</span>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-3">
                  <h4 className="font-medium text-sm flex items-center gap-2">
                    <Bookmark className="h-4 w-4" />
                    Chapters
                  </h4>
                  <ChapterPreview chapters={compilation.chapters} totalDurationSeconds={totalDuration} />
                </div>
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

      {/* Footer / Bottom Bar */}
      <footer className="p-4 border-t flex items-center justify-between bg-card">
        <Button onClick={onAddSegment} variant="outline" className="gap-2">
          <Plus className="h-4 w-4" />
          Add Segments
        </Button>
        
        <Button 
          onClick={onAssemble} 
          disabled={segments.length < 2 || isAssembling}
          className="gap-2"
        >
          {isAssembling ? (
            <Settings2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {isAssembling ? 'Assembling...' : 'Assemble & Render'}
        </Button>
      </footer>
    </div>
  );
}
