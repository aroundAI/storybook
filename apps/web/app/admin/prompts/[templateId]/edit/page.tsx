import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ChevronRightIcon } from 'lucide-react';

import { AdminGuard } from '@kit/admin/components/admin-guard';
import {
  linkSystemPromptAction,
  unlinkSystemPromptAction,
  updatePromptTemplateAction,
} from '@kit/prompt-templates/mutations';
import type { UpdatePromptTemplateInput } from '@kit/prompt-templates/schemas';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { PageBody, PageHeader } from '@kit/ui/page';

import { EditTemplatePageClient } from './_components/edit-template-page-client';

async function EditTemplatePage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  const adminClient = getSupabaseServerAdminClient();

  // Fetch template
  const { data: template, error } = await adminClient
    .from('prompt_templates')
    .select('*')
    .eq('id', templateId)
    .single();

  if (error || !template) {
    redirect('/admin/prompts');
  }

  // Fetch linked system prompts
  const { data: linkedPrompts } = await adminClient
    .from('template_system_prompt_links')
    .select(
      `
      id,
      system_prompt_id,
      order_index,
      system_prompt:prompt_system_prompts (
        id,
        name,
        slug,
        layer_type,
        scope,
        priority
      )
    `,
    )
    .eq('template_id', templateId)
    .order('order_index');

  // Fetch all active system prompts for the add dialog
  const { data: availablePrompts } = await adminClient
    .from('prompt_system_prompts')
    .select('id, name, slug, layer_type, scope, is_active')
    .eq('is_active', true)
    .order('name');

  // Server action wrappers
  async function handleUpdateTemplate(data: UpdatePromptTemplateInput) {
    'use server';
    await updatePromptTemplateAction(data as never);
    revalidatePath(`/admin/prompts/${templateId}/edit`);
  }

  async function handleUnlinkPrompt(tid: string, promptId: string) {
    'use server';
    await unlinkSystemPromptAction({
      template_id: tid,
      system_prompt_id: promptId,
    });
    revalidatePath(`/admin/prompts/${templateId}/edit`);
  }

  async function handleReorderPrompt(
    tid: string,
    promptId: string,
    newIndex: number,
  ) {
    'use server';
    // First unlink, then relink with new order
    await unlinkSystemPromptAction({
      template_id: tid,
      system_prompt_id: promptId,
    });
    await linkSystemPromptAction({
      template_id: tid,
      system_prompt_id: promptId,
      order_index: newIndex,
    });
    revalidatePath(`/admin/prompts/${templateId}/edit`);
  }

  async function handleAddPrompts(tid: string, promptIds: string[]) {
    'use server';
    const client = getSupabaseServerAdminClient();

    // Get current max order_index
    const { data: links } = await client
      .from('template_system_prompt_links')
      .select('order_index')
      .eq('template_id', tid)
      .order('order_index', { ascending: false })
      .limit(1);

    let nextIndex =
      links && links.length > 0 ? (links[0]?.order_index ?? -1) + 1 : 0;

    // Add each prompt with incrementing order_index
    for (const promptId of promptIds) {
      await linkSystemPromptAction({
        template_id: tid,
        system_prompt_id: promptId,
        order_index: nextIndex,
      });
      nextIndex++;
    }
    revalidatePath(`/admin/prompts/${templateId}/edit`);
  }

  async function handleRefresh() {
    'use server';
    revalidatePath(`/admin/prompts/${templateId}/edit`);
  }

  return (
    <>
      <PageHeader
        title="Edit Template"
        description={
          <div className="space-y-2">
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Link href="/admin" className="hover:text-foreground">
                Admin
              </Link>
              <ChevronRightIcon className="h-4 w-4" />
              <Link href="/admin/prompts" className="hover:text-foreground">
                Prompts
              </Link>
              <ChevronRightIcon className="h-4 w-4" />
              <span className="text-foreground">{template.name}</span>
            </div>
            <p className="text-muted-foreground text-sm">
              Template: <span className="font-medium">{template.name}</span>{' '}
              <code className="bg-muted rounded px-1 py-0.5 text-xs">
                {template.slug}
              </code>
            </p>
          </div>
        }
      />

      <PageBody>
        <EditTemplatePageClient
          template={{
            ...template,
            tags: template.tags || [],
          }}
          linkedPrompts={linkedPrompts || []}
          availablePrompts={availablePrompts || []}
          onUpdateTemplate={handleUpdateTemplate}
          onUnlinkPrompt={handleUnlinkPrompt}
          onReorderPrompt={handleReorderPrompt}
          onAddPrompts={handleAddPrompts}
          onRefresh={handleRefresh}
        />
      </PageBody>
    </>
  );
}

export default AdminGuard(EditTemplatePage);
