'use client';

import { useState } from 'react';
import { Copy, Check, Info } from 'lucide-react';
import { Button } from '@kit/ui/button';
import { Card } from '@kit/ui/card';

interface ChapterPreviewProps {
  chapters: Array<{ title: string; startSeconds: number }>;
  totalDurationSeconds: number;
}

export function ChapterPreview({ chapters, totalDurationSeconds }: ChapterPreviewProps) {
  const [copied, setCopied] = useState(false);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const pad = (num: number) => num.toString().padStart(2, '0');

    if (h > 0) {
      return `${h}:${pad(m)}:${pad(s)}`;
    }
    return `${m}:${pad(s)}`;
  };

  const getChaptersText = () => {
    return chapters
      .sort((a, b) => a.startSeconds - b.startSeconds)
      .map(c => `${formatTime(c.startSeconds)} ${c.title}`)
      .join('\n');
  };

  const handleCopy = async () => {
    const text = getChaptersText();
    if (!text) return;
    
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  if (chapters.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
        <Info className="h-5 w-5 opacity-50" />
        <p>No chapters defined.</p>
        <p className="text-xs">
          Select a segment and enable "Start new chapter here" to add chapters for YouTube.
        </p>
      </div>
    );
  }

  const sortedChapters = [...chapters].sort((a, b) => a.startSeconds - b.startSeconds);
  
  // Ensure we have a 0:00 chapter as required by YouTube
  const hasZeroChapter = sortedChapters.length > 0 && sortedChapters[0].startSeconds === 0;

  return (
    <div className="space-y-4">
      {/* Visual Timeline */}
      <div className="h-2 bg-muted rounded-full overflow-hidden relative">
        {totalDurationSeconds > 0 && sortedChapters.map((chapter, i) => {
          const percent = (chapter.startSeconds / totalDurationSeconds) * 100;
          return (
            <div 
              key={i}
              className="absolute top-0 bottom-0 w-1 bg-primary border-r border-background"
              style={{ left: `${Math.min(percent, 99)}%` }}
              title={`${formatTime(chapter.startSeconds)} - ${chapter.title}`}
            />
          );
        })}
      </div>

      {!hasZeroChapter && (
        <p className="text-xs text-amber-600 dark:text-amber-500 font-medium">
          Note: YouTube requires the first chapter to start at 0:00.
        </p>
      )}

      {/* Text Output */}
      <Card className="relative overflow-hidden group">
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button 
            size="sm" 
            variant="secondary" 
            className="h-7 px-2 text-xs gap-1 shadow-sm"
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <Check className="h-3 w-3" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" /> Copy
              </>
            )}
          </Button>
        </div>
        <pre className="p-4 text-sm font-mono text-muted-foreground whitespace-pre-wrap">
          {getChaptersText()}
        </pre>
      </Card>
    </div>
  );
}
