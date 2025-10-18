import { AdminGuard } from '@kit/admin/components/admin-guard';
import { PageBody, PageHeader } from '@kit/ui/page';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { EditTemplateForm } from '../../_components/edit-template-form';
import { redirect } from 'next/navigation';
import { updatePromptTemplateAction } from '@kit/prompt-templates/mutations';
import type { UpdatePromptTemplateInput } from '@kit/prompt-templates/schemas';

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

  // Server action wrapper for updating templates
  async function handleUpdateTemplate(data: UpdatePromptTemplateInput) {
    'use server';
    await updatePromptTemplateAction(data);
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
        <Card>
          <CardHeader>
            <CardTitle>Template Details</CardTitle>
          </CardHeader>
          <CardContent>
            <EditTemplateForm
              template={{
                ...template,
                tags: template.tags || [],
              }}
              onSubmit={handleUpdateTemplate}
            />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}

export default AdminGuard(EditTemplatePage);
