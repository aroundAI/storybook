'use client';

import { useState, useTransition } from 'react';
import { Button } from '@kit/ui/button';
import { Badge } from '@kit/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import {
  ChevronUpIcon,
  ChevronDownIcon,
  TrashIcon,
  PlusIcon,
} from 'lucide-react';
import { toast } from '@kit/ui/sonner';

interface LinkedSystemPrompt {
  id: string;
  system_prompt_id: string;
  order_index: number;
  system_prompt: {
    id: string;
    name: string;
    slug: string;
    layer_type: string;
    scope: string;
    priority: number;
  };
}

interface LinkedSystemPromptsManagerProps {
  templateId: string;
  linkedPrompts: LinkedSystemPrompt[];
  onUnlink: (templateId: string, systemPromptId: string) => Promise<void>;
  onReorder: (templateId: string, systemPromptId: string, newIndex: number) => Promise<void>;
  onAddClick: () => void;
  onRefresh: () => void;
}

export function LinkedSystemPromptsManager({
  templateId,
  linkedPrompts,
  onUnlink,
  onReorder,
  onAddClick,
  onRefresh,
}: LinkedSystemPromptsManagerProps) {
  const [isPending, startTransition] = useTransition();

  const handleUnlink = (systemPromptId: string) => {
    startTransition(async () => {
      try {
        await onUnlink(templateId, systemPromptId);
        toast.success('System prompt unlinked');
        onRefresh();
      } catch (error) {
        toast.error('Failed to unlink system prompt');
        console.error(error);
      }
    });
  };

  const handleMoveUp = (systemPromptId: string, currentIndex: number) => {
    if (currentIndex === 0) return;

    startTransition(async () => {
      try {
        await onReorder(templateId, systemPromptId, currentIndex - 1);
        toast.success('Order updated');
        onRefresh();
      } catch (error) {
        toast.error('Failed to update order');
        console.error(error);
      }
    });
  };

  const handleMoveDown = (systemPromptId: string, currentIndex: number, maxIndex: number) => {
    if (currentIndex === maxIndex) return;

    startTransition(async () => {
      try {
        await onReorder(templateId, systemPromptId, currentIndex + 1);
        toast.success('Order updated');
        onRefresh();
      } catch (error) {
        toast.error('Failed to update order');
        console.error(error);
      }
    });
  };

  const sortedPrompts = [...linkedPrompts].sort((a, b) => a.order_index - b.order_index);
  const maxIndex = sortedPrompts.length - 1;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Linked System Prompts</CardTitle>
          <Button onClick={onAddClick} size="sm">
            <PlusIcon className="mr-2 h-4 w-4" />
            Add System Prompts
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {sortedPrompts.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center text-sm">
            No system prompts linked. Click "Add System Prompts" to get started.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Order</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Layer</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead className="w-32 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedPrompts.map((link, index) => (
                <TableRow key={link.id}>
                  <TableCell className="font-mono text-xs">
                    #{link.order_index + 1}
                  </TableCell>
                  <TableCell className="font-medium">
                    {link.system_prompt.name}
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">
                      {link.system_prompt.slug}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {link.system_prompt.layer_type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {link.system_prompt.scope}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleMoveUp(link.system_prompt_id, index)}
                        disabled={index === 0 || isPending}
                        className="h-8 w-8 p-0"
                      >
                        <ChevronUpIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleMoveDown(link.system_prompt_id, index, maxIndex)}
                        disabled={index === maxIndex || isPending}
                        className="h-8 w-8 p-0"
                      >
                        <ChevronDownIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleUnlink(link.system_prompt_id)}
                        disabled={isPending}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
