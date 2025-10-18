'use client';

import { useState, useTransition } from 'react';

import { Loader2Icon, SearchIcon } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { toast } from '@kit/ui/sonner';

interface SystemPrompt {
  id: string;
  name: string;
  slug: string;
  layer_type: string;
  scope: string;
  is_active: boolean;
}

interface AddSystemPromptsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  availablePrompts: SystemPrompt[];
  linkedPromptIds: string[];
  onAdd: (templateId: string, systemPromptIds: string[]) => Promise<void>;
  onSuccess: () => void;
}

export function AddSystemPromptsDialog({
  open,
  onOpenChange,
  templateId,
  availablePrompts,
  linkedPromptIds,
  onAdd,
  onSuccess,
}: AddSystemPromptsDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const handleToggle = (promptId: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(promptId)) {
      newSelected.delete(promptId);
    } else {
      newSelected.add(promptId);
    }
    setSelectedIds(newSelected);
  };

  const handleAdd = () => {
    if (selectedIds.size === 0) {
      toast.error('Please select at least one system prompt');
      return;
    }

    startTransition(async () => {
      try {
        await onAdd(templateId, Array.from(selectedIds));
        toast.success(`Added ${selectedIds.size} system prompt(s)`);
        setSelectedIds(new Set());
        setSearchQuery('');
        onSuccess();
        onOpenChange(false);
      } catch (error) {
        toast.error('Failed to add system prompts');
        console.error(error);
      }
    });
  };

  const filteredPrompts = availablePrompts
    .filter((p) => !linkedPromptIds.includes(p.id))
    .filter((p) => p.is_active)
    .filter((p) => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(query) ||
        p.slug.toLowerCase().includes(query) ||
        p.layer_type.toLowerCase().includes(query)
      );
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Add System Prompts</DialogTitle>
          <DialogDescription>
            Select system prompts to link to this template. They will be
            composed in the order you add them.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search by name, slug, or layer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex-1 overflow-y-auto rounded-md border">
          {filteredPrompts.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-sm">
              {searchQuery
                ? 'No system prompts match your search'
                : 'No available system prompts to add'}
            </div>
          ) : (
            <div className="divide-y">
              {filteredPrompts.map((prompt) => (
                <label
                  key={prompt.id}
                  className="hover:bg-muted/50 flex cursor-pointer items-start gap-3 p-3"
                >
                  <Checkbox
                    checked={selectedIds.has(prompt.id)}
                    onCheckedChange={() => handleToggle(prompt.id)}
                    className="mt-1"
                  />
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{prompt.name}</span>
                      <code className="bg-muted rounded px-1 py-0.5 text-xs">
                        {prompt.slug}
                      </code>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant="outline" className="text-xs">
                        {prompt.layer_type}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {prompt.scope}
                      </Badge>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="flex w-full items-center justify-between">
            <span className="text-muted-foreground text-sm">
              {selectedIds.size} selected
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAdd}
                disabled={isPending || selectedIds.size === 0}
              >
                {isPending && (
                  <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                )}
                Add {selectedIds.size > 0 && `(${selectedIds.size})`}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
