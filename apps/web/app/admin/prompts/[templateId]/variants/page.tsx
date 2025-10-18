import Link from 'next/link';

import { PlusIcon } from 'lucide-react';

import { AdminGuard } from '@kit/admin/components/admin-guard';
import {
  assignVariantToAccountAction,
  deleteVariantAction,
  unassignVariantFromAccountAction,
} from '@kit/prompt-templates/mutations';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { AppBreadcrumbs } from '@kit/ui/app-breadcrumbs';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { PageBody, PageHeader } from '@kit/ui/page';

import { TrafficSplitVisualization } from './_components/traffic-split-visualization';
import { VariantCard } from './_components/variant-card';

async function VariantsManagementPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  const adminClient = getSupabaseServerAdminClient();

  // Fetch template details
  const { data: template } = await adminClient
    .from('prompt_templates')
    .select('*')
    .eq('id', templateId)
    .single();

  if (!template) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">Template not found</p>
      </div>
    );
  }

  // Fetch all variants for this template
  const { data: variants } = await adminClient
    .from('template_variants')
    .select('*')
    .eq('template_id', templateId)
    .order('created_at', { ascending: false });

  // Fetch assignments for all variants
  const variantIds = variants?.map((v) => v.id) || [];
  const { data: assignments } = variantIds.length
    ? await adminClient
        .from('variant_account_assignments')
        .select(
          `
          *,
          account:accounts (
            id,
            name,
            slug,
            picture_url
          )
        `,
        )
        .in('variant_id', variantIds)
    : { data: [] };

  // Calculate total traffic weight
  const totalWeight =
    variants
      ?.filter((v) => v.is_active)
      .reduce((sum, v) => sum + Number(v.traffic_weight), 0) || 0;

  // Server action wrapper for deleting variants
  async function handleDeleteVariant(id: string) {
    'use server';
    await deleteVariantAction({ id });
  }

  // Server action wrapper for assigning variants to accounts
  async function handleAssignVariant(variantId: string, accountId: string) {
    'use server';
    await assignVariantToAccountAction({
      variant_id: variantId,
      account_id: accountId,
    });
  }

  // Server action wrapper for unassigning variants from accounts
  async function handleUnassignVariant(variantId: string, accountId: string) {
    'use server';
    await unassignVariantFromAccountAction({
      variant_id: variantId,
      account_id: accountId,
    });
  }

  return (
    <>
      <PageHeader description={<AppBreadcrumbs />}>
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">{template.name} - Variants</h1>
            <p className="text-muted-foreground text-sm">
              <code className="bg-muted rounded px-1 py-0.5">
                {template.slug}
              </code>
            </p>
          </div>
          <Link
            href={`/admin/prompts/${templateId}/variants/new`}
            className="ml-auto"
          >
            <Button>
              <PlusIcon className="mr-2 h-4 w-4" />
              Create Variant
            </Button>
          </Link>
        </div>
      </PageHeader>

      <PageBody>
        {/* Traffic Split Visualization */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Traffic Distribution</span>
              <Badge variant="outline">
                Total Weight: {totalWeight.toFixed(0)}%
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TrafficSplitVisualization
              variants={variants || []}
              totalWeight={totalWeight}
            />
          </CardContent>
        </Card>

        {/* Variants List */}
        <div className="space-y-4">
          {variants && variants.length > 0 ? (
            variants.map((variant) => {
              const variantAssignments =
                assignments?.filter((a) => a.variant_id === variant.id) || [];

              return (
                <VariantCard
                  key={variant.id}
                  variant={variant}
                  assignments={variantAssignments}
                  templateId={templateId}
                  totalWeight={totalWeight}
                  onDelete={handleDeleteVariant}
                  onAssign={handleAssignVariant}
                  onUnassign={handleUnassignVariant}
                />
              );
            })
          ) : (
            <Card>
              <CardContent className="flex h-32 items-center justify-center">
                <div className="text-center">
                  <p className="text-muted-foreground mb-2">
                    No variants created yet
                  </p>
                  <Link href={`/admin/prompts/${templateId}/variants/new`}>
                    <Button variant="outline" size="sm">
                      <PlusIcon className="mr-2 h-4 w-4" />
                      Create First Variant
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </PageBody>
    </>
  );
}

export default AdminGuard(VariantsManagementPage);
