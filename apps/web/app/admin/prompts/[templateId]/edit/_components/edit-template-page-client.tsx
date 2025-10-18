'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Loader2Icon } from 'lucide-react';

import type { UpdatePromptTemplateInput } from '@kit/prompt-templates/schemas';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import { AddSystemPromptsDialog } from '../../../_components/add-system-prompts-dialog';
import { EditTemplateForm } from '../../../_components/edit-template-form';
import { LinkedSystemPromptsManager } from '../../../_components/linked-system-prompts-manager';

interface Template {
  id: string;
  name: string;
  description: string | null;
  template_content: string;
  composition_strategy: string;
  is_active: boolean;
  tags: string[];
}

interface LinkedPrompt {
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

interface SystemPrompt {
  id: string;
  name: string;
  slug: string;
  layer_type: string;
  scope: string;
  is_active: boolean;
}

interface EditTemplatePageClientProps {
  template: Template;
  linkedPrompts: LinkedPrompt[];
  availablePrompts: SystemPrompt[];
  onUpdateTemplate: (data: UpdatePromptTemplateInput) => Promise<void>;
  onUnlinkPrompt: (templateId: string, systemPromptId: string) => Promise<void>;
  onReorderPrompt: (
    templateId: string,
    systemPromptId: string,
    newIndex: number,
  ) => Promise<void>;
  onAddPrompts: (
    templateId: string,
    systemPromptIds: string[],
  ) => Promise<void>;
  onRefresh: () => void;
}

export function EditTemplatePageClient({
  template,
  linkedPrompts,
  availablePrompts,
  onUpdateTemplate,
  onUnlinkPrompt,
  onReorderPrompt,
  onAddPrompts,
  onRefresh,
}: EditTemplatePageClientProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isPending] = useTransition();
  const router = useRouter();

  const linkedPromptIds = linkedPrompts.map((link) => link.system_prompt_id);

  const handleCancel = () => {
    router.push('/admin/prompts');
  };

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Template Details</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <EditTemplateForm
            template={template}
            onSubmit={onUpdateTemplate}
            formId="edit-template-form"
          />
        </CardContent>
      </Card>

      <LinkedSystemPromptsManager
        templateId={template.id}
        linkedPrompts={linkedPrompts}
        onUnlink={onUnlinkPrompt}
        onReorder={onReorderPrompt}
        onAddClick={() => setIsAddDialogOpen(true)}
        onRefresh={onRefresh}
      />

      <div className="flex justify-end gap-3 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={handleCancel}
          disabled={isPending}
          size="lg"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          form="edit-template-form"
          disabled={isPending}
          size="lg"
        >
          {isPending && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
          Update Template
        </Button>
      </div>

      <AddSystemPromptsDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        templateId={template.id}
        availablePrompts={availablePrompts}
        linkedPromptIds={linkedPromptIds}
        onAdd={onAddPrompts}
        onSuccess={onRefresh}
      />
    </div>
  );
}
