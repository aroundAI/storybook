'use client';

import { useState, useTransition } from 'react';

import {
  Loader2,
  Newspaper,
  Search,
  Send,
  Settings2,
  Sparkles,
} from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { Switch } from '@kit/ui/switch';
import { Textarea } from '@kit/ui/textarea';

interface NotesInputProps {
  onSubmit: (data: {
    rawNotes: string;
    enableResearch: boolean;
    tone: string;
    authorContext: string;
  }) => Promise<void>;
  disabled?: boolean;
}

export function NotesInput({ onSubmit, disabled = false }: NotesInputProps) {
  const [rawNotes, setRawNotes] = useState('');
  const [enableResearch, setEnableResearch] = useState(true);
  const [tone, setTone] = useState('Professional yet authentic, thought-provoking');
  const [authorContext, setAuthorContext] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [isPending, startTransition] = useTransition();

  const charCount = rawNotes.length;
  const isValid = charCount >= 10 && charCount <= 10000;

  const handleSubmit = () => {
    if (!isValid || isPending) return;

    startTransition(async () => {
      await onSubmit({
        rawNotes,
        enableResearch,
        tone,
        authorContext,
      });
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Newspaper className="h-5 w-5" />
              Paste Your Notes
            </CardTitle>
            <CardDescription className="mt-1">
              Paste your notes, thoughts, or commentary. AI will transform them
              into polished LinkedIn posts.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings2 className="mr-1 h-4 w-4" />
            Settings
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={rawNotes}
          onChange={(e) => setRawNotes(e.target.value)}
          placeholder="Paste your notes, ideas, or commentary here...

Example: I've been thinking about how AI is changing the way we build software. The key insight is that..."
          rows={8}
          disabled={disabled || isPending}
          className="resize-y font-mono text-sm"
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="research-toggle"
                checked={enableResearch}
                onCheckedChange={setEnableResearch}
                disabled={disabled || isPending}
              />
              <Label
                htmlFor="research-toggle"
                className="flex cursor-pointer items-center gap-1.5 text-sm"
              >
                <Search className="h-3.5 w-3.5" />
                Enrich with research
              </Label>
            </div>
            {enableResearch && (
              <Badge variant="secondary" className="text-xs">
                <Sparkles className="mr-1 h-3 w-3" />
                Brave Search + News
              </Badge>
            )}
          </div>

          <span
            className={`text-sm ${
              charCount > 10000
                ? 'text-red-500'
                : charCount < 10
                  ? 'text-muted-foreground'
                  : 'text-green-600'
            }`}
          >
            {charCount.toLocaleString()} chars
          </span>
        </div>

        {showSettings && (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="space-y-2">
              <Label htmlFor="tone" className="text-sm font-medium">
                Tone
              </Label>
              <Input
                id="tone"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                placeholder="e.g., Professional, Casual, Thought-provoking"
                disabled={disabled || isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="author-context" className="text-sm font-medium">
                Author Context
              </Label>
              <Input
                id="author-context"
                value={authorContext}
                onChange={(e) => setAuthorContext(e.target.value)}
                placeholder="e.g., CEO of a SaaS startup, sharing insights on AI and productivity"
                disabled={disabled || isPending}
              />
            </div>
          </div>
        )}

        <Button
          onClick={handleSubmit}
          disabled={!isValid || disabled || isPending}
          className="w-full"
          size="lg"
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {enableResearch
                ? 'Researching & Generating...'
                : 'Generating variants...'}
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              Generate LinkedIn Post Variants
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
