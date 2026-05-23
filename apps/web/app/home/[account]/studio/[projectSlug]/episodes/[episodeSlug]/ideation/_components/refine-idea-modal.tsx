'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Eye, Loader2, Sparkles, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { ContentStyle } from '@kit/episodes/lib';
import type { StoryIdea } from '@kit/prompt-engine/schemas';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

// ============================================================
// Types
// ============================================================

export interface RefinedStoryIdea {
  title: string;
  logline: string;
  themes: string[];
  hook: string;
  visualPotential: string;
  targetDuration: number;
  contentStyle: ContentStyle;
}

// ============================================================
// Schema
// ============================================================

const RefineIdeaSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  logline: z
    .string()
    .min(10, 'Logline must be at least 10 characters')
    .max(500),
  hook: z.string().max(500).optional().default(''),
  visualPotential: z.string().max(500).optional().default(''),
});

// ============================================================
// Props
// ============================================================

interface RefineIdeaModalProps {
  idea: StoryIdea;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (refined: RefinedStoryIdea) => void;
  isGenerating: boolean;
  targetDuration: number;
  contentStyle: ContentStyle;
}

// ============================================================
// Editable Themes Tag Input
// ============================================================

function EditableThemes({
  themes,
  onChange,
}: {
  themes: string[];
  onChange: (themes: string[]) => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [newTheme, setNewTheme] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAdd = useCallback(() => {
    const trimmed = newTheme.trim();
    if (
      trimmed &&
      trimmed.length <= 50 &&
      themes.length < 10 &&
      !themes.some((t) => t.toLowerCase() === trimmed.toLowerCase())
    ) {
      onChange([...themes, trimmed]);
    }
    setNewTheme('');
    setIsAdding(false);
  }, [newTheme, themes, onChange]);

  const handleRemove = useCallback(
    (index: number) => {
      onChange(themes.filter((_, i) => i !== index));
    },
    [themes, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAdd();
      } else if (e.key === 'Escape') {
        setNewTheme('');
        setIsAdding(false);
      }
    },
    [handleAdd],
  );

  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAdding]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {themes.map((theme, index) => (
        <span
          key={`${theme}-${index}`}
          className="group/tag animate-in fade-in-0 inline-flex items-center gap-1.5 rounded-md bg-[#252525] px-2.5 py-1 text-xs text-[#A3A3A3] transition-colors hover:bg-[#2a2a2a] dark:bg-[#252525] dark:text-[#A3A3A3]"
        >
          {theme}
          <button
            type="button"
            onClick={() => handleRemove(index)}
            className="rounded-full p-0.5 opacity-50 transition-opacity hover:bg-white/10 hover:opacity-100"
            aria-label={`Remove theme: ${theme}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      {themes.length < 10 &&
        (isAdding ? (
          <input
            ref={inputRef}
            type="text"
            value={newTheme}
            onChange={(e) => setNewTheme(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleAdd}
            placeholder="Type and press Enter"
            maxLength={50}
            className="h-7 w-36 rounded-md border border-dashed border-white/20 bg-transparent px-2 text-xs text-white placeholder:text-slate-500 focus:border-[#3B82F6]/40 focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-white/20 px-2.5 py-1 text-xs text-slate-500 transition-colors hover:border-white/30 hover:text-slate-400"
          >
            + Add theme
          </button>
        ))}
    </div>
  );
}

// ============================================================
// RefineIdeaModal Component
// ============================================================

export function RefineIdeaModal({
  idea,
  open,
  onOpenChange,
  onConfirm,
  isGenerating,
  targetDuration,
  contentStyle,
}: RefineIdeaModalProps) {
  // Themes are managed separately since they're an array (not a simple form field)
  const [themes, setThemes] = useState<string[]>(idea.themes ?? []);

  const form = useForm({
    resolver: zodResolver(RefineIdeaSchema),
    defaultValues: {
      title: idea.title,
      logline: idea.logline,
      hook: idea.hook ?? '',
      visualPotential: idea.visualPotential ?? '',
    },
  });

  const handleConfirm = form.handleSubmit((data) => {
    onConfirm({
      title: data.title,
      logline: data.logline,
      themes,
      hook: data.hook ?? '',
      visualPotential: data.visualPotential ?? '',
      targetDuration,
      contentStyle,
    });
  });

  const loglineLength = form.watch('logline')?.length ?? 0;
  const hookLength = form.watch('hook')?.length ?? 0;
  const visualLength = form.watch('visualPotential')?.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'sm:max-w-2xl',
          'border-white/[0.08] bg-gradient-to-b from-[#1a1a1a]/95 to-[#111111]/95',
          'shadow-[0_8px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl',
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-white">
            <Sparkles className="h-5 w-5 text-[#3B82F6]" />
            Refine Your Story
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-400">
            Fine-tune your variation before generating the full story. Edit any
            field to guide the narrative.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleConfirm} className="space-y-5">
          {/* Title */}
          <div className="space-y-2">
            <Label className="cinema-ui-label">Title</Label>
            <Input
              {...form.register('title')}
              className="border-white/[0.08] bg-white/[0.03] text-white transition-colors focus:border-[#3B82F6]/40 dark:border-white/[0.08] dark:bg-white/[0.03]"
              placeholder="Episode title"
            />
            {form.formState.errors.title && (
              <p className="text-xs text-red-400">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>

          {/* Logline */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="cinema-ui-label">Logline</Label>
              <span className="text-xs text-slate-500">
                {loglineLength}/500
              </span>
            </div>
            <Textarea
              {...form.register('logline')}
              className="min-h-[100px] resize-none border-white/[0.08] bg-white/[0.03] text-sm leading-relaxed text-white transition-colors focus:border-[#3B82F6]/40 dark:border-white/[0.08] dark:bg-white/[0.03]"
              placeholder="One-sentence story summary..."
            />
            {form.formState.errors.logline && (
              <p className="text-xs text-red-400">
                {form.formState.errors.logline.message}
              </p>
            )}
          </div>

          {/* Themes */}
          <div className="space-y-2">
            <Label className="cinema-ui-label flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" />
              Themes
            </Label>
            <EditableThemes themes={themes} onChange={setThemes} />
            {themes.length === 0 && (
              <p className="text-xs text-amber-400/70">
                Add at least one theme to guide the story direction
              </p>
            )}
          </div>

          {/* Hook */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="cinema-ui-label">Hook</Label>
              <span className="text-xs text-slate-500">{hookLength}/500</span>
            </div>
            <Textarea
              {...form.register('hook')}
              className="min-h-[70px] resize-none border-white/[0.08] bg-white/[0.03] text-sm leading-relaxed text-white transition-colors focus:border-[#3B82F6]/40 dark:border-white/[0.08] dark:bg-white/[0.03]"
              placeholder="What makes this story uniquely engaging?"
            />
          </div>

          {/* Visual Direction */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="cinema-ui-label flex items-center gap-1.5">
                <Eye className="h-3 w-3" />
                Visual Direction
              </Label>
              <span className="text-xs text-slate-500">{visualLength}/500</span>
            </div>
            <Textarea
              {...form.register('visualPotential')}
              className="min-h-[70px] resize-none border-white/[0.08] bg-white/[0.03] text-sm leading-relaxed text-white transition-colors focus:border-[#3B82F6]/40 dark:border-white/[0.08] dark:bg-white/[0.03]"
              placeholder="How this story works well for video..."
            />
          </div>

          <DialogFooter className="gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isGenerating}
              className="btn-cinema-secondary"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isGenerating}
              className="btn-cinema-primary gap-2"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating Story...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate Story
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
