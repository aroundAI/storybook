import { AdminGuard } from '@kit/admin/components/admin-guard';
import { PageBody, PageHeader } from '@kit/ui/page';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { CreateVariantForm } from '../_components/create-variant-form';
import { redirect } from 'next/navigation';
import { createVariantAction } from '@kit/prompt-templates/mutations';

async function NewVariantPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  const adminClient = getSupabaseServerAdminClient();

  // Fetch template to show context
  const { data: template, error } = await adminClient
    .from('prompt_templates')
    .select('id, slug, name, category')
    .eq('id', templateId)
    .single();

  if (error || !template) {
    redirect('/admin/prompts');
  }

  // Server action wrapper for creating variants
  async function handleCreateVariant(data: Parameters<typeof createVariantAction>[0]) {
    'use server';
    await createVariantAction(data);
  }

  return (
    <>
      <PageHeader description={<AppBreadcrumbs />}>
        <div>
          <h1 className="text-2xl font-bold">Create New Variant</h1>
          <p className="text-muted-foreground text-sm">
            For template:{' '}
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
            <CardTitle>Variant Details</CardTitle>
          </CardHeader>
          <CardContent>
            <CreateVariantForm
              templateId={templateId}
              onSubmit={handleCreateVariant}
            />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}

export default AdminGuard(NewVariantPage);
