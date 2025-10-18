'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@kit/ui/avatar';
import { PencilIcon, UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { ManageAccountAssignmentsDialog } from './manage-account-assignments-dialog';
import { DeleteVariantDialog } from './delete-variant-dialog';

interface VariantCardProps {
  variant: {
    id: string;
    variant_name: string;
    description: string | null;
    traffic_weight: number;
    is_active: boolean;
    created_at: string;
  };
  assignments: Array<{
    id: string;
    account: {
      id: string;
      name: string;
      slug: string | null;
      picture_url: string | null;
    } | null;
  }>;
  templateId: string;
  totalWeight: number;
}

export function VariantCard({
  variant,
  assignments,
  templateId,
  totalWeight,
}: VariantCardProps) {
  const percentage =
    totalWeight > 0 && variant.is_active
      ? (Number(variant.traffic_weight) / totalWeight) * 100
      : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2">
              {variant.variant_name}
              {variant.is_active ? (
                <Badge className="bg-green-500">Active</Badge>
              ) : (
                <Badge variant="secondary">Inactive</Badge>
              )}
            </CardTitle>
            {variant.description && (
              <p className="text-muted-foreground mt-1 text-sm">
                {variant.description}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Link
              href={`/admin/prompts/${templateId}/variants/${variant.id}/edit`}
            >
              <Button variant="outline" size="sm">
                <PencilIcon className="h-4 w-4" />
              </Button>
            </Link>
            <DeleteVariantDialog
              variantId={variant.id}
              variantName={variant.variant_name}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Traffic Weight */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Traffic Weight</p>
            <p className="text-muted-foreground text-xs">
              {percentage > 0
                ? `${percentage.toFixed(1)}% of total traffic`
                : 'Not receiving traffic'}
            </p>
          </div>
          <Badge variant="outline" className="text-lg">
            {variant.traffic_weight}
          </Badge>
        </div>

        {/* Account Assignments */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UsersIcon className="h-4 w-4" />
              <span className="text-sm font-medium">
                Account Assignments ({assignments.length})
              </span>
            </div>
            <ManageAccountAssignmentsDialog
              variantId={variant.id}
              currentAssignments={assignments}
            />
          </div>

          {assignments.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {assignments.slice(0, 5).map((assignment) =>
                assignment.account ? (
                  <div
                    key={assignment.id}
                    className="flex items-center gap-2 rounded-md border bg-muted px-2 py-1"
                  >
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={assignment.account.picture_url || ''} />
                      <AvatarFallback className="text-xs">
                        {assignment.account.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-xs">{assignment.account.name}</span>
                  </div>
                ) : null,
              )}
              {assignments.length > 5 && (
                <Badge variant="secondary" className="text-xs">
                  +{assignments.length - 5} more
                </Badge>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              No accounts assigned. This variant will be selected randomly based
              on traffic weight.
            </p>
          )}
        </div>

        {/* Created date */}
        <p className="text-muted-foreground text-xs">
          Created {new Date(variant.created_at).toLocaleDateString()}
        </p>
      </CardContent>
    </Card>
  );
}
