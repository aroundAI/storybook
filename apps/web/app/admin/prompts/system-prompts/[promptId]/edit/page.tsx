import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ChevronRightIcon } from 'lucide-react';

import { AdminGuard } from '@kit/admin/components/admin-guard';
import { updateSystemPromptAction } from '@kit/prompt-templates/mutations';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { PageBody, PageHeader } from '@kit/ui/page';

import { EditSystemPromptForm } from '../../../_components/edit-system-prompt-form';

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
      <PageHeader
        description={
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Link href="/admin" className="hover:text-foreground">
              Admin
            </Link>
            <ChevronRightIcon className="h-4 w-4" />
            <Link href="/admin/prompts" className="hover:text-foreground">
              Prompts
            </Link>
            <ChevronRightIcon className="h-4 w-4" />
            <span className="text-foreground">{systemPrompt.name}</span>
          </div>
        }
      >
        <div>
          <h1 className="text-2xl font-bold">Edit System Prompt</h1>
          <p className="text-muted-foreground text-sm">
            System Prompt:{' '}
            <span className="font-medium">{systemPrompt.name}</span>{' '}
            <code className="bg-muted rounded px-1 py-0.5 text-xs">
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
