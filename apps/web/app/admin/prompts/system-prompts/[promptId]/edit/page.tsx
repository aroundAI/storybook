import { AdminGuard } from '@kit/admin/components/admin-guard';
import { PageBody, PageHeader } from '@kit/ui/page';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { EditSystemPromptForm } from '../../../_components/edit-system-prompt-form';
import { redirect } from 'next/navigation';
import { updateSystemPromptAction } from '@kit/prompt-templates/mutations';

async function EditSystemPromptPage({
  params,
}: {
  params: Promise<{ promptId: string }>;
}) {
  const { promptId } = await params;
  const adminClient = getSupabaseServerAdminClient();

  // Fetch system prompt
  const { data: systemPrompt, error } = await adminClient
    .from('prompt_system_prompts')
    .select('*')
    .eq('id', promptId)
    .single();

  if (error || !systemPrompt) {
    redirect('/admin/prompts');
  }

  // Server action wrapper for updating system prompts
  async function handleUpdateSystemPrompt(
    data: Parameters<typeof updateSystemPromptAction>[0],
  ) {
    'use server';
    await updateSystemPromptAction(data);
  }

  return (
    <>
      <PageHeader description={<AppBreadcrumbs />}>
        <div>
          <h1 className="text-2xl font-bold">Edit System Prompt</h1>
          <p className="text-muted-foreground text-sm">
            System Prompt:{' '}
            <span className="font-medium">{systemPrompt.name}</span>{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              {systemPrompt.slug}
            </code>
          </p>
        </div>
      </PageHeader>

      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle>System Prompt Details</CardTitle>
          </CardHeader>
          <CardContent>
            <EditSystemPromptForm
              systemPrompt={{
                ...systemPrompt,
                tags: systemPrompt.tags || [],
              }}
              onSubmit={handleUpdateSystemPrompt}
            />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}

export default AdminGuard(EditSystemPromptPage);
