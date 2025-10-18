'use client';

import { useState } from 'react';
import { EditTemplateForm } from '../../../_components/edit-template-form';
import { LinkedSystemPromptsManager } from '../../../_components/linked-system-prompts-manager';
import { AddSystemPromptsDialog } from '../../../_components/add-system-prompts-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

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
  onUpdateTemplate: (data: any) => Promise<void>;
  onUnlinkPrompt: (templateId: string, systemPromptId: string) => Promise<void>;
  onReorderPrompt: (templateId: string, systemPromptId: string, newIndex: number) => Promise<void>;
  onAddPrompts: (templateId: string, systemPromptIds: string[]) => Promise<void>;
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

  const linkedPromptIds = linkedPrompts.map((link) => link.system_prompt_id);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Template Details</CardTitle>
        </CardHeader>
        <CardContent>
          <EditTemplateForm template={template} onSubmit={onUpdateTemplate} />
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
