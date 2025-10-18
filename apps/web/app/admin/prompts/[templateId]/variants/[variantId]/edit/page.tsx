import { AdminGuard } from '@kit/admin/components/admin-guard';
import { PageBody, PageHeader } from '@kit/ui/page';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { EditVariantForm } from '../../_components/edit-variant-form';
import { redirect } from 'next/navigation';

async function EditVariantPage({
  params,
}: {
  params: Promise<{ templateId: string; variantId: string }>;
}) {
  const { templateId, variantId } = await params;
  const adminClient = getSupabaseServerAdminClient();

  // Fetch template and variant
  const [{ data: template }, { data: variant }] = await Promise.all([
    adminClient
      .from('prompt_templates')
      .select('id, slug, name, category')
      .eq('id', templateId)
      .single(),
    adminClient
      .from('template_variants')
      .select('*')
      .eq('id', variantId)
      .single(),
  ]);

  if (!template || !variant) {
    redirect('/admin/prompts');
  }

  // Verify variant belongs to template
  if (variant.template_id !== templateId) {
    redirect(`/admin/prompts/${templateId}/variants`);
  }

  return (
    <>
      <PageHeader description={<AppBreadcrumbs />}>
        <div>
          <h1 className="text-2xl font-bold">Edit Variant</h1>
          <p className="text-muted-foreground text-sm">
            Template: <span className="font-medium">{template.name}</span>{' '}
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
            <EditVariantForm variant={variant} templateId={templateId} />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}

export default AdminGuard(EditVariantPage);
