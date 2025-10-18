import { AdminGuard } from '@kit/admin/components/admin-guard';
import { PageBody, PageHeader } from '@kit/ui/page';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { GitBranchIcon, PencilIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';

async function PromptsAdminPage() {
  const adminClient = getSupabaseServerAdminClient();

  // Fetch all prompt templates
  const { data: templates } = await adminClient
    .from('prompt_templates')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  // Fetch all system prompts
  const { data: systemPrompts } = await adminClient
    .from('prompt_system_prompts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  // Get template stats
  const { count: templateCount } = await adminClient
    .from('prompt_templates')
    .select('*', { count: 'exact', head: true });

  const { count: systemPromptCount } = await adminClient
    .from('prompt_system_prompts')
    .select('*', { count: 'exact', head: true });

  const { count: executionCount } = await adminClient
    .from('prompt_execution_logs')
    .select('*', { count: 'exact', head: true });

  return (
    <>
      <PageHeader description={<AppBreadcrumbs />} title="Prompt Management" />

      <PageBody>
        {/* Stats Cards */}
        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Templates</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{templateCount ?? 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                System Prompts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {systemPromptCount ?? 0}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Total Executions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{executionCount ?? 0}</div>
            </CardContent>
          </Card>
        </div>

        {/* Templates and System Prompts Tabs */}
        <Tabs defaultValue="templates" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="system-prompts">System Prompts</TabsTrigger>
          </TabsList>

          {/* Templates Tab */}
          <TabsContent value="templates">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Prompt Templates</CardTitle>
                  <Link href="/admin/prompts/new">
                    <Button>
                      <PlusIcon className="mr-2 h-4 w-4" />
                      Create Template
                    </Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Slug</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Environment</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templates && templates.length > 0 ? (
                      templates.map((template) => (
                        <TableRow key={template.id}>
                          <TableCell className="font-medium">
                            <Link
                              href={`/admin/prompts/${template.id}/edit`}
                              className="hover:underline"
                            >
                              {template.name}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <code className="rounded bg-muted px-1 py-0.5 text-xs">
                              {template.slug}
                            </code>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{template.category}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {template.environment}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {template.is_active ? (
                              <Badge className="bg-green-500">Active</Badge>
                            ) : (
                              <Badge variant="destructive">Inactive</Badge>
                            )}
                          </TableCell>
                          <TableCell>v{template.version}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {new Date(template.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Link href={`/admin/prompts/${template.id}/edit`}>
                                <Button variant="outline" size="sm">
                                  <PencilIcon className="mr-2 h-4 w-4" />
                                  Edit
                                </Button>
                              </Link>
                              <Link
                                href={`/admin/prompts/${template.id}/variants`}
                              >
                                <Button variant="outline" size="sm">
                                  <GitBranchIcon className="mr-2 h-4 w-4" />
                                  Variants
                                </Button>
                              </Link>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="h-24 text-center text-muted-foreground"
                        >
                          No templates found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* System Prompts Tab */}
          <TabsContent value="system-prompts">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>System Prompts</CardTitle>
                  <Link href="/admin/prompts/system-prompts/new">
                    <Button>
                      <PlusIcon className="mr-2 h-4 w-4" />
                      Create System Prompt
                    </Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Slug</TableHead>
                      <TableHead>Layer</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {systemPrompts && systemPrompts.length > 0 ? (
                      systemPrompts.map((prompt) => (
                        <TableRow key={prompt.id}>
                          <TableCell className="font-medium">
                            <Link
                              href={`/admin/prompts/system-prompts/${prompt.id}/edit`}
                              className="hover:underline"
                            >
                              {prompt.name}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <code className="rounded bg-muted px-1 py-0.5 text-xs">
                              {prompt.slug}
                            </code>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{prompt.layer_type}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{prompt.scope}</Badge>
                          </TableCell>
                          <TableCell>{prompt.priority}</TableCell>
                          <TableCell>
                            {prompt.is_active ? (
                              <Badge className="bg-green-500">Active</Badge>
                            ) : (
                              <Badge variant="destructive">Inactive</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {new Date(prompt.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <Link
                              href={`/admin/prompts/system-prompts/${prompt.id}/edit`}
                            >
                              <Button variant="outline" size="sm">
                                <PencilIcon className="mr-2 h-4 w-4" />
                                Edit
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="h-24 text-center text-muted-foreground"
                        >
                          No system prompts found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}

export default AdminGuard(PromptsAdminPage);
