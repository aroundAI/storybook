import { AdminGuard } from '@kit/admin/components/admin-guard';
import { PageBody, PageHeader } from '@kit/ui/page';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { CreateTemplateForm } from '../_components/create-template-form';
import { createPromptTemplateAction } from '@kit/prompt-templates/mutations';
import type { CreatePromptTemplateInput } from '@kit/prompt-templates/schemas';

async function NewTemplatePage() {
  // Server action wrapper for creating templates
  async function handleCreateTemplate(data: CreatePromptTemplateInput) {
    'use server';
    await createPromptTemplateAction(data);
  }

  return (
    <>
      <PageHeader description={<AppBreadcrumbs />}>
        <div>
          <h1 className="text-2xl font-bold">Create New Template</h1>
          <p className="text-muted-foreground text-sm">
            Templates are the base prompt definitions used across your
            application
          </p>
        </div>
      </PageHeader>

      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle>Template Details</CardTitle>
          </CardHeader>
          <CardContent>
            <CreateTemplateForm onSubmit={handleCreateTemplate} />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}

export default AdminGuard(NewTemplatePage);
