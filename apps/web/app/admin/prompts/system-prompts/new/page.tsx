import { AdminGuard } from '@kit/admin/components/admin-guard';
import { PageBody, PageHeader } from '@kit/ui/page';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { CreateSystemPromptForm } from '../../_components/create-system-prompt-form';
import { createSystemPromptAction } from '@kit/prompt-templates/mutations';
import type { CreateSystemPromptInput } from '@kit/prompt-templates/schemas';

async function NewSystemPromptPage() {
  // Server action wrapper for creating system prompts
  async function handleCreateSystemPrompt(data: CreateSystemPromptInput) {
    'use server';
    await createSystemPromptAction(data);
  }

  return (
    <>
      <PageHeader description={<AppBreadcrumbs />}>
        <div>
          <h1 className="text-2xl font-bold">Create New System Prompt</h1>
          <p className="text-muted-foreground text-sm">
            System prompts are reusable fragments that can be composed with
            templates
          </p>
        </div>
      </PageHeader>

      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle>System Prompt Details</CardTitle>
          </CardHeader>
          <CardContent>
            <CreateSystemPromptForm onSubmit={handleCreateSystemPrompt} />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}

export default AdminGuard(NewSystemPromptPage);
