import { AdminGuard } from '@kit/admin/components/admin-guard';
import { PageBody, PageHeader } from '@kit/ui/page';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { EditTemplatePageClient } from './_components/edit-template-page-client';
import { redirect } from 'next/navigation';
import {
  updatePromptTemplateAction,
  linkSystemPromptAction,
  unlinkSystemPromptAction,
} from '@kit/prompt-templates/mutations';
import type { UpdatePromptTemplateInput } from '@kit/prompt-templates/schemas';
import { revalidatePath } from 'next/cache';

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
    .select(`
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
    `)
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

  async function handleReorderPrompt(tid: string, promptId: string, newIndex: number) {
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
    // Get current max order_index
    const { data: links } = await adminClient
      .from('template_system_prompt_links')
      .select('order_index')
      .eq('template_id', tid)
      .order('order_index', { ascending: false })
      .limit(1);

    let nextIndex = links && links.length > 0 ? (links[0]?.order_index ?? -1) + 1 : 0;

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

  function handleRefresh() {
    'use server';
    revalidatePath(`/admin/prompts/${templateId}/edit`);
  }

  return (
    <>
      <PageHeader description={<AppBreadcrumbs />}>
        <div>
          <h1 className="text-2xl font-bold">Edit Template</h1>
          <p className="text-muted-foreground text-sm">
            Template:{' '}
            <span className="font-medium">{template.name}</span>{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              {template.slug}
            </code>
          </p>
        </div>
      </PageHeader>

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
